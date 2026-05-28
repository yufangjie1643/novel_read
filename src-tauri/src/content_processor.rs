use regex::Regex;
use std::collections::HashSet;

use crate::db::models::ReplaceRule;

/// Result of processing chapter content.
#[derive(Debug, Clone)]
pub struct BookContent {
    /// Whether duplicate title was removed from content.
    pub same_title_removed: bool,
    /// Processed content lines (first line is title when `include_title` is true).
    pub contents: Vec<String>,
    /// Replace rules that actually modified the content.
    pub effective_rules: Vec<ReplaceRule>,
}

/// Process chapter content through the full pipeline.
///
/// Pipeline order matches Android `ContentProcessor.getContent`:
/// 1. Remove duplicate title
/// 2. Re-segment paragraphs
/// 3. Chinese simplified/traditional conversion
/// 4. Apply replace (purify) rules
/// 5. Re-add title
/// 6. Split into lines and add paragraph indent
pub fn process_content(
    book_name: &str,
    chapter_title: &str,
    content: &str,
    include_title: bool,
    use_replace: bool,
    re_segment: bool,
    chinese_convert: i32,
    replace_rules: &[ReplaceRule],
) -> BookContent {
    let mut processed = content.to_string();
    let mut same_title_removed = false;
    let mut effective_rules = Vec::new();

    if content != "null" {
        // 1. Remove duplicate title from content beginning.
        if let Some(result) = try_remove_duplicate_title(book_name, chapter_title, &processed) {
            processed = result;
            same_title_removed = true;
        } else if use_replace {
            let display_title = apply_replace_rules(chapter_title, replace_rules, false);
            if let Some(result) = try_remove_duplicate_title(book_name, &display_title, &processed) {
                processed = result;
                same_title_removed = true;
            }
        }

        // 2. Re-segmentation.
        if re_segment {
            processed = re_segment_text(&processed, chapter_title);
        }

        // 3. Chinese conversion: 0=none, 1=t2s, 2=s2t.
        match chinese_convert {
            1 => processed = crate::chinese_utils::t2s(&processed),
            2 => processed = crate::chinese_utils::s2t(&processed),
            _ => {}
        }

        // 4. Apply replace (purify) rules.
        if use_replace {
            // Android trims each line before applying rules.
            processed = processed
                .lines()
                .map(|l| l.trim())
                .collect::<Vec<_>>()
                .join("\n");

            for rule in replace_rules {
                let pattern = match &rule.pattern {
                    Some(p) if !p.is_empty() => p,
                    _ => continue,
                };
                let replacement = rule.replacement.as_deref().unwrap_or("");

                let tmp = if rule.is_regex {
                    match Regex::new(pattern) {
                        Ok(re) => re.replace_all(&processed, replacement).to_string(),
                        Err(_) => continue,
                    }
                } else {
                    processed.replace(pattern, replacement)
                };

                if processed != tmp {
                    effective_rules.push(rule.clone());
                    processed = tmp;
                }
            }
        }
    }

    // 5. Re-add title.
    if include_title {
        let title = apply_replace_rules(chapter_title, replace_rules, use_replace);
        processed = format!("{}\n{}", title, processed);
    }

    // 6. Format: split lines, trim whitespace/control chars, filter empty, add indent.
    let mut contents = Vec::new();
    for line in processed.lines() {
        let paragraph: String = line
            .chars()
            .filter(|c| *c > '\u{0020}' && *c != '\u{3000}')
            .collect();
        if !paragraph.is_empty() {
            if contents.is_empty() && include_title {
                contents.push(paragraph);
            } else {
                // Full-width indent (two em-spaces), matching Android ReadBookConfig.paragraphIndent.
                contents.push(format!("　　{}", paragraph));
            }
        }
    }

    BookContent {
        same_title_removed,
        contents,
        effective_rules,
    }
}

/// Apply replace rules to a title string.
fn apply_replace_rules(text: &str, rules: &[ReplaceRule], use_replace: bool) -> String {
    if !use_replace || rules.is_empty() {
        return text.to_string();
    }
    let mut result = text.to_string();
    for rule in rules {
        if let Some(pattern) = &rule.pattern {
            if pattern.is_empty() {
                continue;
            }
            if rule.is_regex {
                if let Ok(re) = Regex::new(pattern) {
                    result = re
                        .replace_all(&result, rule.replacement.as_deref().unwrap_or(""))
                        .to_string();
                }
            } else {
                result = result.replace(pattern, rule.replacement.as_deref().unwrap_or(""));
            }
        }
    }
    result
}

/// Try to remove duplicate chapter title from the beginning of raw content.
fn try_remove_duplicate_title(book_name: &str, title: &str, content: &str) -> Option<String> {
    if title.is_empty() {
        return None;
    }
    let name_escaped = regex::escape(book_name);
    let title_escaped = regex::escape(title);
    // Match optional whitespace/punctuation/book-name prefix, then the title, then optional whitespace.
    let pattern = format!(
        r"^(\s|\p{{P}}|{})*{}(\s)*",
        name_escaped, title_escaped
    );
    let re = Regex::new(&pattern).ok()?;
    re.find(content).map(|m| content[m.end()..].to_string())
}

// ============== Re-segmentation (simplified from ContentHelp.kt) ==============

const MARK_SENTENCES_END: &str = "？。！?!~";
const MARK_QUOTATION: &str = "\"""";
const MARK_QUOTATION_RIGHT: &str = "\"""";
const WORD_MAX_LENGTH: usize = 16;

fn is_sentence_end(c: char) -> bool {
    MARK_SENTENCES_END.contains(c)
}

fn is_quote(c: char) -> bool {
    MARK_QUOTATION.contains(c)
}

/// Build dictionary from quoted phrases that appear more than once.
fn make_dict(content: &str) -> HashSet<String> {
    let re = match Regex::new(&format!(
        r#"(?<=["'"""])[^\p{{P}}]{{1,{}}}(?=["'"""])"#,
        WORD_MAX_LENGTH
    )) {
        Ok(re) => re,
        Err(_) => return HashSet::new(),
    };

    let mut seen = Vec::new();
    let mut dict = HashSet::new();

    for mat in re.find_iter(content) {
        let word = mat.as_str().to_string();
        if seen.contains(&word) {
            dict.insert(word);
        } else {
            seen.push(word);
        }
    }
    dict
}

/// Re-segment text paragraphs.
///
/// Simplified port of Android `ContentHelp.reSegment`. Covers:
/// - paragraph merging (glue broken lines back together)
/// - quotation/dialogue handling
/// - sentence boundary splitting
fn re_segment_text(content: &str, chapter_title: &str) -> String {
    let dict = make_dict(content);

    // Pre-process HTML entities and colon-quote patterns.
    let preprocessed = content
        .replace("&quot;", "\"")
        .replace("&ldquo;", "\"")
        .replace("&rdquo;", "\"")
        .replace("&hellip;", "…");

    // Split by newlines.
    let lines: Vec<&str> = preprocessed.split('\n').collect();
    if lines.is_empty() {
        return preprocessed;
    }

    // Merge wrongly-split paragraphs.
    let mut buffer = String::with_capacity((content.len() as f64 * 1.15) as usize);
    buffer.push_str("  ");

    let title_trimmed = chapter_title.trim_matches(|c: char| c <= ' ');
    let first_trimmed = lines[0].trim_matches(|c: char| c <= ' ');
    let start_idx = if title_trimmed != first_trimmed {
        buffer.push_str(&normalize_spaces(lines[0]));
        1
    } else {
        1
    };

    for i in start_idx..lines.len() {
        let line = normalize_spaces(lines[i]);
        if line.is_empty() {
            continue;
        }

        if buffer.len() > 2 {
            let last = buffer.chars().last().unwrap_or(' ');
            let prev = if buffer.len() >= 3 {
                buffer.chars().nth(buffer.len() - 2).unwrap_or(' ')
            } else {
                ' '
            };

            if is_sentence_end(last)
                || (is_in_string(last, MARK_QUOTATION_RIGHT) && is_sentence_end(prev))
            {
                buffer.push('\n');
            }
        }
        buffer.push_str(&line);
    }

    // Handle quotations and dialogue markers.
    let text = buffer
        .replace("\"\"", "\"\n\"")
        .replace("\"\"", "\"\n\"")
        .replace("\"?\"", "\"?\n\"")
        .replace("\"!\"", "\"!\n\"")
        .replace("\".\"", "\".\n\"")
        .replace("\"~\"", "\"~\n\"")
        .replace("\"?", "\"?\n")
        .replace("\"!", "\"!\n")
        .replace("\".", "\".\n")
        .replace("\"~", "\"~\n")
        .replace("\"?", "\"?\n")
        .replace("\"!", "\"!\n")
        .replace("\".", "\".\n");

    // Split into paragraphs and process each with dictionary-aware sentence splitting.
    let paragraphs: Vec<&str> = text.split('\n').collect();
    let mut result = String::with_capacity(text.len());

    for para in paragraphs {
        let trimmed = para.trim();
        if trimmed.is_empty() {
            continue;
        }
        let split = split_paragraph(trimmed, &dict);
        for s in split {
            if !s.is_empty() {
                if !result.is_empty() {
                    result.push('\n');
                }
                result.push_str(&s);
            }
        }
    }

    // Clean up leading whitespace.
    let re_lead = Regex::new(r"^\s+").unwrap_or_else(|_| Regex::new(r"^$").unwrap());
    let result = re_lead.replace(&result, "").to_string();

    result
}

/// Remove CJK full-width spaces and regular whitespace from a string.
fn normalize_spaces(s: &str) -> String {
    s.chars()
        .filter(|c| *c != '\u{3000}' && !c.is_whitespace())
        .collect()
}

fn is_in_string(c: char, set: &str) -> bool {
    set.contains(c)
}

/// Split a paragraph into sentences, respecting quotation boundaries.
fn split_paragraph(para: &str, dict: &HashSet<String>) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    let mut in_quote = false;
    let chars: Vec<char> = para.chars().collect();

    for (i, &c) in chars.iter().enumerate() {
        current.push(c);

        if is_quote(c) {
            in_quote = !in_quote;
        }

        if !in_quote && is_sentence_end(c) {
            // Check if this is a dictionary entry in quotes — avoid splitting.
            let lookback = chars[..=i].iter().collect::<String>();
            if let Some(start) = lookback.rfind('\"') {
                let word = &lookback[start + 1..];
                if dict.contains(word) {
                    continue;
                }
            }

            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }

    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string());
    }

    sentences
}
