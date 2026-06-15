use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let db_path = args.next().expect("usage: bump_reversed <db> --all | <name-fragment>...");
    let filters: Vec<String> = args.collect();
    let all = filters.iter().any(|s| s == "--all");

    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare(
        "SELECT bookSourceUrl, bookSourceName, ruleToc FROM book_sources WHERE ruleToc LIKE '%chapterList%'",
    )?;
    let mut rows = stmt.query([])?;
    let mut updated = 0usize;
    let mut considered = 0usize;
    while let Some(row) = rows.next()? {
        let url: String = row.get(0)?;
        let name: String = row.get(1)?;
        let rule_toc: Option<String> = row.get(2)?;
        let rule_toc = match rule_toc {
            Some(s) => s,
            None => continue,
        };
        let parsed: serde_json::Value = match serde_json::from_str(&rule_toc) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let mut obj = match parsed.as_object().cloned() {
            Some(o) => o,
            None => continue,
        };
        let cl = obj
            .get("chapterList")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let cl = match cl {
            Some(s) => s,
            None => continue,
        };
        if cl.starts_with('-') {
            println!("[skip] already reversed: {} ({})", name, url);
            continue;
        }
        let matched = all
            || filters
                .iter()
                .any(|s| name.contains(s.as_str()) || url.contains(s.as_str()));
        if !matched {
            continue;
        }
        considered += 1;
        obj.insert(
            "chapterList".to_string(),
            serde_json::Value::String(format!("-{}", cl)),
        );
        let new_json = serde_json::to_string(&obj)?;
        conn.execute(
            "UPDATE book_sources SET ruleToc = ?1 WHERE bookSourceUrl = ?2",
            rusqlite::params![new_json, url],
        )?;
        println!("[ok]   {} ({}) : {} -> -{}", name, url, cl, cl);
        updated += 1;
    }
    println!("--- considered {} updated {} ---", considered, updated);
    Ok(())
}
