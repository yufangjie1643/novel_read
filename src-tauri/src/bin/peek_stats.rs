use rusqlite::Connection;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let db_path = std::env::args().nth(1).expect("usage: peek_stats <db>");
    let conn = Connection::open(PathBuf::from(&db_path))?;
    let mut stmt = conn.prepare(
        "SELECT sourceUrl, total_queries, successful_queries, errored_queries, timed_out_queries, last_error_message, health_score, last_checked_at FROM source_stats ORDER BY health_score DESC LIMIT 20",
    )?;
    let mut rows = stmt.query([])?;
    println!("sourceUrl | total | ok | err | timeout | health | lastError | lastChecked");
    while let Some(row) = rows.next()? {
        let url: String = row.get(0)?;
        let total: i64 = row.get(1)?;
        let ok: i64 = row.get(2)?;
        let err: i64 = row.get(3)?;
        let timeout: i64 = row.get(4)?;
        let last_err: Option<String> = row.get(5)?;
        let health: f64 = row.get(6)?;
        let last_checked: i64 = row.get(7)?;
        let display_url: String = url.chars().take(50).collect();
        println!("{} | {} | {} | {} | {} | {:.3} | {:?} | {}",
            display_url, total, ok, err, timeout, health,
            last_err.as_deref().map(|s| s.chars().take(40).collect::<String>()).unwrap_or_default(),
            last_checked);
    }
    // Also show count
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM source_stats", [], |r| r.get(0))?;
    println!("--- total: {} source(s) have stats ---", count);
    Ok(())
}
