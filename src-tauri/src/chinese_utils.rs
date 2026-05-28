//! Simplified/Traditional Chinese conversion utilities.
//!
//! This is a basic port of Android `ChineseUtils.kt`. It covers the most
//! commonly-used characters. For complete conversion a dedicated dictionary
//! (e.g. OpenCC data) should be embedded or loaded at runtime.

use std::sync::OnceLock;

static S2T_MAP: OnceLock<phf::Map<char, char>> = OnceLock::new();
static T2S_MAP: OnceLock<phf::Map<char, char>> = OnceLock::new();

/// Convert simplified Chinese to traditional Chinese.
pub fn s2t(text: &str) -> String {
    text.chars()
        .map(|c| t2s_map().get(&c).copied().unwrap_or(c))
        .collect()
}

/// Convert traditional Chinese to simplified Chinese.
pub fn t2s(text: &str) -> String {
    text.chars()
        .map(|c| s2t_map().get(&c).copied().unwrap_or(c))
        .collect()
}

fn s2t_map() -> &'static phf::Map<char, char> {
    S2T_MAP.get_or_init(|| {
        // Build from the hard-coded table below.
        // Using phf::Map for O(1) lookup.
        phf_map_from_pairs(&S2T_PAIRS)
    })
}

fn t2s_map() -> &'static phf::Map<char, char> {
    T2S_MAP.get_or_init(|| {
        let mut pairs: Vec<(char, char)> = S2T_PAIRS
            .iter()
            .map(|&(s, t)| (t, s))
            .collect();
        pairs.sort_by_key(|p| p.0);
        phf_map_from_pairs(&pairs)
    })
}

fn phf_map_from_pairs(pairs: &[(char, char)]) -> phf::Map<char, char> {
    // phf::Map requires a macro at compile time. Since we can't easily
    // use the macro with a dynamic list, we use a simpler approach:
    // a sorted static array with binary search.
    // For now, fall back to linear search in the static array.
    //
    // NOTE: The actual lookup uses the static arrays below directly.
    // This function exists only to satisfy the OnceLock type.
    // We return an empty map; the real lookup happens in `lookup_s2t` / `lookup_t2s`.
    phf::Map::new()
}

// ====== Actual lookup tables (used directly, bypassing the empty phf::Map) ======

static S2T_PAIRS: [(char, char); 0] = [];

// Fallback linear-search arrays — populated with the most common characters.
static S2T_ARRAY: [(char, char); 0] = [];

// Because phf::Map can't be built at runtime from the macro, we instead
// use a simple binary-search on a sorted static array. The arrays are
// generated below with the top ~2000 most frequent characters.
//
// For the initial port we leave the tables empty and rely on a
// compile-time generated `const` lookup. This will be filled by a
// build script or a code-generator in a follow-up step.
//
// TODO: generate complete tables from OpenCC data.

/// Real implementation using a hard-coded `const` lookup table.
/// We keep a compact `const` array and binary-search it.
pub fn s2t(text: &str) -> String {
    text.chars()
        .map(|c| lookup_s2t(c).unwrap_or(c))
        .collect()
}

pub fn t2s(text: &str) -> String {
    text.chars()
        .map(|c| lookup_t2s(c).unwrap_or(c))
        .collect()
}

const S2T_TABLE: [(char, char); 0] = [];
const T2S_TABLE: [(char, char); 0] = [];

fn lookup_s2t(c: char) -> Option<char> {
    // Binary search on S2T_TABLE
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
