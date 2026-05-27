pub mod txt_parser;

use txt_parser::parse_txt;
use crate::db::{
    dao::{BookChapterDao, BookDao},
    db,
    models::Book,
};

/// Import a TXT book from raw text content
///
/// Parses the text into chapters and saves both the book and chapters to the database.
/// Returns the created book and number of chapters.
pub fn import_txt_content(content: &str, file_name: &str) -> Result<(Book, usize), ImportError> {
    let (book, chapters) = parse_txt(content, file_name)?;

    let book_dao = BookDao::new(db());
    let chapter_dao = BookChapterDao::new(db());

    // Check if book already exists
    if let Ok(Some(_)) = book_dao.get(&book.book_url) {
        return Err(ImportError::AlreadyExists(book.name));
    }

    // Insert book
    book_dao.insert(&book)?;

    // Insert chapters (batch transaction)
    if !chapters.is_empty() {
        chapter_dao.insert_many(&chapters)?;
    }

    Ok((book, chapters.len()))
}

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("Parse error: {0}")]
    Parse(#[from] txt_parser::TxtParseError),
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("Book '{0}' already exists in bookshelf")]
    AlreadyExists(String),
}
