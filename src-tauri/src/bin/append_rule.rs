use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().expect("usage: append_rule <db> <name-fragment> <new-suffix>");
    let filter = args.next().expect("missing name-fragment");
    let new_suffix = args.next().expect("missing new-suffix");

    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare(
        "SELECT bookSourceUrl, bookSourceName, ruleContent FROM book_sources WHERE bookSourceName LIKE ?1",
    )?;
    let mut rows = stmt.query([format!("%{}%", filter)])?;
    let mut updated = 0usize;
    while let Some(row) = rows.next()? {
        let url: String = row.get(0)?;
        let name: String = row.get(1)?;
        let rule_content: Option<String> = row.get(2)?;
        let rule_content = match rule_content {
            Some(s) => s,
            None => continue,
        };
        // Append the new rule with a "&&" chain (Legado rule separator
        // for chaining multiple rules).
        let new = format!("{}&&{}", rule_content, new_suffix);
        conn.execute(
            "UPDATE book_sources SET ruleContent = ?1 WHERE bookSourceUrl = ?2",
            rusqlite::params![new, url],
        )?;
        println!("[ok] {} ({}) : ruleContent appended with &&", name, url);
        updated += 1;
    }
    println!("--- updated {} source(s) ---", updated);
    Ok(())
}
