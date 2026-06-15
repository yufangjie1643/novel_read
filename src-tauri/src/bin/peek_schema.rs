use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args().nth(1).expect("usage: peek_schema <db>");
    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare("PRAGMA table_info(source_stats)")?;
    let mut rows = stmt.query([])?;
    let mut count = 0;
    println!("Columns in source_stats:");
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        let col_type: String = row.get(2)?;
        println!("  {} ({})", name, col_type);
        count += 1;
    }
    println!("--- total: {} columns ---", count);
    Ok(())
}
