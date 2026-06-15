use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args().nth(1).expect("usage: write_rule <db> <name-fragment> <new_content_value>");
    let filter = std::env::args().nth(2).expect("missing name");
    let new_content = std::env::args().nth(3).expect("missing content");

    let conn = Connection::open(PathBuf::from(&db_path))?;
    let new_json = serde_json::json!({ "content": new_content }).to_string();
    let updated = conn.execute(
        "UPDATE book_sources SET ruleContent = ?1 WHERE bookSourceName LIKE ?2",
        rusqlite::params![new_json, format!("%{}%", filter)],
    )?;
    println!("updated {} row(s)", updated);

    // Verify.
    let mut stmt = conn.prepare(
        "SELECT bookSourceName, ruleContent FROM book_sources WHERE bookSourceName LIKE ?1",
    )?;
    let mut rows = stmt.query([format!("%{}%", filter)])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let rc: Option<String> = row.get(1)?;
        println!("=== {} ===", name);
        println!("{}", rc.unwrap_or_else(|| "(None)".to_string()));
    }

    Ok(())
}
