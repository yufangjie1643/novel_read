use rusqlite::{params, Connection};
use serde::Serialize;
use std::time::Instant;

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

pub fn run_fullbook_search<F: FnMut(FullBookSearchEvent)>(
    conn: &Connection,
    book_url: &str,
    keyword: &str,
    mut emit: F,
) {
    let started = Instant::now();
    if keyword.is_empty() {
        emit(FullBookSearchEvent::Failed {
            error: "empty keyword".to_string(),
        });
        return;
    }

    // 1. 查章节总数
    let total_chapters: i32 = match conn.query_row(
        "SELECT COUNT(*) FROM book_chapters WHERE bookUrl = ?1",
        params![book_url],
        |row| row.get(0),
    ) {
        Ok(n) => n,
        Err(e) => {
            emit(FullBookSearchEvent::Failed { error: e.to_string() });
            return;
        }
    };

    emit(FullBookSearchEvent::Started { total_chapters });

    // 2. 拉所有章节（index, title, content）
    let mut stmt = match conn.prepare(
        r#"SELECT bc.chapterIndex, bc.chapterName, COALESCE(cc.content, '')
           FROM book_chapters bc
           LEFT JOIN chapter_contents cc
             ON cc.bookUrl = bc.bookUrl AND cc.chapterUrl = bc.chapterUrl
           WHERE bc.bookUrl = ?1
           ORDER BY bc.chapterIndex"#,
    ) {
        Ok(s) => s,
        Err(e) => {
            emit(FullBookSearchEvent::Failed { error: e.to_string() });
            return;
        }
    };

    let rows = match stmt.query_map(params![book_url], |row| {
        Ok((
            row.get::<_, i32>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }) {
        Ok(r) => r,
        Err(e) => {
            emit(FullBookSearchEvent::Failed { error: e.to_string() });
            return;
        }
    };

    let mut total_hits: i32 = 0;
    let mut scanned: i32 = 0;
    for row in rows {
        let (idx, title, content) = match row {
            Ok(t) => t,
            Err(e) => {
                emit(FullBookSearchEvent::Failed { error: e.to_string() });
                return;
            }
        };
        scanned += 1;
        let count = content.matches(keyword).count();
        if count > 0 {
            let first_pos = content.find(keyword).unwrap_or(0);
            let snippet = build_snippet(&content, first_pos, keyword.len());
            let truncated_count = count.min(PER_CHAPTER_MATCH_LIMIT) as i32;
            total_hits += truncated_count;
            emit(FullBookSearchEvent::Hit {
                chapter_index: idx,
                chapter_title: title.clone(),
                snippet,
                position: first_pos as i32,
                match_count: truncated_count,
            });
        }
        emit(FullBookSearchEvent::ChapterScanned {
            chapter_index: idx,
            scanned,
            total: total_chapters,
        });
    }

    emit(FullBookSearchEvent::Done {
        total_hits,
        elapsed_ms: started.elapsed().as_millis() as i32,
    });
}

fn build_snippet(content: &str, pos: usize, kw_len: usize) -> String {
    let start = pos.saturating_sub(SNIPPET_RADIUS);
    let end = (pos + kw_len + SNIPPET_RADIUS).min(content.len());
    let mut s = String::new();
    if start > 0 {
        s.push('…');
    }
    s.push_str(&content[start..end]);
    if end < content.len() {
        s.push('…');
    }
    s
}
