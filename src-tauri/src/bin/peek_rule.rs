use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args().nth(1).expect("usage: peek_rule <db> [name-filter]");
    let filter = std::env::args().nth(2);
    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare(
        "SELECT bookSourceName, bookSourceUrl, ruleToc FROM book_sources",
    )?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let url: String = row.get(1)?;
        let rule_toc: Option<String> = row.get(2)?;
        let matched = match &filter {
            Some(f) => name.contains(f) || url.contains(f),
            None => true,
        };
        if !matched {
            continue;
        }
        if let Some(r) = rule_toc {
            let parsed: serde_json::Value = serde_json::from_str(&r).unwrap_or(serde_json::Value::Null);
            let cl = parsed.get("chapterList").and_then(|v| v.as_str()).map(|s| s.to_string());
            let cl_repr = cl.clone().unwrap_or_else(|| "<none>".to_string());
            let starts_with_dash = cl.as_deref().map(|s| s.starts_with('-')).unwrap_or(false);
            println!("{} ({}) | starts_with_dash={} | cl={}", name, url, starts_with_dash, cl_repr);
        }
    }
    // Also show ruleContent
    let mut stmt = conn.prepare("SELECT bookSourceName, ruleContent FROM book_sources")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(0)?;
        let rule_content: Option<String> = row.get(1)?;
        let matched = match &filter {
            Some(f) => name.contains(f),
            None => true,
        };
        if matched {
            if let Some(rc) = rule_content {
                let parsed: serde_json::Value = serde_json::from_str(&rc).unwrap_or(serde_json::Value::Null);
                let content = parsed.get("content").and_then(|v| v.as_str()).map(|s| s.to_string());
                println!("  ruleContent: {}", content.unwrap_or_else(|| "<none>".to_string()));
            }
        }
    }
    Ok(())
}
