use serde::Serialize;

pub const PER_CHAPTER_MATCH_LIMIT: usize = 1000;
pub const SNIPPET_RADIUS: usize = 30;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum FullBookSearchEvent {
    Started {
        total_chapters: i32,
    },
    Hit {
        chapter_index: i32,
        chapter_title: String,
        snippet: String,
        position: i32,
        match_count: i32,
    },
    ChapterScanned {
        chapter_index: i32,
        scanned: i32,
        total: i32,
    },
    Done {
        total_hits: i32,
        elapsed_ms: i32,
    },
    Failed {
        error: String,
    },
}
