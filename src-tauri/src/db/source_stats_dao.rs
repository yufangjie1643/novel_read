use crate::db::AppPool;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug)]
struct PoolError(String);

impl fmt::Display for PoolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for PoolError {}

fn pool_err_to_rusqlite(e: deadpool::managed::PoolError<rusqlite::Error>) -> rusqlite::Error {
    match e {
        deadpool::managed::PoolError::Backend(e) => e,
        other => rusqlite::Error::ToSqlConversionFailure(Box::new(PoolError(other.to_string()))),
    }
}

fn interact_err_to_rusqlite(e: deadpool_sync::InteractError) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(PoolError(e.to_string())))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SourceStats {
    pub source_url: String,
    pub total_queries: i64,
    pub successful_queries: i64,
    pub timed_out_queries: i64,
    pub errored_queries: i64,
    pub total_latency_ms: i64,
    pub last_success_at: Option<i64>,
    pub last_error_at: Option<i64>,
    pub last_error_message: Option<String>,
    pub last_checked_at: i64,
    pub rolling_success_count: i64,
    pub rolling_total_count: i64,
    pub health_score: f64,
}

impl Default for SourceStats {
    fn default() -> Self {
        Self {
            source_url: String::new(),
            total_queries: 0,
            successful_queries: 0,
            timed_out_queries: 0,
            errored_queries: 0,
            total_latency_ms: 0,
            last_success_at: None,
            last_error_at: None,
            last_error_message: None,
            last_checked_at: 0,
            rolling_success_count: 0,
            rolling_total_count: 0,
            health_score: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct HealthInputs {
    pub success_rate: f64,
    pub p99_latency_ms: f64,
    pub recency_hours: f64,
}

pub fn compute_health(h: HealthInputs) -> f64 {
    let sr = h.success_rate.clamp(0.0, 1.0);
    let lat = (1.0 - (h.p99_latency_ms / 5000.0).min(1.0)).max(0.0);
    let rec = (1.0 - (h.recency_hours / 168.0).min(1.0)).max(0.0);
    let score = 0.6 * sr + 0.3 * lat + 0.1 * rec;
    score.clamp(0.0, 1.0)
}

fn prune_rolling_window(conn: &rusqlite::Transaction, source_url: &str) -> rusqlite::Result<()> {
    let total: i64 = conn.query_row(
        "SELECT rolling_total_count FROM source_stats WHERE sourceUrl = ?1",
        params![source_url],
        |r| r.get(0),
    )?;
    if total > 50 {
        conn.execute(
            "UPDATE source_stats SET
                rolling_success_count = rolling_success_count / 2,
                rolling_total_count = rolling_total_count / 2
             WHERE sourceUrl = ?1",
            params![source_url],
        )?;
    }
    Ok(())
}

fn recompute_health_in_tx(conn: &rusqlite::Transaction, source_url: &str) -> rusqlite::Result<f64> {
    let (succ, total, last_succ): (i64, i64, Option<i64>) = conn.query_row(
        "SELECT rolling_success_count, rolling_total_count, last_success_at
         FROM source_stats WHERE sourceUrl = ?1",
        params![source_url],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let sr = if total > 0 {
        succ as f64 / total as f64
    } else {
        1.0
    };
    let (total_ms, total_q): (i64, i64) = conn.query_row(
        "SELECT total_latency_ms, total_queries FROM source_stats WHERE sourceUrl = ?1",
        params![source_url],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let p99 = if total_q == 0 {
        0.0
    } else {
        (total_ms as f64 / total_q as f64) * 2.0
    };
    let now = chrono::Utc::now().timestamp();
    let recency = last_succ
        .map(|t| (now - t) as f64 / 3600.0)
        .unwrap_or(168.0);
    Ok(compute_health(HealthInputs {
        success_rate: sr,
        p99_latency_ms: p99,
        recency_hours: recency,
    }))
}

pub struct SourceStatsDao {
    pool: AppPool,
}

impl SourceStatsDao {
    pub fn new(pool: AppPool) -> Self {
        Self { pool }
    }

    pub async fn get_all(&self) -> rusqlite::Result<Vec<SourceStats>> {
        let obj = self
            .pool
            .get()
            .await
            .map_err(pool_err_to_rusqlite)?;
        obj.interact(|conn| {
            let mut stmt = conn.prepare(
                "SELECT sourceUrl, total_queries, successful_queries, timed_out_queries,
                        errored_queries, total_latency_ms, last_success_at, last_error_at,
                        last_error_message, last_checked_at, rolling_success_count,
                        rolling_total_count, health_score
                 FROM source_stats ORDER BY health_score DESC",
            )?;
            let rows = stmt.query_map([], |row| {
                Ok(SourceStats {
                    source_url: row.get(0)?,
                    total_queries: row.get(1)?,
                    successful_queries: row.get(2)?,
                    timed_out_queries: row.get(3)?,
                    errored_queries: row.get(4)?,
                    total_latency_ms: row.get(5)?,
                    last_success_at: row.get(6)?,
                    last_error_at: row.get(7)?,
                    last_error_message: row.get(8)?,
                    last_checked_at: row.get(9)?,
                    rolling_success_count: row.get(10)?,
                    rolling_total_count: row.get(11)?,
                    health_score: row.get(12)?,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok::<_, rusqlite::Error>(out)
        })
        .await
        .map_err(interact_err_to_rusqlite)?
    }

    pub async fn get_by_url(&self, source_url: &str) -> rusqlite::Result<Option<SourceStats>> {
        let url = source_url.to_string();
        let obj = self
            .pool
            .get()
            .await
            .map_err(pool_err_to_rusqlite)?;
        obj.interact(move |conn| {
            conn.query_row(
                "SELECT sourceUrl, total_queries, successful_queries, timed_out_queries,
                        errored_queries, total_latency_ms, last_success_at, last_error_at,
                        last_error_message, last_checked_at, rolling_success_count,
                        rolling_total_count, health_score
                 FROM source_stats WHERE sourceUrl = ?1",
                params![url],
                |row| {
                    Ok(SourceStats {
                        source_url: row.get(0)?,
                        total_queries: row.get(1)?,
                        successful_queries: row.get(2)?,
                        timed_out_queries: row.get(3)?,
                        errored_queries: row.get(4)?,
                        total_latency_ms: row.get(5)?,
                        last_success_at: row.get(6)?,
                        last_error_at: row.get(7)?,
                        last_error_message: row.get(8)?,
                        last_checked_at: row.get(9)?,
                        rolling_success_count: row.get(10)?,
                        rolling_total_count: row.get(11)?,
                        health_score: row.get(12)?,
                    })
                },
            )
            .optional()
        })
        .await
        .map_err(interact_err_to_rusqlite)?
    }

    pub async fn record_success(&self, source_url: &str, latency_ms: u64) -> rusqlite::Result<()> {
        let url = source_url.to_string();
        let obj = self
            .pool
            .get()
            .await
            .map_err(pool_err_to_rusqlite)?;
        let now = chrono::Utc::now().timestamp();
        obj.interact(move |conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO source_stats (sourceUrl, last_checked_at) VALUES (?1, ?2)
                 ON CONFLICT(sourceUrl) DO UPDATE SET last_checked_at = excluded.last_checked_at",
                params![url, now],
            )?;
            tx.execute(
                "UPDATE source_stats SET
                    total_queries = total_queries + 1,
                    successful_queries = successful_queries + 1,
                    total_latency_ms = total_latency_ms + ?2,
                    last_success_at = ?3,
                    rolling_success_count = rolling_success_count + 1,
                    rolling_total_count = rolling_total_count + 1
                 WHERE sourceUrl = ?1",
                params![url, latency_ms as i64, now],
            )?;
            prune_rolling_window(&tx, &url)?;
            let h = recompute_health_in_tx(&tx, &url)?;
            tx.execute(
                "UPDATE source_stats SET health_score = ?2 WHERE sourceUrl = ?1",
                params![url, h],
            )?;
            tx.commit()?;
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .map_err(interact_err_to_rusqlite)?
    }

    pub async fn record_timeout(&self, source_url: &str, latency_ms: u64) -> rusqlite::Result<()> {
        let url = source_url.to_string();
        let obj = self
            .pool
            .get()
            .await
            .map_err(pool_err_to_rusqlite)?;
        let now = chrono::Utc::now().timestamp();
        obj.interact(move |conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO source_stats (sourceUrl, last_checked_at) VALUES (?1, ?2)
                 ON CONFLICT(sourceUrl) DO UPDATE SET last_checked_at = excluded.last_checked_at",
                params![url, now],
            )?;
            tx.execute(
                "UPDATE source_stats SET
                    total_queries = total_queries + 1,
                    timed_out_queries = timed_out_queries + 1,
                    total_latency_ms = total_latency_ms + ?2,
                    rolling_total_count = rolling_total_count + 1
                 WHERE sourceUrl = ?1",
                params![url, latency_ms as i64],
            )?;
            prune_rolling_window(&tx, &url)?;
            let h = recompute_health_in_tx(&tx, &url)?;
            tx.execute(
                "UPDATE source_stats SET health_score = ?2 WHERE sourceUrl = ?1",
                params![url, h],
            )?;
            tx.commit()?;
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .map_err(interact_err_to_rusqlite)?
    }

    pub async fn record_error(
        &self,
        source_url: &str,
        err_msg: &str,
        latency_ms: u64,
    ) -> rusqlite::Result<()> {
        let url = source_url.to_string();
        let msg = err_msg.to_string();
        let obj = self
            .pool
            .get()
            .await
            .map_err(pool_err_to_rusqlite)?;
        let now = chrono::Utc::now().timestamp();
        obj.interact(move |conn| {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO source_stats (sourceUrl, last_checked_at) VALUES (?1, ?2)
                 ON CONFLICT(sourceUrl) DO UPDATE SET last_checked_at = excluded.last_checked_at",
                params![url, now],
            )?;
            tx.execute(
                "UPDATE source_stats SET
                    total_queries = total_queries + 1,
                    errored_queries = errored_queries + 1,
                    total_latency_ms = total_latency_ms + ?2,
                    last_error_at = ?3,
                    last_error_message = ?4,
                    rolling_total_count = rolling_total_count + 1
                 WHERE sourceUrl = ?1",
                params![url, latency_ms as i64, now, msg],
            )?;
            prune_rolling_window(&tx, &url)?;
            let h = recompute_health_in_tx(&tx, &url)?;
            tx.execute(
                "UPDATE source_stats SET health_score = ?2 WHERE sourceUrl = ?1",
                params![url, h],
            )?;
            tx.commit()?;
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .map_err(interact_err_to_rusqlite)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::{CREATE_BOOK_SOURCES_TABLE, CREATE_SOURCE_STATS_TABLE};
    use rusqlite::Connection;
    use tempfile::TempDir;

    fn make_pool() -> (AppPool, TempDir) {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let pool = crate::db::build_pool(db_path).unwrap();
        (pool, tmp)
    }

    fn ensure_sources_table(conn: &Connection) {
        conn.execute_batch(CREATE_BOOK_SOURCES_TABLE).unwrap();
        conn.execute(
            "INSERT INTO book_sources (bookSourceUrl, bookSourceName) VALUES (?1, ?2)",
            params!["https://source1.com", "Source 1"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO book_sources (bookSourceUrl, bookSourceName) VALUES (?1, ?2)",
            params!["https://source2.com", "Source 2"],
        )
        .unwrap();
    }

    fn apply_migration(conn: &Connection) {
        conn.execute_batch(CREATE_SOURCE_STATS_TABLE).unwrap();
    }

    // --- compute_health unit tests ---

    #[test]
    fn compute_health_perfect_score() {
        let h = compute_health(HealthInputs {
            success_rate: 1.0,
            p99_latency_ms: 0.0,
            recency_hours: 0.0,
        });
        assert!((h - 1.0).abs() < 1e-10);
    }

    #[test]
    fn compute_health_zero_score() {
        let h = compute_health(HealthInputs {
            success_rate: 0.0,
            p99_latency_ms: 5000.0,
            recency_hours: 168.0,
        });
        assert!((h - 0.0).abs() < 1e-10);
    }

    #[test]
    fn compute_health_clamped_high() {
        let h = compute_health(HealthInputs {
            success_rate: 2.0,
            p99_latency_ms: -100.0,
            recency_hours: -10.0,
        });
        assert!((h - 1.0).abs() < 1e-10);
    }

    #[test]
    fn compute_health_midpoint() {
        let h = compute_health(HealthInputs {
            success_rate: 0.5,
            p99_latency_ms: 2500.0,
            recency_hours: 84.0,
        });
        let expected = 0.6 * 0.5 + 0.3 * 0.5 + 0.1 * 0.5;
        assert!((h - expected).abs() < 1e-10);
    }

    // --- DAO integration tests ---

    #[tokio::test]
    async fn record_success_increments() {
        let (pool, _tmp) = make_pool();
        let obj = pool.get().await.unwrap();
        obj.interact(|conn| {
            ensure_sources_table(conn);
            apply_migration(conn);
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .unwrap()
        .unwrap();

        let dao = SourceStatsDao::new(pool.clone());
        dao.record_success("https://source1.com", 100).await.unwrap();

        let stats = dao.get_by_url("https://source1.com").await.unwrap().unwrap();
        assert_eq!(stats.source_url, "https://source1.com");
        assert_eq!(stats.total_queries, 1);
        assert_eq!(stats.successful_queries, 1);
        assert_eq!(stats.timed_out_queries, 0);
        assert_eq!(stats.errored_queries, 0);
        assert_eq!(stats.total_latency_ms, 100);
        assert!(stats.last_success_at.is_some());
        assert_eq!(stats.rolling_success_count, 1);
        assert_eq!(stats.rolling_total_count, 1);
    }

    #[tokio::test]
    async fn record_timeout_increments_timed_out() {
        let (pool, _tmp) = make_pool();
        let obj = pool.get().await.unwrap();
        obj.interact(|conn| {
            ensure_sources_table(conn);
            apply_migration(conn);
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .unwrap()
        .unwrap();

        let dao = SourceStatsDao::new(pool.clone());
        dao.record_timeout("https://source1.com", 5000)
            .await
            .unwrap();

        let stats = dao.get_by_url("https://source1.com").await.unwrap().unwrap();
        assert_eq!(stats.total_queries, 1);
        assert_eq!(stats.timed_out_queries, 1);
        assert_eq!(stats.successful_queries, 0);
        assert_eq!(stats.total_latency_ms, 5000);
        assert!(stats.last_success_at.is_none());
        assert_eq!(stats.rolling_success_count, 0);
        assert_eq!(stats.rolling_total_count, 1);
    }

    #[tokio::test]
    async fn record_error_stores_message() {
        let (pool, _tmp) = make_pool();
        let obj = pool.get().await.unwrap();
        obj.interact(|conn| {
            ensure_sources_table(conn);
            apply_migration(conn);
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .unwrap()
        .unwrap();

        let dao = SourceStatsDao::new(pool.clone());
        dao.record_error("https://source1.com", "connection refused", 200)
            .await
            .unwrap();

        let stats = dao.get_by_url("https://source1.com").await.unwrap().unwrap();
        assert_eq!(stats.total_queries, 1);
        assert_eq!(stats.errored_queries, 1);
        assert_eq!(stats.last_error_message, Some("connection refused".to_string()));
        assert!(stats.last_error_at.is_some());
        assert_eq!(stats.rolling_success_count, 0);
        assert_eq!(stats.rolling_total_count, 1);
    }

    #[tokio::test]
    async fn get_all_returns_all_rows() {
        let (pool, _tmp) = make_pool();
        let obj = pool.get().await.unwrap();
        obj.interact(|conn| {
            ensure_sources_table(conn);
            apply_migration(conn);
            Ok::<_, rusqlite::Error>(())
        })
        .await
        .unwrap()
        .unwrap();

        let dao = SourceStatsDao::new(pool.clone());
        dao.record_success("https://source1.com", 100).await.unwrap();
        dao.record_success("https://source2.com", 200).await.unwrap();

        let all = dao.get_all().await.unwrap();
        assert_eq!(all.len(), 2);
    }
}
