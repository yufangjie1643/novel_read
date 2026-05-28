pub mod epub_parser;
pub mod txt_parser;

use crate::db::{
    dao::{BookChapterDao, BookDao, ChapterContentDao},
    db,
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
pub fn import_txt_content(content: &str, file_name: &str) -> Result<(Book, usize), ImportError> {
    let (book, parsed_chapters) = txt_parser::parse_txt(content, file_name)?;
    let chapters: Vec<ImportedChapter> = parsed_chapters
        .into_iter()
        .map(|pc| ImportedChapter {
            chapter: pc.chapter,
            content: pc.content,
        })
        .collect();
    save_imported_book(book, chapters)
}

/// Import a TXT book from raw bytes
///
/// Detects text encoding, parses chapters, saves the book and chapters to the database,
/// and stores each chapter's content in chapter_contents.
pub fn import_txt_bytes(data: &[u8], file_name: &str) -> Result<(Book, usize), ImportError> {
    let (book, parsed_chapters) = txt_parser::parse_txt_bytes(data, file_name)?;
    let chapters: Vec<ImportedChapter> = parsed_chapters
        .into_iter()
        .map(|pc| ImportedChapter {
            chapter: pc.chapter,
            content: pc.content,
        })
        .collect();
    save_imported_book(book, chapters)
}

/// Import an EPUB book from raw bytes
///
/// Parses the EPUB into chapters, saves the book and chapters to the database,
/// and stores each chapter's content in chapter_contents.
pub fn import_epub_content(data: &[u8], file_name: &str) -> Result<(Book, usize), ImportError> {
    let (book, parsed_chapters) = epub_parser::parse_epub(data, file_name)?;
    let chapters: Vec<ImportedChapter> = parsed_chapters
        .into_iter()
        .map(|pc| ImportedChapter {
            chapter: pc.chapter,
            content: pc.content,
        })
        .collect();
    save_imported_book(book, chapters)
}

/// Save an imported book and its chapters to the database
fn save_imported_book(
    book: Book,
    parsed_chapters: Vec<ImportedChapter>,
) -> Result<(Book, usize), ImportError> {
    let book_dao = BookDao::new(db());
    let chapter_dao = BookChapterDao::new(db());
    let content_dao = ChapterContentDao::new(db());

    // Check if book already exists (outside transaction)
    if let Ok(Some(_)) = book_dao.get(&book.book_url) {
        return Err(ImportError::AlreadyExists(book.name));
    }

    // Wrap all insertions in a transaction for atomicity
    let mut conn = db().conn();
    let tx = conn.transaction()?;

    book_dao.insert_conn(&tx, &book)?;

    if !parsed_chapters.is_empty() {
        let chapters: Vec<_> = parsed_chapters
            .iter()
            .map(|pc| pc.chapter.clone())
            .collect();
        chapter_dao.insert_many_conn(&tx, &chapters)?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        for pc in &parsed_chapters {
            content_dao.save_conn(&tx, &book.book_url, pc.chapter.index, &pc.content, now)?;
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
