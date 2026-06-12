use legado_desktop_lib as _;

#[test]
fn pool_serves_eight_concurrent_long_held_connections() {
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    let temp = tempdir();
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let start = Instant::now();
    let handles: Vec<_> = (0..8)
        .map(|i| {
            let barrier = Arc::clone(&barrier);
            let db_path = temp.join(format!("stress-{i}.db"));
            thread::spawn(move || -> Result<(), String> {
                barrier.wait();
                let rt = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                rt.block_on(async move {
                    let pool = legado_desktop_lib::db::build_pool(db_path)
                        .expect("build pool");
                    let obj = pool.get().await.expect("get conn");
                    let interact_res = obj
                        .interact(move |conn| -> rusqlite::Result<()> {
                            let row: i64 =
                                conn.query_row("SELECT $1", [i as i64], |r| r.get(0))?;
                            assert_eq!(row, i as i64);
                            Ok(())
                        })
                        .await;
                    match interact_res {
                        Ok(Ok(())) => {}
                        Ok(Err(e)) => return Err(format!("db: {e}")),
                        Err(e) => return Err(format!("interact: {e}")),
                    }
                    std::thread::sleep(Duration::from_millis(50));
                    Ok::<(), String>(())
                })
            })
        })
        .collect();

    for h in handles {
        h.join().expect("thread").expect("inner");
    }
    let elapsed = start.elapsed();
    assert!(
        elapsed >= Duration::from_millis(50),
        "8 threads held conns concurrently for ~50ms; elapsed = {elapsed:?}",
    );
    assert!(
        elapsed < Duration::from_millis(500),
        "stress test should finish well under 500ms; elapsed = {elapsed:?}",
    );
}

#[test]
fn pool_recycles_after_releases() {
    let temp = tempdir();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    rt.block_on(async {
        let pool = legado_desktop_lib::db::build_pool(temp.join("recycle.db"))
            .expect("build pool");
        for round in 0..16 {
            let obj = pool.get().await.expect("get");
            let interact_res = obj
                .interact(move |conn| -> rusqlite::Result<()> {
                    conn.execute(
                        "CREATE TABLE IF NOT EXISTS t (round INTEGER)",
                        [],
                    )?;
                    conn.execute("INSERT INTO t (round) VALUES (?1)", [round])?;
                    Ok(())
                })
                .await;
            match interact_res {
                Ok(Ok(())) => {}
                Ok(Err(e)) => panic!("db: {e}"),
                Err(e) => panic!("interact: {e}"),
            }
        }
    });
}

fn tempdir() -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!(
        "legado-stress-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}
