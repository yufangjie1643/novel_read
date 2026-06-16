use rusqlite::{Connection, Result};

use crate::db::{BookDao, models::Book};

pub fn list_all(conn: &Connection) -> Result<Vec<Book>> {
    BookDao::new(conn).get_all()
}

pub fn get(conn: &Connection, book_url: &str) -> Result<Option<Book>> {
    BookDao::new(conn).get(book_url)
}

pub fn insert(conn: &Connection, book: &Book) -> Result<()> {
    BookDao::new(conn).insert(book)
}

pub fn update(conn: &Connection, book: &Book) -> Result<()> {
    BookDao::new(conn).update(book)
}

pub fn delete(conn: &Connection, book_url: &str) -> Result<()> {
    BookDao::new(conn).delete(book_url)
}
