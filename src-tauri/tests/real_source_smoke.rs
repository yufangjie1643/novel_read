use std::{collections::HashSet, env, fs, path::PathBuf, time::Duration};

use legado_desktop_lib::{
    commands::{
        fetch_book_info, fetch_chapter_content, fetch_chapter_list, import_source_from_json,
        search_books,
    },
    db::models::{Book, BookSource, SearchBook},
};
use serde_json::Value;

fn source_path() -> PathBuf {
    env::var("REAL_SOURCE_JSON")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"D:\Downloads\b778fe6b.json"))
}

fn load_sources() -> Vec<BookSource> {
    let path = source_path();
    let json = fs::read_to_string(&path)
        .unwrap_or_else(|err| panic!("failed to read {}: {err}", path.display()));
    let resp = import_source_from_json(json);
    assert!(resp.success, "source import failed: {:?}", resp.error);
    resp.data.expect("source import returned no data")
}

const CANDIDATE_SOURCE_NAMES: &[&str] = &[
    "酷我小说",
    "熊猫看书",
    "得奇小说网",
    "快书网",
    "天天看小说",
    "番茄小说①",
    "番茄小说②",
    "顶点小说①",
    "笔趣阁①",
    "书趣阁",
    "69书吧①",
    "69书吧③",
];

const FALLBACK_SEARCH_KEYS: &[&str] = &["我的师兄", "总裁", "凡人修仙传", "斗破苍穹", "诡秘之主"];

fn is_full_chain_source(source: &BookSource) -> bool {
    source.enabled
        && source.search_url.is_some()
        && source.rule_search.is_some()
        && source.rule_book_info.is_some()
        && source.rule_toc.is_some()
        && source.rule_content.is_some()
}

fn candidate_sources(sources: &[BookSource]) -> Vec<BookSource> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    for name in CANDIDATE_SOURCE_NAMES {
        for source in sources {
            let key = format!("{}|{}", source.book_source_name, source.book_source_url);
            if is_full_chain_source(source)
                && source.book_source_name.contains(name)
                && seen.insert(key)
            {
                candidates.push(source.clone());
                break;
            }
        }
    }

    candidates
}

fn book_from_search(source: &BookSource, item: &SearchBook) -> Book {
    Book {
        book_url: item.book_url.clone(),
        toc_url: item
            .toc_url
            .clone()
            .unwrap_or_else(|| item.book_url.clone()),
        origin: source.book_source_url.clone(),
        origin_name: source.book_source_name.clone(),
        name: item.name.clone(),
        author: item.author.clone().unwrap_or_default(),
        intro: item.intro.clone(),
        cover_url: item.cover_url.clone(),
        kind: item.kind.clone(),
        latest_chapter_title: item.latest_chapter_title.clone(),
        ..Book::default()
    }
}

fn source_search_keys(source: &BookSource) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(rule_search) = &source.rule_search {
        if let Ok(value) = serde_json::from_str::<Value>(rule_search) {
            if let Some(check_key) = value.get("checkKeyWord").and_then(|v| v.as_str()) {
                let trimmed = check_key.trim();
                if !trimmed.is_empty() {
                    keys.push(trimmed.to_string());
                }
            }
        }
    }

    for key in FALLBACK_SEARCH_KEYS {
        if !keys.iter().any(|existing| existing == key) {
            keys.push((*key).to_string());
        }
    }

    keys
}

async fn try_reader_flow(source: &BookSource) -> Result<(), String> {
    let mut failures = Vec::new();

    for key in source_search_keys(source) {
        let search = tokio::time::timeout(
            Duration::from_secs(25),
            search_books(source.clone(), key.clone(), Some(1)),
        )
        .await
        .map_err(|_| format!("search timed out for {}", key))?;

        if !search.success {
            failures.push(format!("search {key} failed: {:?}", search.error));
            continue;
        }

        let Some(results) = search.data else {
            failures.push(format!("search {key} returned no data"));
            continue;
        };

        if results.is_empty() {
            failures.push(format!("search {key} returned no books"));
            continue;
        }

        println!(
            "{}: search {key} returned {} books; first: {}",
            source.book_source_name,
            results.len(),
            results[0].name
        );

        for item in results.iter().take(3) {
            let mut book = book_from_search(source, item);
            let title = if book.name.is_empty() {
                "<empty>"
            } else {
                &book.name
            };

            let info = match tokio::time::timeout(
                Duration::from_secs(25),
                fetch_book_info(source.clone(), book.clone()),
            )
            .await
            {
                Ok(resp) => resp,
                Err(_) => {
                    failures.push(format!("book info timed out for {title}"));
                    continue;
                }
            };

            if !info.success {
                failures.push(format!("book info {title} failed: {:?}", info.error));
                continue;
            }

            book = match info.data {
                Some(book) if !book.name.is_empty() => book,
                _ => {
                    failures.push(format!("book info {title} returned no usable data"));
                    continue;
                }
            };

            let chapters = match tokio::time::timeout(
                Duration::from_secs(25),
                fetch_chapter_list(source.clone(), book.clone()),
            )
            .await
            {
                Ok(resp) => resp,
                Err(_) => {
                    failures.push(format!("chapter list timed out for {}", book.name));
                    continue;
                }
            };

            if !chapters.success {
                failures.push(format!(
                    "chapter list {} failed: {:?}",
                    book.name, chapters.error
                ));
                continue;
            }

            let Some(chapters) = chapters.data else {
                failures.push(format!("chapter list {} returned no data", book.name));
                continue;
            };

            if chapters.is_empty() {
                failures.push(format!("chapter list {} is empty", book.name));
                continue;
            }

            println!(
                "{}: {} has {} chapters; first: {}",
                source.book_source_name,
                book.name,
                chapters.len(),
                chapters[0].title
            );

            for chapter in chapters.into_iter().take(3) {
                let content = match tokio::time::timeout(
                    Duration::from_secs(25),
                    fetch_chapter_content(source.clone(), book.clone(), chapter.clone()),
                )
                .await
                {
                    Ok(resp) => resp,
                    Err(_) => {
                        failures.push(format!("chapter content timed out for {}", chapter.title));
                        continue;
                    }
                };

                if !content.success {
                    failures.push(format!(
                        "chapter content {} failed: {:?}",
                        chapter.title, content.error
                    ));
                    continue;
                }

                let Some(content) = content.data else {
                    failures.push(format!(
                        "chapter content {} returned no data",
                        chapter.title
                    ));
                    continue;
                };

                let content_len = content.trim().chars().count();
                if content_len <= 20 {
                    failures.push(format!(
                        "chapter content {} is too short: {content_len}",
                        chapter.title
                    ));
                    continue;
                }

                println!(
                    "{}: fetched chapter '{}' with {} chars",
                    source.book_source_name, chapter.title, content_len
                );
                return Ok(());
            }
        }
    }

    Err(failures.join(" | "))
}

#[test]
fn imports_real_source_subscription() {
    let sources = load_sources();
    let enabled = sources.iter().filter(|source| source.enabled).count();
    let searchable = sources
        .iter()
        .filter(|source| {
            source.enabled && source.search_url.is_some() && source.rule_search.is_some()
        })
        .count();
    let readable = sources
        .iter()
        .filter(|source| {
            source.enabled
                && source.rule_book_info.is_some()
                && source.rule_toc.is_some()
                && source.rule_content.is_some()
        })
        .count();

    println!(
        "loaded {} sources, enabled {}, searchable {}, readable {}",
        sources.len(),
        enabled,
        searchable,
        readable
    );

    assert!(sources.len() > 1000, "expected a large source subscription");
    assert!(searchable > 100, "expected many searchable sources");
    assert!(readable > 100, "expected many readable sources");
    assert!(sources
        .iter()
        .any(|source| source.book_source_name.contains("起点中文")));
}

#[tokio::test]
async fn real_source_search_to_reader_flow() {
    let sources = load_sources();
    let candidates = candidate_sources(&sources);
    assert!(!candidates.is_empty(), "no suitable test source found");
    println!("testing {} candidate sources", candidates.len());

    let mut failures = Vec::new();
    for source in candidates {
        println!(
            "testing source: {} ({})",
            source.book_source_name, source.book_source_url
        );
        match try_reader_flow(&source).await {
            Ok(()) => return,
            Err(err) => failures.push(format!("{}: {err}", source.book_source_name)),
        }
    }

    panic!(
        "no candidate source completed search -> info -> toc -> content flow:\n{}",
        failures.join("\n")
    );
}
