//! TXT novel parser - extracts chapters from plain text files
//!
//! Uses regex rules (TxtTocRule from DB) or built-in patterns to find chapter boundaries.

use regex::Regex;
use crate::db::models::{Book, BookChapter};

/// Built-in chapter detection patterns (Chinese novel conventions)
/// These match the chapter marker + title on the same line
const BUILTIN_PATTERNS: &[&str] = &[
    // 第1章 标题 / 第一章 标题
    r"(?m)^\s*第[\d零一二三四五六七八九十百千]+章\s*[:：]?\s*.*$",
    // 第1回 标题 / 第一回 标题
    r"(?m)^\s*第[\d零一二三四五六七八九十百千]+回\s*[:：]?\s*.*$",
    // 第1节 标题 / 第一节 标题
    r"(?m)^\s*第[\d零一二三四五六七八九十百千]+节\s*[:：]?\s*.*$",
    // 第1集 标题 / 第一集 标题
    r"(?m)^\s*第[\d零一二三四五六七八九十百千]+集\s*[:：]?\s*.*$",
    // 第1卷 标题 / 第一卷 标题
    r"(?m)^\s*第[\d零一二三四五六七八九十百千]+卷\s*[:：]?\s*.*$",
    // 第1部 标题 / 第一部 标题
    r"(?m)^\s*第[\d零一二三四五六七八九十百千]+部\s*[:：]?\s*.*$",
    // 1. 标题 / 1、标题 at line start
    r"(?m)^\s*[\d]+[\.．、\s]+[^\d].*$",
    // 正文 第1章 style
    r"(?m)^\s*正文\s*第[\d零一二三四五六七八九十百千]+章.*$",
];

/// A detected chapter boundary
#[derive(Debug, Clone)]
struct ChapterBoundary {
    title: String,
    start_pos: usize,
    end_pos: Option<usize>,
}

/// Parse a TXT file into Book + BookChapters
pub fn parse_txt(content: &str, file_name: &str) -> Result<(Book, Vec<BookChapter>), TxtParseError> {
    let boundaries = detect_chapters(content)?;

    if boundaries.is_empty() {
        // No chapters detected - treat entire file as single chapter
        let book = create_book(file_name, content.len());
        let chapter = BookChapter {
            url: format!("local://{}/0", book.book_url),
            book_url: book.book_url.clone(),
            index: 0,
            title: "全文".to_string(),
            ..Default::default()
        };
        return Ok((book, vec![chapter]));
    }

    let book = create_book(file_name, content.len());
    let mut chapters = Vec::new();

    for (idx, boundary) in boundaries.iter().enumerate() {
        let chapter_url = format!("local://{}/{}", book.book_url, idx);

        chapters.push(BookChapter {
            url: chapter_url,
            book_url: book.book_url.clone(),
            index: idx as i32,
            title: boundary.title.clone(),
            ..Default::default()
        });
    }

    Ok((book, chapters))
}

/// Detect chapter boundaries in text using regex patterns
fn detect_chapters(content: &str) -> Result<Vec<ChapterBoundary>, TxtParseError> {
    let mut all_matches: Vec<(usize, String)> = Vec::new();

    // Try each built-in pattern
    for pattern in BUILTIN_PATTERNS {
        let re = Regex::new(pattern)
            .map_err(|e| TxtParseError::InvalidRegex(e.to_string()))?;

        for cap in re.find_iter(content) {
            let title = cap.as_str().trim().to_string();
            if title.len() > 200 {
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

/// Create a Book record from file metadata
fn create_book(file_name: &str, content_len: usize) -> Book {
    let base_name = file_name
        .trim_end_matches(".txt")
        .trim_end_matches(".TXT");

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
        intro: Some(format!("Imported from {} ({} chars)", file_name, content_len)),
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
    #[error("No chapters detected")]
    NoChapters,
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_chapters_numbered() {
        let text = "第1章 开始\n这是第一章内容\n第2章 中间\n这是第二章内容\n第3章 结束\n这是第三章内容";
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
    fn test_no_chapters() {
        let text = "这是一段没有章节的文本内容";
        let boundaries = detect_chapters(text).unwrap();
        assert!(boundaries.is_empty());
    }

    #[test]
    fn test_parse_txt_single_chapter() {
        let (book, chapters) = parse_txt("没有章节的文本", "test.txt").unwrap();
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].title, "全文");
        assert_eq!(book.name, "test");
    }

    #[test]
    fn test_parse_txt_multi_chapter() {
        let text = "第1章 开始\n内容1\n第2章 结束\n内容2";
        let (book, chapters) = parse_txt(text, "novel.txt").unwrap();
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "第1章 开始");
        assert_eq!(chapters[1].title, "第2章 结束");
        assert_eq!(book.name, "novel");
    }
}
