//! 7-rule relevance cascade for search results.
//! See spec §7 for the algorithm details.

use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ScoreBreakdown {
    pub words: u8,
    pub typo: u8,
    pub proximity: u8,
    pub source_weight: u8,
    pub attribute_rank: u8,
    pub word_position: u8,
    pub source_health: u8,
}

pub fn normalize_text(s: &str) -> String {
    let lower = s.to_lowercase();
    lower
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation() && !is_cjk_punct(*c))
        .collect()
}

fn is_cjk_punct(c: char) -> bool {
    matches!(c, '\u{3000}'..='\u{303F}' | '\u{FF00}'..='\u{FFEF}')
}

pub fn damerau_levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().take(64).collect();
    let b: Vec<char> = b.chars().take(64).collect();
    let n = a.len();
    let m = b.len();
    if n == 0 {
        return m;
    }
    if m == 0 {
        return n;
    }

    let mut d = vec![vec![0usize; m + 1]; n + 1];
    for i in 0..=n {
        d[i][0] = i;
    }
    for j in 0..=m {
        d[0][j] = j;
    }

    let mut da: std::collections::HashMap<char, usize> = std::collections::HashMap::new();

    for i in 1..=n {
        let mut db = 0usize;
        for j in 1..=m {
            let i1 = *da.get(&b[j - 1]).unwrap_or(&0);
            let j1 = db;
            let cost = if a[i - 1] == b[j - 1] {
                db = j;
                0
            } else {
                1
            };
            d[i][j] = (d[i - 1][j] + 1)
                .min(d[i][j - 1] + 1)
                .min(d[i - 1][j - 1] + cost);
            if i1 > 0 && j1 > 0 {
                d[i][j] = d[i][j].min(d[i1 - 1][j1 - 1] + (i - i1 - 1) + 1 + (j - j1 - 1));
            }
        }
        da.insert(a[i - 1], i);
    }
    d[n][m]
}

pub fn score(
    book_name: &str,
    book_author: Option<&str>,
    book_intro: Option<&str>,
    query: &str,
    source_weight: i32,
    source_health: f64,
) -> ScoreBreakdown {
    let q = normalize_text(query);
    let title = normalize_text(book_name);
    let author = normalize_text(book_author.unwrap_or(""));
    let intro = normalize_text(book_intro.unwrap_or(""));

    // Rule 1: words — query word count in title+author
    let q_chars: Vec<char> = q.chars().collect();
    let title_hits = count_substring_hits(&q, &title);
    let author_hits = count_substring_hits(&q, &author);
    let intro_hits = count_substring_hits(&q, &intro);
    let words = title_hits.saturating_add(author_hits).min(255) as u8;

    // Rule 2: typo — Damerau-Levenshtein inverse (best of title/author)
    let typo_title = 255u8.saturating_sub(damerau_levenshtein(&q, &title).min(255) as u8);
    let typo_author = 255u8.saturating_sub(damerau_levenshtein(&q, &author).min(255) as u8);
    let typo = typo_title.max(typo_author);

    // Rule 3: proximity — span of query chars in title (ASC, lower is better)
    let proximity = if q.is_empty() || title.is_empty() {
        255u8
    } else {
        proximity_score(&q_chars, &title).min(255) as u8
    };

    // Rule 4: source_weight — user-defined per-source priority
    // 0 = default (100), positive = up to 200, negative = down to 50
    let source_weight_u8: u8 = if source_weight >= 0 {
        100u8.saturating_add(source_weight.min(100) as u8)
    } else {
        100u8.saturating_sub((-source_weight).min(50) as u8)
    };

    // Rule 5: attribute_rank — title:3 > author:2 > intro:1
    let attribute_rank = (if title_hits > 0 { 3 } else { 0 })
        + (if author_hits > 0 { 2 } else { 0 })
        + (if intro_hits > 0 { 1 } else { 0 });

    // Rule 6: word_position — first match position in title (ASC, lower is better)
    let word_position = if q.is_empty() || title.is_empty() {
        255u8
    } else {
        first_match_position(&q, &title).min(255) as u8
    };

    // Rule 7: source_health — health_score * 100
    let source_health_u8 = (source_health.clamp(0.0, 1.0) * 100.0) as u8;

    ScoreBreakdown {
        words,
        typo,
        proximity,
        source_weight: source_weight_u8,
        attribute_rank,
        word_position,
        source_health: source_health_u8,
    }
}

fn count_substring_hits(needle: &str, haystack: &str) -> usize {
    if needle.is_empty() {
        return 0;
    }
    haystack.matches(needle).count()
}

fn proximity_score(q_chars: &[char], title: &str) -> usize {
    if q_chars.is_empty() || title.is_empty() {
        return usize::MAX;
    }
    let first_q = q_chars[0];
    let last_q = *q_chars.last().unwrap();
    let title_chars: Vec<char> = title.chars().collect();
    let mut left = None;
    for (i, &c) in title_chars.iter().enumerate() {
        if c == first_q {
            left = Some(i);
            break;
        }
    }
    let mut right = None;
    for (i, &c) in title_chars.iter().enumerate().rev() {
        if c == last_q {
            right = Some(i);
            break;
        }
    }
    match (left, right) {
        (Some(l), Some(r)) if r >= l => {
            let span = r - l;
            span.saturating_sub(q_chars.len() - 1)
        }
        _ => usize::MAX,
    }
}

fn first_match_position(needle: &str, haystack: &str) -> usize {
    if needle.is_empty() || haystack.is_empty() {
        return usize::MAX;
    }
    if let Some(byte_idx) = haystack.find(needle) {
        haystack[..byte_idx].chars().count()
    } else {
        usize::MAX
    }
}

impl Ord for ScoreBreakdown {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher words/typo/weight/rank/health = better; Lower proximity/position = better
        self.words
            .cmp(&other.words)
            .then(self.typo.cmp(&other.typo))
            .then(other.proximity.cmp(&self.proximity))
            .then(self.source_weight.cmp(&other.source_weight))
            .then(self.attribute_rank.cmp(&other.attribute_rank))
            .then(other.word_position.cmp(&self.word_position))
            .then(self.source_health.cmp(&other.source_health))
    }
}

impl PartialOrd for ScoreBreakdown {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dl_known_pairs() {
        assert_eq!(damerau_levenshtein("kitten", "sitten"), 1);
        assert_eq!(damerau_levenshtein("book", "back"), 2);
        assert_eq!(damerau_levenshtein("ca", "abc"), 2);
        assert_eq!(damerau_levenshtein("a", "a"), 0);
        assert_eq!(damerau_levenshtein("", "abc"), 3);
    }

    #[test]
    fn dl_chinese() {
        assert_eq!(damerau_levenshtein("三体", "三体"), 0);
        assert_eq!(damerau_levenshtein("三体", "三题"), 1);
    }

    #[test]
    fn normalize_strips_punct_and_spaces() {
        assert_eq!(normalize_text("三体 (刘慈欣)"), "三体刘慈欣");
        assert_eq!(normalize_text("  Hello,  World!  "), "helloworld");
    }

    #[test]
    fn score_exact_title_match() {
        let s = score("三体", Some("刘慈欣"), Some("科幻小说"), "三体", 0, 1.0);
        assert!(s.words >= 1, "words should be >= 1, got {}", s.words);
        assert!(s.typo >= 250, "typo should be near 255, got {}", s.typo);
        assert_eq!(s.proximity, 0);
        assert!(s.attribute_rank >= 3);
    }

    #[test]
    fn score_author_only_lower_rank() {
        let s_author = score("三体", Some("刘慈欣"), None, "刘慈欣", 0, 1.0);
        let s_title = score("三体", Some("刘慈欣"), None, "三体", 0, 1.0);
        assert!(s_title.attribute_rank >= s_author.attribute_rank);
    }

    #[test]
    fn score_typo_tolerance() {
        let s = score("三体", Some("刘慈欣"), None, "三题", 0, 1.0);
        assert!(
            s.typo >= 200,
            "typo should be > 200 for 1-edit distance, got {}",
            s.typo
        );
    }

    #[test]
    fn compare_lex_title_beats_author() {
        let title_match = score("三体", Some("刘慈欣"), None, "三体", 0, 1.0);
        let author_match = score("三体", Some("刘慈欣"), None, "刘慈欣", 0, 1.0);
        assert!(title_match > author_match, "title match should outrank author match");
    }

    #[test]
    fn compare_lex_source_weight_breaks_tie() {
        let high_weight = score("三体", Some("刘慈欣"), None, "三体", 100, 1.0);
        let low_weight = score("三体", Some("刘慈欣"), None, "三体", 0, 1.0);
        assert!(high_weight > low_weight, "higher source weight should win");
    }
}
