use rusqlite::{Connection, Result};

use crate::db::{BookProgressDao, models::BookProgress};

pub fn save(conn: &Connection, progress: &BookProgress) -> Result<()> {
    BookProgressDao::new(conn).save(progress)
}
