use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

use crate::db::models::{BookSource, SearchBook};
use crate::db::SourceStatsDao;
use crate::book_source::relevance::{score, ScoreBreakdown};
use crate::book_source::js_extensions::JsExtState;
use crate::book_source::web_book::WebBook;

pub const PER_SOURCE_TIMEOUT: Duration = Duration::from_secs(2);
pub const GLOBAL_TIMEOUT: Duration = Duration::from_millis(3500);
pub const MAX_CONCURRENCY: usize = 8;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum FailureKind {
    Timeout,
    Http,
    Parse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "PascalCase")]
pub enum SearchEvent {
    Started {
        request_id: String,
        query: String,
        total_sources: usize,
    },
    SourceStarted {
        source_url: String,
        source_name: String,
    },
    Result {
        source_url: String,
        book: crate::db::models::SearchBook,
        score: crate::book_source::relevance::ScoreBreakdown,
    },
    SourceFinished {
        source_url: String,
        count: usize,
        latency_ms: u64,
    },
    SourceFailed {
        source_url: String,
        error: String,
        latency_ms: u64,
        kind: FailureKind,
    },
    Done {
        request_id: String,
        succeeded: usize,
        failed: usize,
        total_results: usize,
        duration_ms: u64,
    },
}

pub trait SearchSink: Send + Sync {
    fn send(&self, event: SearchEvent) -> Result<(), String>;
}

pub struct MockSource {
    pub url: String,
    pub name: String,
    pub books: Vec<MockBook>,
    pub delay_ms: u64,
    pub fail: Option<String>,
}

#[derive(Clone)]
pub struct MockBook {
    pub name: String,
    pub author: Option<String>,
}

pub async fn run_stream<S: SearchSink + 'static>(
    query: String,
    sources: Vec<MockSource>,
    sink: Arc<S>,
    request_id: String,
    cancel: tokio::sync::watch::Receiver<bool>,
) {
    let started_at = std::time::Instant::now();
    let total = sources.len();
    let _ = sink.send(SearchEvent::Started {
        request_id: request_id.clone(),
        query: query.clone(),
        total_sources: total,
    });

    if total == 0 {
        let _ = sink.send(SearchEvent::Done {
            request_id,
            succeeded: 0,
            failed: 0,
            total_results: 0,
            duration_ms: started_at.elapsed().as_millis() as u64,
        });
        return;
    }

    let succeeded = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));
    let total_results = Arc::new(AtomicUsize::new(0));
    let send_failures = Arc::new(AtomicUsize::new(0));

    eprintln!("[run_stream_real] starting {total} sources");

    let sem = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut join_set = tokio::task::JoinSet::new();
    let q_shared: Arc<str> = Arc::from(query);

    for src in sources {
        if *cancel.borrow() {
            break;
        }
        let sem = sem.clone();
        let sink = sink.clone();
        let q = q_shared.clone();
        let cancel_rx = cancel.clone();
        let succeeded = succeeded.clone();
        let failed = failed.clone();
        let total_results = total_results.clone();
        let send_failures = send_failures.clone();
        join_set.spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };
            if *cancel_rx.borrow() {
                return;
            }
            if sink.send(SearchEvent::SourceStarted {
                source_url: src.url.clone(),
                source_name: src.name.clone(),
            }).is_err() {
                send_failures.fetch_add(1, Ordering::Relaxed);
            }
            let t0 = std::time::Instant::now();
            let q_norm = q.to_lowercase();
            let outcome: Result<Vec<MockBook>, (String, FailureKind)> = if let Some(err) = &src.fail {
                let kind = if err == "timeout" { FailureKind::Timeout } else { FailureKind::Http };
                Err((err.clone(), kind))
            } else {
                let books_clone = src.books.clone();
                let delay = src.delay_ms;
                tokio::time::timeout(PER_SOURCE_TIMEOUT, async move {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    Ok::<_, String>(books_clone).map(|b| {
                        b.into_iter()
                            .filter(|mb| {
                                mb.name.to_lowercase().contains(&q_norm) || q_norm.is_empty()
                            })
                            .collect()
                    })
                })
                .await
                .map_err(|_| ("timeout".to_string(), FailureKind::Timeout))
                .and_then(|r| r.map_err(|e| (e, FailureKind::Http)))
            };
            let latency_ms = t0.elapsed().as_millis() as u64;
            match outcome {
                Ok(books) => {
                    let mut count = 0usize;
                    for mb in books {
                        let mut book = crate::db::models::SearchBook::default();
                        book.name = mb.name;
                        book.author = mb.author;
                        book.origin = src.url.clone();
                        let score = crate::book_source::relevance::ScoreBreakdown {
                            all_query_present: 0,
                            words: 0,
                            typo: 0,
                            proximity: 0,
                            source_weight: 0,
                            attribute_rank: 0,
                            word_position: 0,
                            source_health: 0,
                        };
                        if sink.send(SearchEvent::Result {
                            source_url: src.url.clone(),
                            book,
                            score,
                        }).is_ok() {
                            count += 1;
                            total_results.fetch_add(1, Ordering::Relaxed);
                        } else {
                            send_failures.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    if sink.send(SearchEvent::SourceFinished {
                        source_url: src.url,
                        count,
                        latency_ms,
                    }).is_err() {
                        send_failures.fetch_add(1, Ordering::Relaxed);
                    }
                    succeeded.fetch_add(1, Ordering::Relaxed);
                }
                Err((e, kind)) => {
                    if sink.send(SearchEvent::SourceFailed {
                        source_url: src.url,
                        error: e,
                        latency_ms,
                        kind,
                    }).is_err() {
                        send_failures.fetch_add(1, Ordering::Relaxed);
                    }
                    failed.fetch_add(1, Ordering::Relaxed);
                }
            }
        });
    }

    let _ = tokio::time::timeout(GLOBAL_TIMEOUT, async {
        while let Some(_) = join_set.join_next().await {}
    })
    .await;

    let sf = send_failures.load(Ordering::Relaxed);
    if sf > 0 {
        eprintln!("search_streamer: {sf} sink.send() failures");
    }

    let duration_ms = started_at.elapsed().as_millis() as u64;
    let _ = sink.send(SearchEvent::Done {
        request_id,
        succeeded: succeeded.load(Ordering::Relaxed),
        failed: failed.load(Ordering::Relaxed),
        total_results: total_results.load(Ordering::Relaxed),
        duration_ms,
    });
}

/// Real version of the streamer: takes `BookSource` and uses `WebBook::search`
/// to fetch results. Records per-source health stats into `SourceStatsDao`.
///
/// `health_by_url` is a snapshot of `source_stats.health_score` taken at search
/// start, used to feed the relevance cascade (rule 7).
pub async fn run_stream_real<S: SearchSink + 'static>(
    query: String,
    sources: Vec<BookSource>,
    sink: Arc<S>,
    request_id: String,
    cancel: tokio::sync::watch::Receiver<bool>,
    stats: Arc<SourceStatsDao>,
    health_by_url: HashMap<String, f64>,
) {
    let started_at = std::time::Instant::now();
    let total = sources.len();
    let _ = sink.send(SearchEvent::Started {
        request_id: request_id.clone(),
        query: query.clone(),
        total_sources: total,
    });

    if total == 0 {
        let _ = sink.send(SearchEvent::Done {
            request_id,
            succeeded: 0,
            failed: 0,
            total_results: 0,
            duration_ms: started_at.elapsed().as_millis() as u64,
        });
        return;
    }

    let succeeded = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));
    let total_results = Arc::new(AtomicUsize::new(0));
    let send_failures = Arc::new(AtomicUsize::new(0));

    eprintln!("[run_stream_real] starting {total} sources");

    let sem = Arc::new(Semaphore::new(MAX_CONCURRENCY));
    let mut join_set = tokio::task::JoinSet::new();
    let q_shared: Arc<str> = Arc::from(query);

    for src in sources {
        if *cancel.borrow() {
            break;
        }
        let sem = sem.clone();
        let sink = sink.clone();
        let q = q_shared.clone();
        let cancel_rx = cancel.clone();
        let stats = stats.clone();
        let health_by_url = health_by_url.clone();
        let succeeded = succeeded.clone();
        let failed = failed.clone();
        let total_results = total_results.clone();
        let send_failures = send_failures.clone();
        join_set.spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };
            if *cancel_rx.borrow() {
                return;
            }
            let _ = sink.send(SearchEvent::SourceStarted {
                source_url: src.book_source_url.clone(),
                source_name: src.book_source_name.clone(),
            });
            let url = src.book_source_url.clone();
            let weight = src.weight;
            let t0 = std::time::Instant::now();
            let outcome: Result<Vec<SearchBook>, (String, FailureKind)> =
                match tokio::time::timeout(
                    PER_SOURCE_TIMEOUT,
                    tokio::task::spawn_blocking({
                        let src = src.clone();
                        let q = q.clone();
                        move || {
                            let web = WebBook::new(JsExtState::global());
                            web.search(&src, &q, Some(1)).map_err(|e| e.to_string())
                        }
                    }),
                )
                .await
                {
                    Ok(Ok(Ok(books))) => Ok(books),
                    Ok(Ok(Err(e))) => Err((e, FailureKind::Http)),
                    Ok(Err(je)) => Err((format!("join: {}", je), FailureKind::Parse)),
                    Err(_) => Err(("timeout".to_string(), FailureKind::Timeout)),
                };
            let latency_ms = t0.elapsed().as_millis() as u64;
            match outcome {
                Ok(books) => {
                    let _ = stats.record_success(&url, latency_ms).await;
                    let health = health_by_url.get(&url).copied().unwrap_or(1.0);
                    let mut count = 0usize;
                    for book in books {
                        let s = score(
                            &book.name,
                            book.author.as_deref(),
                            book.intro.as_deref(),
                            &q,
                            weight,
                            health,
                        );
                        if sink.send(SearchEvent::Result {
                            source_url: url.clone(),
                            book,
                            score: s,
                        })
                        .is_ok()
                        {
                            count += 1;
                            total_results.fetch_add(1, Ordering::Relaxed);
                        } else {
                            send_failures.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    if sink.send(SearchEvent::SourceFinished {
                        source_url: url.clone(),
                        count,
                        latency_ms,
                    })
                    .is_err()
                    {
                        send_failures.fetch_add(1, Ordering::Relaxed);
                    }
                    succeeded.fetch_add(1, Ordering::Relaxed);
                }
                Err((e, kind)) => {
                    match kind {
                        FailureKind::Timeout => {
                            let _ = stats.record_timeout(&url, latency_ms).await;
                        }
                        _ => {
                            let _ = stats.record_error(&url, &e, latency_ms).await;
                        }
                    }
                    if sink.send(SearchEvent::SourceFailed {
                        source_url: url.clone(),
                        error: e,
                        latency_ms,
                        kind,
                    })
                    .is_err()
                    {
                        send_failures.fetch_add(1, Ordering::Relaxed);
                    }
                    failed.fetch_add(1, Ordering::Relaxed);
                }
            }
        });
    }

    let _ = tokio::time::timeout(GLOBAL_TIMEOUT, async {
        while join_set.join_next().await.is_some() {}
    })
    .await;

    let sf = send_failures.load(Ordering::Relaxed);
    if sf > 0 {
        eprintln!("search_streamer::run_stream_real: {sf} sink.send() failures");
    }

    let duration_ms = started_at.elapsed().as_millis() as u64;
    let _ = sink.send(SearchEvent::Done {
        request_id,
        succeeded: succeeded.load(Ordering::Relaxed),
        failed: failed.load(Ordering::Relaxed),
        total_results: total_results.load(Ordering::Relaxed),
        duration_ms,
    });
    let _ = std::marker::PhantomData::<ScoreBreakdown>; // suppress unused import in mock builds
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct CollectingSink {
        events: Mutex<Vec<SearchEvent>>,
    }
    impl SearchSink for CollectingSink {
        fn send(&self, event: SearchEvent) -> Result<(), String> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

    fn mk_source(url: &str, books: Vec<(&str, Option<&str>)>, delay_ms: u64) -> MockSource {
        MockSource {
            url: url.to_string(),
            name: url.to_string(),
            books: books
                .into_iter()
                .map(|(n, a)| MockBook {
                    name: n.to_string(),
                    author: a.map(String::from),
                })
                .collect(),
            delay_ms,
            fail: None,
        }
    }

    #[tokio::test]
    async fn all_sources_succeed() {
        let sink = Arc::new(CollectingSink::default());
        let sources = vec![
            mk_source("a", vec![("Book A1", Some("Auth A")), ("Book A2", None)], 10),
            mk_source("b", vec![("Book B1", None)], 10),
        ];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("".to_string(), sources, sink.clone(), "req-1".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let started = events.iter().filter(|e| matches!(e, SearchEvent::Started { .. })).count();
        let finished = events.iter().filter(|e| matches!(e, SearchEvent::SourceFinished { .. })).count();
        let done = events.iter().filter(|e| matches!(e, SearchEvent::Done { .. })).count();
        assert_eq!(started, 1);
        assert_eq!(finished, 2);
        assert_eq!(done, 1);

        let done_evt = events.iter().find(|e| matches!(e, SearchEvent::Done { .. })).unwrap();
        if let SearchEvent::Done { succeeded, failed, total_results, .. } = done_evt {
            assert_eq!(*succeeded, 2);
            assert_eq!(*failed, 0);
            assert_eq!(*total_results, 3);
        }

        let fin_a = events.iter().find(|e| matches!(e, SearchEvent::SourceFinished { source_url, .. } if source_url == "a")).unwrap();
        if let SearchEvent::SourceFinished { count, .. } = fin_a {
            assert_eq!(*count, 2);
        }
    }

    #[tokio::test]
    async fn one_source_fails_early() {
        let sink = Arc::new(CollectingSink::default());
        let mut slow = mk_source("slow", vec![("Book", None)], 10);
        slow.fail = Some("http error".to_string());
        let fast = mk_source("fast", vec![("Book", None)], 10);
        let sources = vec![slow, fast];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("".to_string(), sources, sink.clone(), "req-2".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let failures: Vec<&SearchEvent> = events
            .iter()
            .filter(|e| matches!(e, SearchEvent::SourceFailed { kind: FailureKind::Http, .. }))
            .collect();
        assert_eq!(failures.len(), 1, "expected exactly one http failure");

        let done_evt = events.iter().find(|e| matches!(e, SearchEvent::Done { .. })).unwrap();
        if let SearchEvent::Done { succeeded, failed, .. } = done_evt {
            assert_eq!(*succeeded, 1);
            assert_eq!(*failed, 1);
        }
    }

    #[tokio::test]
    async fn cancel_before_start_does_nothing() {
        let sink = Arc::new(CollectingSink::default());
        let sources = vec![mk_source("a", vec![("Book", None)], 10)];
        let (tx, rx) = tokio::sync::watch::channel(false);
        tx.send(true).unwrap();
        run_stream("test".to_string(), sources, sink.clone(), "req-3".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let started: usize = events.iter().filter(|e| matches!(e, SearchEvent::SourceStarted { .. })).count();
        let results: usize = events.iter().filter(|e| matches!(e, SearchEvent::Result { .. })).count();
        let done: usize = events.iter().filter(|e| matches!(e, SearchEvent::Done { .. })).count();
        assert_eq!(started, 0);
        assert_eq!(results, 0);
        assert_eq!(done, 1);
    }

    #[tokio::test]
    async fn events_ordered() {
        let sink = Arc::new(CollectingSink::default());
        let sources = vec![mk_source("a", vec![("Book", None)], 10)];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("test".to_string(), sources, sink.clone(), "req-4".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        assert!(matches!(events.first().unwrap(), SearchEvent::Started { .. }));
        assert!(matches!(events.last().unwrap(), SearchEvent::Done { .. }));
    }

    #[tokio::test]
    async fn real_timeout_path() {
        let sink = Arc::new(CollectingSink::default());
        let slow = mk_source("slow", vec![("Book", None)], 5000);
        let fast = mk_source("fast", vec![("Book Fast", None)], 10);
        let sources = vec![slow, fast];
        let (_tx, rx) = tokio::sync::watch::channel(false);
        run_stream("".to_string(), sources, sink.clone(), "req-5".to_string(), rx).await;
        let events = sink.events.lock().unwrap();
        let failures: Vec<&SearchEvent> = events
            .iter()
            .filter(|e| matches!(e, SearchEvent::SourceFailed { kind: FailureKind::Timeout, .. }))
            .collect();
        assert_eq!(failures.len(), 1, "expected exactly one real timeout failure");

        let done_evt = events.iter().find(|e| matches!(e, SearchEvent::Done { .. })).unwrap();
        if let SearchEvent::Done { succeeded, failed, total_results, .. } = done_evt {
            assert_eq!(*succeeded, 1);
            assert_eq!(*failed, 1);
            assert_eq!(*total_results, 1);
        }
    }
}
