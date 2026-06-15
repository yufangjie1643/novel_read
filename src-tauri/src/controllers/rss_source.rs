use rusqlite::{Connection, Result};

use crate::db::{RssSourceDao, models::RssSource};

pub fn list_all(conn: &Connection) -> Result<Vec<RssSource>> {
    RssSourceDao::new(conn).get_all()
}

pub fn get(conn: &Connection, url: &str) -> Result<Option<RssSource>> {
    RssSourceDao::new(conn).get(url)
}

pub fn insert(conn: &Connection, source: &RssSource) -> Result<()> {
    RssSourceDao::new(conn).insert(source)
}

pub fn insert_many(conn: &Connection, sources: &[RssSource]) -> Result<usize> {
    RssSourceDao::new(conn).insert_many(sources)
}

pub fn update(conn: &Connection, source: &RssSource) -> Result<()> {
    RssSourceDao::new(conn).update(source)
}

pub fn delete(conn: &Connection, url: &str) -> Result<()> {
    RssSourceDao::new(conn).delete(url)
}
