use rusqlite::{Connection, Result};

use crate::db::{BookSourceDao, models::BookSource};

pub fn list_all(conn: &Connection) -> Result<Vec<BookSource>> {
    BookSourceDao::new(conn).get_all()
}

pub fn list_enabled(conn: &Connection) -> Result<Vec<BookSource>> {
    BookSourceDao::new(conn).get_enabled()
}

pub fn get(conn: &Connection, url: &str) -> Result<Option<BookSource>> {
    BookSourceDao::new(conn).get(url)
}

pub fn insert(conn: &Connection, source: &BookSource) -> Result<()> {
    BookSourceDao::new(conn).insert(source)
}

pub fn insert_many(conn: &Connection, sources: &[BookSource]) -> Result<usize> {
    BookSourceDao::new(conn).insert_many(sources)
}

pub fn update(conn: &Connection, source: &BookSource) -> Result<()> {
    BookSourceDao::new(conn).update(source)
}

pub fn delete(conn: &Connection, url: &str) -> Result<()> {
    BookSourceDao::new(conn).delete(url)
}
