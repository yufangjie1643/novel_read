use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args().nth(1).expect("usage: peek_raw <db> [name-fragment|--js]");
    let filter = std::env::args().nth(2);
    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare(
        "SELECT bookSourceName, ruleContent FROM book_sources",
    )?;
    let mut rows = stmt.query([])?;
    let mut count = 0;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let rc: Option<String> = row.get(1)?;
        let rc_str = rc.as_deref().unwrap_or("");
        let match_filter = match &filter {
            Some(f) if f == "--js" => rc_str.contains("@js:") || rc_str.contains("@js\n"),
            Some(f) => name.contains(f.as_str()) || rc_str.contains(f.as_str()),
            None => true,
        };
        if !match_filter {
            continue;
        }
        println!("=== {} ===", name);
        if rc_str.contains("@js:") {
            // Pretty print the @js block
            println!("(contains @js: rule)");
        }
        if let Some(s) = rc {
            println!("{}", &s[..s.len().min(600)]);
        } else {
            println!("(None)");
        }
        println!();
        count += 1;
        if count > 30 {
            println!("... (showing first 30 matches)");
            break;
        }
    }
    Ok(())
}
