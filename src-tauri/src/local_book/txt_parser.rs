//! TXT novel parser - decodes plain text files and extracts chapters.

use crate::db::models::{Book, BookChapter};
use encoding_rs::{GB18030, UTF_16BE, UTF_16LE};
use regex::Regex;

const CHAPTER_NUM: &str = r"[\d０-９零〇一二三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟两]+";
const HSPACE: &str = r"[ \t　]*";
const HSPACE_ONE: &str = r"[ \t　]+";

/// Built-in chapter detection patterns for common TXT novel conventions.
fn builtin_patterns() -> Vec<String> {
    let num = CHAPTER_NUM;
    let hs = HSPACE;
    let hs_one = HSPACE_ONE;
    vec![
        // 第1章 标题 / 第一章 标题 / 正文 第0001章 标题 / 第一话 标题
        format!(
            r"(?m)^{}(?:正文{})?第{}{}{}[章节回集卷部话幕]{}[:：、.．-]?{}.{{0,120}}$",
            hs, hs, hs, num, hs, hs, hs
        ),
        // 卷一 风起 / 篇二 标题
        format!(
            r"(?m)^{}(?:卷|篇|部){}{}{}[:：、.．-]?{}.{{0,120}}$",
            hs, hs, num, hs, hs
        ),
        // Chapter 1 / Chapter IV
        format!(
            r"(?im)^{}chapter{}[0-9ivxlcdm]+(?:[ \t　:：.．-]+.{{0,120}})?$",
            hs, hs_one
        ),
        // 序章 / 楔子 / 尾声
        format!(
            r"(?m)^{}(?:序章|楔子|引子|前言|尾声|后记){}.{{0,80}}$",
            hs, hs
        ),
        // 番外一 / 番外篇 标题
        format!(
            r"(?m)^{}番外(?:篇|卷)?(?:{}{})?{}[:：、.．-]?{}.{{0,120}}$",
            hs, hs, num, hs, hs
        ),
        // 1. 标题 / 001、标题 / 1． 标题（支持标点后空格）
        format!(
            r"(?m)^{}[\d０-９]{{1,5}}{}[.．、]{}[ \t　]*\S.{{0,120}}$",
            hs, hs, hs
        ),
        // 【第一章】标题 / 【第1章】标题
        format!(
            r"(?m)^{}【第{}{}{}[章节回集卷部话幕]{}】{}[:：、.．-]?{}.{{0,120}}$",
            hs, hs, num, hs, hs, hs, hs
        ),
        // （第一章）标题 / （第1章）标题
        format!(
            r"(?m)^{}（第{}{}{}[章节回集卷部话幕]{}）{}[:：、.．-]?{}.{{0,120}}$",
            hs, hs, num, hs, hs, hs, hs
        ),
        // 001 标题 / 01 标题（纯数字序号+空格，要求标题含中文或字母，降低误匹配）
        format!(
            r"(?m)^{}[\d]{{1,5}}{}\s+(?:[\p{{Han}}a-zA-Z]\S*.{{1,119}})$",
            hs, hs
        ),
    ]
}

/// A detected chapter boundary
#[derive(Debug, Clone)]
struct ChapterBoundary {
    title: String,
    start_pos: usize,
    end_pos: Option<usize>,
}

/// A parsed chapter with its text content
#[derive(Debug, Clone)]
pub struct ParsedChapter {
    pub chapter: BookChapter,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedTxt {
    pub content: String,
    pub encoding: String,
}

/// Decode raw TXT bytes. Prefer exact UTF-8, detect UTF-16 BOM/shape, then fall back to GB18030.
pub fn decode_txt_bytes(data: &[u8]) -> Result<DecodedTxt, TxtParseError> {
    if data.is_empty() {
        return Ok(DecodedTxt {
            content: String::new(),
            encoding: "UTF-8".to_string(),
        });
    }

    if data.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return decode_utf8(&data[3..], "UTF-8");
    }
    if data.starts_with(&[0xFF, 0xFE]) {
        return Ok(decode_with_encoding(&data[2..], UTF_16LE, "UTF-16LE"));
    }
    if data.starts_with(&[0xFE, 0xFF]) {
        return Ok(decode_with_encoding(&data[2..], UTF_16BE, "UTF-16BE"));
    }

    if looks_like_utf16_le(data) {
        return Ok(decode_with_encoding(data, UTF_16LE, "UTF-16LE"));
    }
    if looks_like_utf16_be(data) {
        return Ok(decode_with_encoding(data, UTF_16BE, "UTF-16BE"));
    }

    if let Ok(content) = std::str::from_utf8(data) {
        return Ok(DecodedTxt {
            content: strip_leading_bom(content).to_string(),
            encoding: "UTF-8".to_string(),
        });
    }

    Ok(decode_with_encoding(data, GB18030, "GB18030"))
}

/// Parse raw TXT bytes into Book + chapters with content.
pub fn parse_txt_bytes(
    data: &[u8],
    file_name: &str,
) -> Result<(Book, Vec<ParsedChapter>), TxtParseError> {
    let decoded = decode_txt_bytes(data)?;
    parse_txt_with_encoding(&decoded.content, file_name, Some(decoded.encoding.as_str()))
}

/// Parse a TXT string into Book + chapters with content.
pub fn parse_txt(
    content: &str,
    file_name: &str,
) -> Result<(Book, Vec<ParsedChapter>), TxtParseError> {
    parse_txt_with_encoding(content, file_name, None)
}

fn parse_txt_with_encoding(
    content: &str,
    file_name: &str,
    encoding: Option<&str>,
) -> Result<(Book, Vec<ParsedChapter>), TxtParseError> {
    let mut boundaries = detect_chapters(content)?;

    if boundaries.is_empty() {
        // No chapters detected - treat entire file as single chapter
        let book = create_book(file_name, content.chars().count(), encoding);
        let chapter = BookChapter {
            url: format!("local://{}/0", book.book_url),
            book_url: book.book_url.clone(),
            index: 0,
            title: "全文".to_string(),
            ..Default::default()
        };
        return Ok((
            book,
            vec![ParsedChapter {
                chapter,
                content: content.to_string(),
            }],
        ));
    }

    if let Some(first_start) = boundaries.first().map(|boundary| boundary.start_pos) {
        let prefix = &content[..first_start];
        if !prefix.trim().is_empty() {
            boundaries.insert(
                0,
                ChapterBoundary {
                    title: infer_preface_title(prefix),
                    start_pos: 0,
                    end_pos: Some(first_start),
                },
            );
        }
    }

    let book = create_book(file_name, content.chars().count(), encoding);
    let mut chapters = Vec::new();

    for (idx, boundary) in boundaries.iter().enumerate() {
        let chapter_url = format!("local://{}/{}", book.book_url, idx);

        let start = boundary.start_pos;
        let end = boundary.end_pos.unwrap_or(content.len());
        let chapter_content = if end > start && end <= content.len() {
            content[start..end].to_string()
        } else {
            String::new()
        };

        chapters.push(ParsedChapter {
            chapter: BookChapter {
                url: chapter_url,
                book_url: book.book_url.clone(),
                index: idx as i32,
                title: boundary.title.clone(),
                ..Default::default()
            },
            content: chapter_content,
        });
    }

    Ok((book, chapters))
}

/// Detect chapter boundaries in text using regex patterns
fn detect_chapters(content: &str) -> Result<Vec<ChapterBoundary>, TxtParseError> {
    let mut all_matches: Vec<(usize, String)> = Vec::new();

    for pattern in builtin_patterns() {
        let re = Regex::new(&pattern).map_err(|e| TxtParseError::InvalidRegex(e.to_string()))?;

        for cap in re.find_iter(content) {
            let title = cap.as_str().trim().to_string();
            if !is_reasonable_title(&title) {
                // Too long to be a chapter title, probably a false positive
                continue;
            }
            all_matches.push((cap.start(), title));
        }
    }

    // Sort by position and deduplicate overlapping matches
    all_matches.sort_by(|a, b| a.0.cmp(&b.0));

    // Remove duplicates at same/similar positions (within 10 chars)
    let mut deduped: Vec<(usize, String)> = Vec::new();
    for (pos, title) in all_matches {
        if let Some(last) = deduped.last() {
            if pos.saturating_sub(last.0) < 10 {
                // Too close to previous, skip (likely same match from different patterns)
                continue;
            }
        }
        deduped.push((pos, title));
    }

    // Build boundaries with end positions
    let mut boundaries = Vec::new();
    for (i, (pos, title)) in deduped.iter().enumerate() {
        let end_pos = if i + 1 < deduped.len() {
            Some(deduped[i + 1].0)
        } else {
            None
        };
        boundaries.push(ChapterBoundary {
            title: title.clone(),
            start_pos: *pos,
            end_pos,
        });
    }

    Ok(boundaries)
}

fn decode_utf8(data: &[u8], encoding: &str) -> Result<DecodedTxt, TxtParseError> {
    let content = std::str::from_utf8(data)
        .map_err(|e| TxtParseError::Decode(format!("Invalid UTF-8 data: {}", e)))?;
    Ok(DecodedTxt {
        content: strip_leading_bom(content).to_string(),
        encoding: encoding.to_string(),
    })
}

fn decode_with_encoding(
    data: &[u8],
    encoding: &'static encoding_rs::Encoding,
    label: &str,
) -> DecodedTxt {
    let (content, _, _) = encoding.decode(data);
    DecodedTxt {
        content: strip_leading_bom(content.as_ref()).to_string(),
        encoding: label.to_string(),
    }
}

fn strip_leading_bom(content: &str) -> &str {
    content.strip_prefix('\u{feff}').unwrap_or(content)
}

fn looks_like_utf16_le(data: &[u8]) -> bool {
    let sample_len = data.len().min(4096);
    if sample_len < 8 {
        return false;
    }
    let pairs = sample_len / 2;
    let even_zero = data[..sample_len]
        .iter()
        .step_by(2)
        .filter(|&&b| b == 0)
        .count();
    let odd_zero = data[1..sample_len]
        .iter()
        .step_by(2)
        .filter(|&&b| b == 0)
        .count();
    odd_zero > pairs / 8 && odd_zero > even_zero.saturating_mul(2)
}

fn looks_like_utf16_be(data: &[u8]) -> bool {
    let sample_len = data.len().min(4096);
    if sample_len < 8 {
        return false;
    }
    let pairs = sample_len / 2;
    let even_zero = data[..sample_len]
        .iter()
        .step_by(2)
        .filter(|&&b| b == 0)
        .count();
    let odd_zero = data[1..sample_len]
        .iter()
        .step_by(2)
        .filter(|&&b| b == 0)
        .count();
    even_zero > pairs / 8 && even_zero > odd_zero.saturating_mul(2)
}

fn infer_preface_title(prefix: &str) -> String {
    prefix
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && line.chars().count() <= 40)
        .unwrap_or("卷首")
        .to_string()
}

fn is_reasonable_title(title: &str) -> bool {
    let len = title.chars().count();
    (2..=140).contains(&len)
}

/// Create a Book record from file metadata
fn create_book(file_name: &str, content_len: usize, encoding: Option<&str>) -> Book {
    let base_name = file_name.trim_end_matches(".txt").trim_end_matches(".TXT");

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let book_url = format!("local:///books/{}-{}", sanitize_file_name(base_name), now);

    Book {
        book_url,
        toc_url: String::new(),
        origin: "local".to_string(),
        origin_name: "本地导入".to_string(),
        name: base_name.to_string(),
        author: String::new(),
        intro: Some(match encoding {
            Some(charset) => format!(
                "Imported from {} ({} chars, {})",
                file_name, content_len, charset
            ),
            None => format!("Imported from {} ({} chars)", file_name, content_len),
        }),
        charset: encoding.map(str::to_string),
        book_type: 0,
        group: 0,
        total_chapter_num: 0,
        dur_chapter_index: 0,
        dur_chapter_pos: 0,
        dur_chapter_time: 0,
        can_update: false,
        order: 0,
        origin_order: 0,
        sync_time: now,
        ..Default::default()
    }
}

/// Sanitize a file name for use in URLs
fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum TxtParseError {
    #[error("Invalid regex pattern: {0}")]
    InvalidRegex(String),
    #[error("Decode error: {0}")]
    Decode(String),
    #[error("No chapters detected")]
    NoChapters,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use encoding_rs::GB18030;

    #[test]
    fn test_detect_chapters_numbered() {
        let text =
            "第1章 开始\n这是第一章内容\n第2章 中间\n这是第二章内容\n第3章 结束\n这是第三章内容";
        let boundaries = detect_chapters(text).unwrap();
        assert_eq!(boundaries.len(), 3);
        assert_eq!(boundaries[0].title, "第1章 开始");
        assert_eq!(boundaries[1].title, "第2章 中间");
        assert_eq!(boundaries[2].title, "第3章 结束");
    }

    #[test]
    fn test_detect_chapters_chinese() {
        let text = "第一章 开始\n内容\n第二章 中间\n内容\n第三章 结束\n内容";
        let boundaries = detect_chapters(text).unwrap();
        assert_eq!(boundaries.len(), 3);
        assert_eq!(boundaries[0].title, "第一章 开始");
    }

    #[test]
    fn test_detect_chapters_extended_patterns() {
        let text = "序章\n内容\n卷一 风起\n内容\nChapter 2: The Road\ncontent\n番外一 后记\n内容";
        let boundaries = detect_chapters(text).unwrap();
        assert_eq!(boundaries.len(), 4);
        assert_eq!(boundaries[0].title, "序章");
        assert_eq!(boundaries[1].title, "卷一 风起");
        assert_eq!(boundaries[2].title, "Chapter 2: The Road");
        assert_eq!(boundaries[3].title, "番外一 后记");
    }

    #[test]
    fn test_no_chapters() {
        let text = "这是一段没有章节的文本内容";
        let boundaries = detect_chapters(text).unwrap();
        assert!(boundaries.is_empty());
    }

    #[test]
    fn test_parse_txt_single_chapter() {
        let (book, chapters) = parse_txt("没有章节的文本", "test.txt").unwrap();
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].chapter.title, "全文");
        assert_eq!(book.name, "test");
    }

    #[test]
    fn test_parse_txt_multi_chapter() {
        let text = "第1章 开始\n内容1\n第2章 结束\n内容2";
        let (book, chapters) = parse_txt(text, "novel.txt").unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].chapter.title, "第1章 开始");
        assert_eq!(chapters[1].chapter.title, "第2章 结束");
        assert_eq!(book.name, "novel");
    }

    #[test]
    fn test_parse_txt_preserves_preface_before_first_chapter() {
        let text = "小说标题\n作者：佚名\n\n第一章 开始\n正文";
        let (_book, chapters) = parse_txt(text, "preface.txt").unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].chapter.title, "小说标题");
        assert!(chapters[0].content.contains("作者：佚名"));
        assert_eq!(chapters[1].chapter.title, "第一章 开始");
    }

    #[test]
    fn test_decode_gb18030_txt_bytes() {
        let text = "第一章 开始\n中文内容\n第二章 结束\n更多内容";
        let (encoded, _, had_errors) = GB18030.encode(text);
        assert!(!had_errors);

        let decoded = decode_txt_bytes(&encoded).unwrap();
        assert_eq!(decoded.encoding, "GB18030");
        assert_eq!(decoded.content, text);
    }

    #[test]
    fn test_parse_gb18030_txt_bytes() {
        let text = "第一章 开始\n中文内容\n第二章 结束\n更多内容";
        let (encoded, _, had_errors) = GB18030.encode(text);
        assert!(!had_errors);

        let (book, chapters) = parse_txt_bytes(&encoded, "gbk-novel.txt").unwrap();
        assert_eq!(book.charset.as_deref(), Some("GB18030"));
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].chapter.title, "第一章 开始");
        assert!(chapters[0].content.contains("中文内容"));
    }

    #[test]
    fn test_decode_utf16le_with_bom() {
        let text = "第一章 开始\n内容";
        let mut data = vec![0xFF, 0xFE];
        for code_unit in text.encode_utf16() {
            data.extend_from_slice(&code_unit.to_le_bytes());
        }

        let decoded = decode_txt_bytes(&data).unwrap();
        assert_eq!(decoded.encoding, "UTF-16LE");
        assert_eq!(decoded.content, text);
    }
}
