//! Integration test for the `refresh_rule_sub_sources` IPC's DB upsert path.
//!
//! Verifies that the helper (`commands::upsert_rule_sub_sources`):
//! - Inserts new rows for sources whose `book_source_url` is not yet in
//!   the `book_sources` table.
//! - Updates the existing row when a source URL is already present
//!   (idempotent re-runs).
//! - Bumps `rule_subs.last_update_time` after a successful refresh.
//! - Returns the count of sources that were actually inserted or updated.

use rusqlite::Connection;

use legado_desktop_lib::{
    commands::upsert_rule_sub_sources,
    db::{
        dao::{BookSourceDao, RuleSubDao},
        migrations::run_migrations,
        models::{BookSource, RuleSub},
    },
};

fn fresh_db() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory db");
    run_migrations(&conn).expect("migrations");
    conn
}

fn sample_source(url: &str, name: &str) -> BookSource {
    BookSource {
        book_source_url: url.to_string(),
        book_source_name: name.to_string(),
        enabled: true,
        ..BookSource::default()
    }
}

#[test]
fn upsert_inserts_new_sources_and_bumps_rule_sub_timestamp() {
    let mut conn = fresh_db();

    let sub_id = RuleSubDao::new(&conn)
        .insert(&RuleSub {
            id: None,
            name: Some("test".to_string()),
            url: Some("https://example.invalid/sources.json".to_string()),
            sub_type: 0,
            custom_order: 0,
            enabled: true,
            auto_update: false,
            last_update_time: 0,
        })
        .expect("insert rule sub");

    let sources = vec![
        sample_source("https://a.example/", "A"),
        sample_source("https://b.example/", "B"),
        sample_source("https://c.example/", "C"),
    ];

    let touched = upsert_rule_sub_sources(&mut conn, sub_id, sources, 12345)
        .expect("upsert");
    assert_eq!(touched, 3, "all 3 sources should be inserted");

    let all = BookSourceDao::new(&conn).get_all().expect("get_all");
    assert_eq!(all.len(), 3, "table has 3 rows");
    assert!(all.iter().all(|s| s.last_update_time == 12345));

    let sub = RuleSubDao::new(&conn)
        .get_all()
        .expect("get subs")
        .into_iter()
        .find(|s| s.id == Some(sub_id))
        .expect("rule sub present");
    assert_eq!(sub.last_update_time, 12345, "rule sub timestamp bumped");
}

#[test]
fn upsert_updates_existing_sources_idempotently() {
    let mut conn = fresh_db();
    let sub_id = RuleSubDao::new(&conn)
        .insert(&RuleSub {
            id: None,
            name: Some("test".to_string()),
            url: Some("https://example.invalid/sources.json".to_string()),
            sub_type: 0,
            custom_order: 0,
            enabled: true,
            auto_update: false,
            last_update_time: 0,
        })
        .expect("insert rule sub");

    let first_pass = vec![sample_source("https://a.example/", "A-v1")];
    let touched1 = upsert_rule_sub_sources(&mut conn, sub_id, first_pass, 100)
        .expect("first pass");
    assert_eq!(touched1, 1);

    // Second pass with same URL but different name + newer timestamp.
    // The helper should UPDATE, not insert a duplicate, and the row should
    // reflect the new name and timestamp.
    let second_pass = vec![sample_source("https://a.example/", "A-v2")];
    let touched2 = upsert_rule_sub_sources(&mut conn, sub_id, second_pass, 200)
        .expect("second pass");
    assert_eq!(touched2, 1, "still reports 1 source touched (updated)");

    let all = BookSourceDao::new(&conn).get_all().expect("get_all");
    assert_eq!(all.len(), 1, "no duplicate row inserted");
    assert_eq!(all[0].book_source_name, "A-v2", "row was updated");
    assert_eq!(all[0].last_update_time, 200, "timestamp refreshed");
}

#[test]
fn upsert_mixed_insert_and_update() {
    let mut conn = fresh_db();
    let sub_id = RuleSubDao::new(&conn)
        .insert(&RuleSub {
            id: None,
            name: Some("test".to_string()),
            url: Some("https://example.invalid/sources.json".to_string()),
            sub_type: 0,
            custom_order: 0,
            enabled: true,
            auto_update: false,
            last_update_time: 0,
        })
        .expect("insert rule sub");

    // Pre-seed one source so the next refresh has to update it.
    BookSourceDao::new(&conn)
        .insert(&sample_source("https://existing.example/", "Existing"))
        .expect("pre-seed");

    let sources = vec![
        sample_source("https://existing.example/", "Existing-v2"),
        sample_source("https://new.example/", "New"),
    ];
    let touched = upsert_rule_sub_sources(&mut conn, sub_id, sources, 999)
        .expect("upsert");
    assert_eq!(touched, 2, "one updated + one inserted");

    let all = BookSourceDao::new(&conn).get_all().expect("get_all");
    assert_eq!(all.len(), 2, "no extra row created");
    let names: Vec<_> = all.iter().map(|s| s.book_source_name.as_str()).collect();
    assert!(names.contains(&"Existing-v2"), "existing row updated");
    assert!(names.contains(&"New"), "new row inserted");
}
