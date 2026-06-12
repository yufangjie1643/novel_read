pub mod epub_parser;
pub mod txt_parser;

use crate::db::{
    dao::{BookChapterDao, BookDao, ChapterContentDao},
    models::{Book, BookChapter},
};

/// Common structure for a parsed chapter with content
pub struct ImportedChapter {
    pub chapter: BookChapter,
    pub content: String,
}

/// Import a TXT book from raw text content
///
/// Parses the text into chapters, saves the book and chapters to the database,
/// and stores each chapter's content in chapter_contents.
pub fn import_txt_content(
    conn: &mut rusqlite::Connection,
    content: &str,
    file_name: &str,
) -> Result<(Book, usize), ImportError> {
    let (book, parsed_chapters) = txt_parser::parse_txt(content, file_name)?;
    let chapters: Vec<ImportedChapter> = parsed_chapters
        .into_iter()
        .map(|pc| ImportedChapter {
            chapter: pc.chapter,
            content: pc.content,
        })
        .collect();
    save_imported_book(conn, book, chapters)
}

/// Import a TXT book from raw bytes
///
/// Detects text encoding, parses chapters, saves the book and chapters to the database,
/// and stores each chapter's content in chapter_contents.
pub fn import_txt_bytes(
    conn: &mut rusqlite::Connection,
    data: &[u8],
    file_name: &str,
) -> Result<(Book, usize), ImportError> {
    let (book, parsed_chapters) = txt_parser::parse_txt_bytes(data, file_name)?;
    let chapters: Vec<ImportedChapter> = parsed_chapters
        .into_iter()
        .map(|pc| ImportedChapter {
            chapter: pc.chapter,
            content: pc.content,
        })
        .collect();
    save_imported_book(conn, book, chapters)
}

/// Import an EPUB book from raw bytes
///
/// Parses the EPUB into chapters, saves the book and chapters to the database,
/// and stores each chapter's content in chapter_contents.
pub fn import_epub_content(
    conn: &mut rusqlite::Connection,
    data: &[u8],
    file_name: &str,
) -> Result<(Book, usize), ImportError> {
    let (book, parsed_chapters) = epub_parser::parse_epub(data, file_name)?;
    let chapters: Vec<ImportedChapter> = parsed_chapters
        .into_iter()
        .map(|pc| ImportedChapter {
            chapter: pc.chapter,
            content: pc.content,
        })
        .collect();
    save_imported_book(conn, book, chapters)
}

/// Save an imported book and its chapters to the database
fn save_imported_book(
    conn: &mut rusqlite::Connection,
    book: Book,
    parsed_chapters: Vec<ImportedChapter>,
) -> Result<(Book, usize), ImportError> {
    if let Ok(Some(_)) = BookDao::new(&*conn).get(&book.book_url) {
        return Err(ImportError::AlreadyExists(book.name));
    }

    let tx = conn.transaction()?;

    BookDao::new(&tx).insert_conn(&tx, &book)?;

    if !parsed_chapters.is_empty() {
        let chapters: Vec<_> = parsed_chapters
            .iter()
            .map(|pc| pc.chapter.clone())
            .collect();
        BookChapterDao::new(&tx).insert_many_conn(&tx, &chapters)?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        for pc in &parsed_chapters {
            ChapterContentDao::new(&tx).save_conn(
                &tx,
                &book.book_url,
                pc.chapter.index,
                &pc.content,
                now,
            )?;
        }
    }

    tx.commit()?;
    Ok((book, parsed_chapters.len()))
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("Parse error: {0}")]
    Parse(#[from] txt_parser::TxtParseError),
    #[error("EPUB parse error: {0}")]
    EpubParse(#[from] epub_parser::EpubParseError),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Book '{0}' already exists in bookshelf")]
    AlreadyExists(String),
}
