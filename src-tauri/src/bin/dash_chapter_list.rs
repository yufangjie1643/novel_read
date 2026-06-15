use rusqlite::Connection;
use std::path::PathBuf;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Add,
    Remove,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mode_str = args.next().expect("usage: dash_chapter_list <add|remove> <db> <name-fragment>...");
    let mode = match mode_str.as_str() {
        "add" => Mode::Add,
        "remove" => Mode::Remove,
        _ => panic!("mode must be 'add' or 'remove', got {:?}", mode_str),
    };
    let db_path = args.next().expect("missing db path");
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
        let matched = all
            || filters
                .iter()
                .any(|s| name.contains(s.as_str()) || url.contains(s.as_str()));
        if !matched {
            continue;
        }
        considered += 1;
        let new_cl = match mode {
            Mode::Add => {
                if cl.starts_with('-') {
                    println!("[skip] already has dash: {} ({})", name, url);
                    continue;
                }
                format!("-{}", cl)
            }
            Mode::Remove => {
                match cl.strip_prefix('-') {
                    Some(s) => s.to_string(),
                    None => {
                        println!("[skip] no dash to remove: {} ({})", name, url);
                        continue;
                    }
                }
            }
        };
        obj.insert(
            "chapterList".to_string(),
            serde_json::Value::String(new_cl.clone()),
        );
        let new_json = serde_json::to_string(&obj)?;
        conn.execute(
            "UPDATE book_sources SET ruleToc = ?1 WHERE bookSourceUrl = ?2",
            rusqlite::params![new_json, url],
        )?;
        println!("[ok]   {} ({}) : {} -> {}", name, url, cl, new_cl);
        updated += 1;
    }
    println!("--- considered {} updated {} ---", considered, updated);
    Ok(())
}
