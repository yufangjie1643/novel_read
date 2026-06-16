use rusqlite::{Connection, Result};

use crate::db::{Book, BookDao, BookProgressDao, models::BookProgress};

/// Lightweight progress write used by the reader on chapter flip. Writes
/// only the four progress columns. Falls back to `ensure_row` if no row
/// exists yet (first call after upgrade).
pub fn save(conn: &Connection, p: &BookProgress) -> Result<()> {
    if p.book_url.is_empty() {
        return Err(rusqlite::Error::InvalidParameterName(
            "book_url is required".into(),
        ));
    }
    let dao = BookProgressDao::new(conn);
    let wrote = dao.save_progress_only(
        &p.book_url,
        p.dur_chapter_index,
        p.dur_chapter_pos,
        p.dur_chapter_time,
        p.dur_chapter_title.as_deref(),
    )?;
    if !wrote {
        if let Some(book) = BookDao::new(conn).get(&p.book_url)? {
            dao.ensure_row(&book)?;
        } else {
            dao.upsert(&BookProgress { ..p.clone() })?;
        }
    }
    Ok(())
}

pub fn load(conn: &Connection, book_url: &str) -> Result<Option<BookProgress>> {
    BookProgressDao::new(conn).get(book_url)
}

pub fn load_or_init(conn: &Connection, book: &Book) -> Result<BookProgress> {
    BookProgressDao::new(conn).ensure_row(book)
}
