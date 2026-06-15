use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args().nth(1).expect("usage: peek_book <db> [name-fragment]");
    let filter = std::env::args().nth(2);
    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare(
        "SELECT bookUrl, name, author, origin, totalChapterNum FROM books",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let url: String = row.get(0)?;
        let name: String = row.get(1)?;
        let author: String = row.get(2)?;
        let origin: String = row.get(3)?;
        let total: i32 = row.get(4)?;
        let matched = match &filter {
            Some(f) => name.contains(f) || url.contains(f),
            None => true,
        };
        if matched {
            println!("{} | {} | {} | {} chapters", name, author, url, total);
            println!("  origin: {}", origin);
        }
    }
    Ok(())
}
