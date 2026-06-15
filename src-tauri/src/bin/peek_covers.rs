use rusqlite::Connection;

fn main() {
    let db_path = std::env::args()
        .nth(1)
        .expect("usage: peek_covers <legado.db>");
    let conn = Connection::open(&db_path).expect("open db");

    let mut stmt = conn
        .prepare("SELECT name, author, coverUrl, customCoverUrl, origin FROM books")
        .expect("prepare");
    let rows = stmt
        .query_map([], |row| {
            let name: String = row.get(0).unwrap_or_default();
            let author: String = row.get(1).unwrap_or_default();
            let cover: Option<String> = row.get(2).ok();
            let custom: Option<String> = row.get(3).ok();
            let origin: String = row.get(4).unwrap_or_default();
            Ok((name, author, cover, custom, origin))
        })
        .expect("query");

    let mut n = 0;
    for r in rows {
        let (name, author, cover, custom, origin) = r.unwrap();
        n += 1;
        println!(
            "#{n} name='{name}' author='{author}' cover={:?} customCover={:?} origin='{origin}'",
            cover.as_deref().unwrap_or("<null>"),
            custom.as_deref().unwrap_or("<null>"),
        );
        if n >= 40 {
            break;
        }
    }
    println!("---\ntotal shown: {n}");
}
