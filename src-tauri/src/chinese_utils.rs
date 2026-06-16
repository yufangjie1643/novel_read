//! Simplified/Traditional Chinese conversion utilities.
//!
//! This is a basic port of Android `ChineseUtils.kt`. It covers the most
//! commonly-used characters. For complete conversion a dedicated dictionary
//! (e.g. OpenCC data) should be embedded or loaded at runtime.
//
// The lookup tables are empty in the initial port — the functions fall
// through to the input character. Tables can be filled by a build script
// or a code-generator in a follow-up step.
//
// TODO: generate complete tables from OpenCC data.

/// Convert simplified Chinese to traditional Chinese.
pub fn s2t(text: &str) -> String {
    text.chars()
        .map(|c| lookup_s2t(c).unwrap_or(c))
        .collect()
}

/// Convert traditional Chinese to simplified Chinese.
pub fn t2s(text: &str) -> String {
    text.chars()
        .map(|c| lookup_t2s(c).unwrap_or(c))
        .collect()
}

const S2T_TABLE: [(char, char); 0] = [];
const T2S_TABLE: [(char, char); 0] = [];

fn lookup_s2t(c: char) -> Option<char> {
    match S2T_TABLE.binary_search_by_key(&c, |&(s, _)| s) {
        Ok(idx) => Some(S2T_TABLE[idx].1),
        Err(_) => None,
    }
}

fn lookup_t2s(c: char) -> Option<char> {
    match T2S_TABLE.binary_search_by_key(&c, |&(t, _)| t) {
        Ok(idx) => Some(T2S_TABLE[idx].1),
        Err(_) => None,
    }
}
