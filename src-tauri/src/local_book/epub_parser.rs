//! EPUB novel parser - extracts chapters and content from EPUB files

use crate::db::models::{Book, BookChapter};

/// A parsed chapter with its text content
#[derive(Debug, Clone)]
pub struct ParsedChapter {
    pub chapter: BookChapter,
    pub content: String,
}

/// Parse an EPUB file from raw bytes
pub fn parse_epub(
    data: &[u8],
    file_name: &str,
) -> Result<(Book, Vec<ParsedChapter>), EpubParseError> {
    let mut doc = epub::doc::EpubDoc::from_reader(std::io::Cursor::new(data))
        .map_err(|e| EpubParseError::Read(e.to_string()))?;

    let title = doc
        .mdata("title")
        .map(|m| m.value.clone())
        .unwrap_or_else(|| file_name.trim_end_matches(".epub").to_string());
    let author = doc
        .mdata("creator")
        .map(|m| m.value.clone())
        .unwrap_or_default();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let book_url = format!("local:///books/{}-{}.epub", sanitize_file_name(&title), now);

    let book = Book {
        book_url: book_url.clone(),
        toc_url: String::new(),
        origin: "local".to_string(),
        origin_name: "本地导入".to_string(),
        name: title,
        author,
        intro: doc.mdata("description").map(|m| m.value.clone()),
        cover_url: None,
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
    };

    // Collect spine items in order
    let spine = doc.spine.clone();
    let mut chapters = Vec::new();

    for (idx, item) in spine.iter().enumerate() {
        let id = item.id.clone().unwrap_or_default();
        let resource = doc.resources.get(&id).cloned();
        if let Some(res) = resource {
            if !res.mime.starts_with("application/xhtml") && !res.mime.starts_with("text/html") {
                continue;
            }

            let content = doc
                .get_resource_str(&id)
                .map(|(text, _)| text)
                .unwrap_or_default();

            // Extract title from HTML or use filename
            let chapter_title =
                extract_title(&content).unwrap_or_else(|| format!("第{}章", idx + 1));

            // Convert HTML to plain text
            let plain_text = html_to_text(&content);

            let chapter = BookChapter {
                url: format!("local://{}/{}", book_url, idx),
                book_url: book_url.clone(),
                index: idx as i32,
                title: chapter_title,
                ..Default::default()
            };

            chapters.push(ParsedChapter {
                chapter,
                content: plain_text,
            });
        }
    }

    if chapters.is_empty() {
        return Err(EpubParseError::NoChapters);
    }

    Ok((book, chapters))
}

/// Extract title from HTML content
fn extract_title(html: &str) -> Option<String> {
    // Try <title> tag
    if let Some(start) = html.find("<title>") {
        if let Some(end) = html.find("</title>") {
            let title = html[start + 7..end].trim();
            if !title.is_empty() {
                return Some(decode_html_entities(title));
            }
        }
    }

    // Try <h1> tag
    for tag in &["h1", "h2", "h3"] {
        let open = format!("<{}", tag);
        let close = format!("</{}", tag);
        let lower = html.to_lowercase();
        if let Some(start) = lower.find(&open) {
            // Find the closing > of the opening tag
            if let Some(tag_end) = html[start..].find(">") {
                let content_start = start + tag_end + 1;
                if let Some(end) = lower[content_start..].find(&close) {
                    let title = html[content_start..content_start + end].trim();
                    let title = strip_tags(title);
                    if !title.is_empty() && title.len() < 200 {
                        return Some(decode_html_entities(&title));
                    }
                }
            }
        }
    }

    None
}

/// Simple HTML to text conversion
fn html_to_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    let mut prev_char = ' ';

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if in_tag {
            continue;
        }
        // Normalize whitespace
        if ch.is_whitespace() {
            if prev_char != ' ' {
                text.push(' ');
                prev_char = ' ';
            }
        } else {
            text.push(ch);
            prev_char = ch;
        }
    }

    decode_html_entities(&text)
        .lines()
        .map(|l| l.trim())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Strip HTML tags from a string
fn strip_tags(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            continue;
        }
        if ch == '>' {
            in_tag = false;
            continue;
        }
        if !in_tag {
            text.push(ch);
        }
    }
    text
}

/// Decode common HTML entities
fn decode_html_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
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
pub enum EpubParseError {
    #[error("Failed to read EPUB: {0}")]
    Read(String),
    #[error("No chapters found in EPUB")]
    NoChapters,
}
