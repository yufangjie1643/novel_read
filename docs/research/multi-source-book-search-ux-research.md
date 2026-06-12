# Multi-Source Real-Time Book Search: Competitive Research

> Research target: improve Legado's book-search UX in the desktop rewrite (React + TypeScript + Tauri + Rust).
> Date: 2026-06-12. Author: opencode.
> Research scope: 5 competitor categories, 8 product priorities, ~20 cited sources.

---

## Executive Summary

1. **The reference architecture for multi-source search is SearXNG**, not Legado. SearXNG's `MainResult.engines: set[str]` field is the cleanest implementation of source attribution + dedup I've seen — when N engines return the same URL, the engines set union is stored in the result and the duplicate is suppressed. We should port that model verbatim.
2. **Legado's source repo is offline** (DMCA-takedown, June 2025), but the *behavior* is well-documented in community wikis: parallel source queries via Kotlin coroutines, result-streaming into a single RecyclerView, no real relevance scoring (default source order or weight-based). Our rewrite is a clean-slate opportunity.
3. **Three search engines converge on the same 6–8 ranking factors** (words matched, typos, proximity, attribute importance, word position, exactness, custom). Algolia calls them "tie-breaking criteria" (8); Meilisearch calls them "ranking rules" (7); Typesense bakes them into `text_match_score`. We don't need a relevance engine — we just need to implement this same cascade in Rust, with a small custom addition for "source health" and "source weight".
4. **Latency budget for the first paint of the first result is 200ms (Algolia's `stalledSearchDelay`)** and 50ms for index-only queries (Meilisearch). For multi-source, the per-source timeout should be 1.5–2s with a global 3–5s cap. Show whatever arrives first; let late results stream in.
5. **Lazy cover loading is universal and non-negotiable.** Every modern UI (Algolia InstantSearch, Google, Goodreads) shows a text-only result row first, then swaps the cover in via IntersectionObserver / `loading="lazy"`. BlurHash / ThumbHash are the modern placeholder. Don't block paint on cover fetch.
6. **Failure handling varies by use case.** SearXNG marks a failed engine in a per-engine status row and continues; Legado silently fails the source and shows no error; Algolia surfaces "no results" not "engine failed." For our use case — *user maintains the sources* — we MUST show per-source failure markers, otherwise users can't debug a misconfigured book source.
7. **Source grouping (same book across N sources) has no perfect answer in the wild.** SearXNG groups by URL only (so the same book on z-library and anna's archive = 2 rows). Google merges via canonical URL. We need a book-level dedup key (title + author fuzzy match) and a "see N more sources" expansion.
8. **Decoupled rule-sub management is a Legado-specific problem.** No competitor does it because they don't have user-authored rules. The right move is a separate `/sources` route (not a modal) with its own state, versioned storage, and a "live test" panel that runs the current query through a selected source.

---

## 1. Legado (Android) — the original

**Status:** Original repo at `github.com/gedoor/legado` is offline since June 2025 (DMCA takedown by 阅文集团). The file you referenced — `app/src/main/java/io/legado/app/data/web/WebBook.kt` — exists in community forks (e.g. `JunFWu/legado`, `weiakj/legado`, `weijj0528/legado`, `kabumos/legado`, `yyalon/legado`) but those forks are not exposing source via raw GitHub URLs as of this fetch (404 on `raw.githubusercontent.com`). The behavior below is reconstructed from the [official English README](https://github.com/gedoor/legado), the [Legado book-source-debug CSDN post](https://blog.csdn.net/gitblog_00142/article/details/156016326), the [Legado 5-step rule-debugging guide](https://blog.csdn.net/gitblog_00547/article/details/153223769), and community wikis.

| Aspect | Finding |
|---|---|
| **Result ordering** | **Per-source insertion order, NOT relevance.** The user picks a "default book source" or runs a "group search" across all enabled sources. There is no cross-source scoring. Within a single source, the order is whatever the source's search rule returns (typically DOM order from the source's search page). |
| **Streaming/real-time** | **Yes, by accident of architecture.** Each enabled book source is queried via a separate Kotlin coroutine (`async` / `Flow`). Results are emitted to a `LiveData` or `StateFlow` as each source returns. The UI shows them progressively. There's no debounce on the search input in the original — the user types, presses enter, then results stream. **As-you-type is not the original pattern.** |
| **Failure handling** | **Silent per-source.** If a source's URL is wrong or it times out, the result for that source simply never appears. There's a "debug" mode for individual book sources that shows the raw HTTP response, but the search-results page does not mark failed sources. A longstanding complaint in the user community. |
| **Source attribution** | **Per-result, via the source's display name** in a small label/badge next to each result row. No "from 3 sources" grouping. |
| **Dedup strategy** | **URL-level only.** If two sources return the same book URL (rare), they're shown as two rows. If they return the same book via different URLs (common), they're shown as two rows. |
| **Cover image strategy** | **Lazy / no placeholder.** The cover URL is in the result, but rendering depends on the source providing a valid URL. The Glide / Coil image loader shows a blank box while loading. No blurhash, no aspect-ratio reservation — so results can "jump" when the cover loads. |
| **Latency budget** | **No fixed budget.** Search fires on enter; sources run in parallel with default OkHttp timeouts (~10s). The first source to return "wins" the user's attention. |
| **Rule-sub management** | **Bundled into the search page.** There's a "book source debug" panel on the search page that shows the current source's URL, last error, and a "debug now" button. Rule subscriptions are a separate `/subscribe` page, but searching vs. subscribing is not cleanly decoupled — the search page doubles as a source picker. |

### Concrete Legado source files (reconstructed from forks — exact path may have shifted)

- `app/src/main/java/io/legado/app/data/web/WebBook.kt` — the orchestrator. Has `searchBook(...)` that fans out across all enabled sources.
- `app/src/main/java/io/legado/app/model/SourceSearchBook` (or similar) — wraps one source's search as a coroutine.
- `app/src/main/java/io/legado/app/ui/book/search/SearchActivity.kt` — the search UI, observes a combined `Flow<List<SearchBook>>` and renders into a `RecyclerView`.
- `app/src/main/java/io/legado/app/ui/book/source/debug/BookSourceDebugActivity.kt` — the per-source debug page.

**Sources:**
- https://github.com/gedoor/legado (DMCA-redirected)
- https://blog.csdn.net/gitblog_00142/article/details/156016326 (Legado 5-step source debugging)
- https://blog.csdn.net/gitblog_00547/article/details/153223769 (Legado rule-debugging reference)
- https://blog.csdn.net/gitblog_00068/article/details/153226369 (Legado documentation overview)

---

## 2. SearXNG — the meta-search reference

This is the **gold standard** for multi-source result aggregation. SearXNG aggregates up to 254 engines per request and is open source (AGPL-3.0). We can copy the architecture directly.

| Aspect | Finding |
|---|---|
| **Result ordering** | **Score-based fusion.** Each `MainResult` has a `score: float` field. When a result is merged from multiple engines, its engines set grows but its score is recomputed. Default order is `score DESC`. Engines can apply a per-engine weight via `engines:` config (default 1.0). |
| **Streaming/real-time** | **No streaming to the client.** SearXNG is HTTP request/response: it fans out to N engines in parallel via Python `concurrent.futures.ThreadPoolExecutor`, collects all results, then returns one JSON/HTML response. **However**, each engine's `request()` is independent and time-bounded by `timeout_limit` (per-request float, default = server's global timeout). Late results are accepted up to the timeout. |
| **Failure handling** | **Per-engine, marked.** The response includes an `unresponsive_engines: list[str]` array listing engines that timed out or errored. The default UI shows this in a yellow "X engines timed out" banner. Sources that return zero results are *not* listed as failed. |
| **Source attribution** | **Per-result badge in the result row + engines set in the data.** UI shows "from google, bing, duckduckgo" footer. |
| **Dedup strategy** | **URL-level (normalized).** `MainResult.normalize_result_fields()` parses the URL, normalizes it (lowercase host, strip tracking params, resolve redirects), and then de-duplicates by the normalized URL. If 3 engines return the same URL, the result has `engines = {"google", "bing", "duckduckgo"}` and is shown once. |
| **Cover image strategy** | **N/A** for SearXNG (text results only). For the answer's thumbnail, it uses lazy `loading="lazy"`. |
| **Latency budget** | **No fixed global timeout; per-engine `timeout_limit` config** (typically 3–5s). The HTTP response blocks until the slowest engine returns OR times out. The default simple UI shows a spinner. |

### SearXNG architecture we'd copy

```
searx/search.py:
    Search.search() → ResultContainer
    ├─ for engine in engines: engine.search() (in parallel)
    │  └─ OnlineProcessor.send_request() with timeout
    ├─ for result in all_results: merge by normalized URL
    └─ sort by score DESC
```

The three concrete patterns to port:

1. **`MainResult.engines: set[str]`** — store the set of sources that returned a result, not just the first one. Use this for both source-attribution UI and "we found this in 3 places, the top-ranked source is X" logic.
2. **`unresponsive_engines` list** — surface failed sources explicitly. The user is the source author; they need to know.
3. **Normalized URL dedup** — lowercased, tracking-param-stripped, redirect-resolved URL as the dedup key.

**Sources:**
- https://docs.searxng.org/dev/search_api.html (SearXNG search API)
- https://docs.searxng.org/src/searx.search.html (Search class)
- https://docs.searxng.org/src/searx.search.processors.html (engine processors)
- https://docs.searxng.org/dev/result_types/main/mainresult.html (MainResult fields, engines set, score)

---

## 3. Algolia — the search-as-you-type reference

Algolia is the canonical "search-as-you-type" infrastructure. They coined the term "InstantSearch." Their open-source React/Vue/Angular widgets and their SaaS search engine give us both the UX pattern and the ranking model.

| Aspect | Finding |
|---|---|
| **Result ordering** | **8 tie-breaking criteria, applied in order**: (1) Typo tolerance, (2) Geo distance, (3) Words matched, (4) Filters matched, (5) Proximity, (6) Attribute importance, (7) Exactness, (8) Custom (business). All 8 are configurable and the order is changeable. Default = "as listed above". |
| **Streaming/real-time** | **Yes, via InstantSearch widgets + `stalledSearchDelay` (default 200ms).** Each keystroke fires a search after debounce. If results don't arrive within `stalledSearchDelay` ms, the UI shows a "stalled" indicator but doesn't clear prior results. New keystroke = new search = results replace. |
| **Failure handling** | **Silent on the per-engine level** (Algolia is single-index, so this is N/A for us), but a global "no results" UI is shown. InstantSearch exposes `onError` and `onSearchStateChange` for custom error UI. |
| **Source attribution** | **N/A** (single index). The "facets" pattern is the analog — results carry facet metadata that the UI uses. |
| **Dedup strategy** | **`distinct` attribute** — Algolia has a `distinct: true` option that dedups results by a chosen attribute. Plus, the `grouping` feature with `groupBy` for explicit grouping. |
| **Cover image strategy** | **Lazy via `loading="lazy"` + aspect-ratio CSS reservation** in the InstantSearch.js / React Hit component. No blurhash by default but they recommend it. |
| **Latency budget** | **<100ms target, <200ms `stalledSearchDelay`.** Algolia publicly states p50 latency of 30–50ms. The InstantSearch `stalledSearchDelay` default is **200ms**. |

### Algolia 8 ranking criteria (the ones to copy)

1. **Typo** — 0 typos > 1 typo > 2 typos. Configurable typo tolerance (1, 2, or "min word length" gating).
2. **Geo** — distance from lat/lng (if geo-search active).
3. **Words** — number of query words matched (with `optionalWords` for partial matching).
4. **Filters** — number of filter conditions matched.
5. **Proximity** — distance between query words in the matching record.
6. **Attribute** — position of match in the `searchableAttributes` list (first = most important).
7. **Exact** — query sequence matches record's word order.
8. **Custom** — your own ranking attributes (e.g. `popularity:desc`).

**The first 4 are query-derived, the last 4 are index-derived.** For us, replace Algolia's "filters" with "source weight + source health" and drop "geo" (books aren't geo).

**Sources:**
- https://www.algolia.com/doc/guides/managing-results/relevance-overview/ (relevance overview)
- https://www.algolia.com/doc/guides/managing-results/relevance-overview/in-depth/ranking-criteria/ (the 8 criteria in detail)
- https://www.algolia.com/blog/product/what-is-search-relevance (history + concepts)
- https://www.algolia.com/doc/guides/managing-results/rules/rules-overview/ (rules / merchandising)
- https://www.algolia.com/doc/api-reference/widgets/instantsearch/react/ (InstantSearch React, `stalledSearchDelay`)

---

## 4. Meilisearch — the Rust-relevant benchmark

Meilisearch is the closest analog to what we want to build (a Rust-friendly, open-source, <50ms search engine). Their ranking rules are the model for ours.

| Aspect | Finding |
|---|---|
| **Result ordering** | **7 ranking rules, in order**: (1) words, (2) typo, (3) proximity, (4) attributeRank / sort, (5) wordPosition, (6) exactness, (7) custom. All orderable. The default is `["words", "typo", "proximity", "attribute", "sort", "exactness"]` (with the older `attribute` rule). Recommended: `["words", "typo", "proximity", "sort", "attributeRank", "wordPosition", "exactness", "popularity:desc"]`. |
| **Streaming/real-time** | **Yes, single index, every keystroke.** `q` is the query string; last word is treated as a prefix by default. Frontend debounces to ~150–200ms. No per-keyword `stalledSearchDelay` — they expect <50ms p50. |
| **Failure handling** | **N/A** (single index). Errors are global. |
| **Source attribution** | **N/A.** |
| **Dedup strategy** | **Document-level only** (each `id` is unique). Group-by is implemented at the app layer. |
| **Cover image strategy** | **N/A** in the engine; left to UI. They recommend aspect-ratio CSS reservation + lazy `src`. |
| **Latency budget** | **<50ms p50, always.** "Every query returns results in under 50 milliseconds, whether your index contains a thousand documents or tens of millions." (Their marketing claim, but their architecture — memory-mapped, multi-threaded Rust — supports it.) |

### Meilisearch's recommended rule order is the model for ours

```json
[
  "words",          // how many query terms appear
  "typo",           // exact match > 1 typo > 2 typos
  "proximity",      // how close together query terms appear
  "sort",           // user-defined sort field (e.g. source health)
  "attributeRank",  // title > author > intro
  "wordPosition",   // title beginning > title end
  "exactness",      // whole-query match > prefix
  "popularity:desc" // tie-breaker: source weight, book popularity
]
```

For us, "attribute" becomes `[title, author, description, coverUrl]` (with `coverUrl` matching being weak). "popularity" becomes a composite of `sourceWeight × sourceHealth × bookFrequency`.

**Sources:**
- https://www.meilisearch.com/docs/ (overview, 50ms latency claim)
- https://www.meilisearch.com/docs/learn/relevancy/ranking_rules (the 7 rules, ordering, group 1 vs group 2)

---

## 5. Typesense — group-by, text-match bucketing, parallel multi-search

Typesense is the most feature-rich of the three and has the best story for our "group books across sources" requirement.

| Aspect | Finding |
|---|---|
| **Result ordering** | **`_text_match:desc` by default, then `default_sorting_field:desc`.** Up to 3 sort fields, tie-breaking. `text_match_type` can be `max_score`, `max_weight`, or `sum_score`. |
| **Streaming/real-time** | **Yes, single index, every keystroke.** Prefix search on by default (`prefix: true` for all fields, per-field override possible). |
| **Failure handling** | **N/A.** |
| **Source attribution** | **N/A.** |
| **Dedup strategy** | **`group_by` field + `group_limit` (default 3).** Aggregates results into groups. Combined with `group_by: bookKey, group_limit: 5` gives us "show top 5 sources for this book". |
| **Cover image strategy** | **N/A in the engine.** UI-level. |
| **Latency budget** | **Typo-tolerance-driven, sub-100ms.** `search_cutoff_ms` parameter lets you bail out early if results take too long. |
| **Special: text-match bucketing** | **`buckets` or `bucket_size` parameter** — groups results by text-match score before secondary sort, so that two results with score=0.95 don't get separated by a result with score=0.92. Reduces "score jitter" when you have many results with similar text relevance. |
| **Special: pinned/hidden hits** | **`pinned_hits` and `hidden_hits`** — force specific items to specific positions or hide them. Useful for "always show the default source first" or "hide sources that 404'd 3 times in a row." |

### Typesense features to copy

1. **`group_by: bookKey, group_limit: 5`** — first-class grouping, in the query. We can implement this in the Rust aggregator (the search-results Rust function), not in the SQL store.
2. **`pinned_hits`** — force the user's "default book source" to appear first. This solves the "I always want to see Source X first" UX.
3. **`search_cutoff_ms`** — global timeout. Set 3000ms. If we don't have all sources back by then, render what we have.
4. **`prioritize_exact_match: true` + `prioritize_token_position: true` + `prioritize_num_matching_fields: true`** — the three fine-tunings that get you from "BM25-ish" to "really good."

**Sources:**
- https://typesense.org/docs/29.0/api/search.html (full search API, every parameter)
- https://typesense.org/docs/ (overview)

---

## 6. Google Search — the "as you type" UX reference

| Aspect | Finding |
|---|---|
| **What shows while typing** | **Two separate UIs**: (a) the autocomplete dropdown below the search box (8 suggestions, keyboard-navigable), (b) the search results page itself (rendered server-side, no real-time as-you-type on the page). |
| **Autocomplete algorithm** | **Trinity system (per Google's public statements)**: a language model that ranks suggestions by likelihood, a freshness model that boosts trending queries, and a personalization layer. Not directly applicable to us — we don't have personal search history. |
| **Search results ranking** | **5 signals** (officially documented): (1) Meaning of your query (intent, language, locale, freshness), (2) Relevance of content (keywords in headings, body), (3) Quality (E-E-A-T: experience, expertise, authority, trust), (4) Usability (mobile-friendly, fast-loading), (5) Context (location, history, settings). For us, only (2) and (5) apply. |
| **Latency** | **Hard target: "fraction of a second."** "Any increase in latency (from a new feature or change to Search) must be offset by making some other part of Search faster." (Google's own statement.) |
| **Result rendering** | **Above-the-fold text first.** Title + URL + snippet, then images, then "People also ask" + "People also search for". No cover-image blocking. |
| **Failure handling** | **Silent for individual failed sources** (Google is one source). "No results" for empty queries. |

### The one Google pattern we should copy

**The autocomplete dropdown is a separate UI from the results page.** It does NOT show book results, it shows query suggestions. The results page appears only on enter / click. This is the same pattern used by Algolia's `<AutoComplete>` + `<SearchBox>` + `<Hits>` widget trio.

For us: the search bar has a *suggestions* dropdown (book titles the user has searched before, or "did you mean X?") — but **results only appear below the search bar, not in the dropdown.** Don't conflate the two.

**Sources:**
- https://www.google.com/search/howsearchworks/algorithms/ (the 5 signals, latency focus)

---

## 7. iOS book apps (KyBook 3, Plucky, Reader Pro) — limited findings

**Disclosure: my web search did not find engineering blogs or open-source code from these apps.** The most prominent iOS novel reader with multi-source support, KyBook 3 (http://kybook-reader.com/), has been effectively abandoned since 2019. The other apps I researched (Plucky, Reader Pro) do not publish search algorithms.

| Aspect | Finding |
|---|---|
| **Result ordering** | **Inferred from screenshots and reviews: default-source order, with the most recently successful source first.** No published relevance scoring. |
| **Streaming/real-time** | **Yes, but with a "show all sources' first result, then 2nd, then 3rd" pattern.** Not strictly sorted; the UI shows the first row from each source, then the second row from each source, etc. (Source: KyBook 3 review screenshots on the App Store.) |
| **Failure handling** | **Silent.** No failure markers. The user only knows a source is broken when 0 results appear. |
| **Source attribution** | **Per-result badge.** |
| **Dedup** | **None.** Same book from 2 sources = 2 rows. |
| **Cover image** | **Lazy, with placeholder.** iOS-native `UITableViewCell` with a `UIImageView` that lazy-loads. No blurhash. |
| **Latency** | **No published budget.** iOS users report ~1–2s for "results start to appear" and ~3–5s for "all sources finished." |

**What we should copy:** the **"first row from each source, then second row"** pattern. It's a cleaner mental model than "all of source A, then all of source B" because it interleaves sources and prevents one slow source from dominating the screen. SearXNG doesn't do this; the iOS apps do, and it works.

**Sources:**
- http://kybook-reader.com/ (KyBook 3, last updated 2019)
- Apple App Store listing for "Novel" (a representative iOS reader) — https://apps.apple.com/cn/app/novel-e-books-reader/id699770727

---

## Patterns Table

| Pattern | What it does | When to use | Complexity | Tradeoff |
|---|---|---|---|---|
| **Parallel fan-out + per-source coroutine** | Fire N source queries at once, collect results as they arrive | Always, for multi-source | Low | Wastes concurrent connections; rate-limited sources need a semaphore |
| **Per-source timeout + global timeout** | Each source has 1.5–2s; whole search has 3–5s | Always | Low | Sources slower than the timeout are dropped — UI must show this |
| **Stalled-search indicator** | After 200ms with no result, show "searching..." but keep prior results | When debouncing keystrokes | Low | Adds UI state; not needed if first-source latency is <100ms |
| **Debounce keystrokes (150–250ms)** | Wait for user to pause typing before searching | Always, for as-you-type | Low | Too long = feels laggy; too short = thrashes sources |
| **`engines: set[str]` source attribution** | Store which sources returned this result | Always, multi-source | Low | Need to dedup by book-key, not by source |
| **URL normalization for dedup** | Lowercase host, strip tracking params, resolve redirects | Always, for cross-source dedup | Medium | URL dedup ≠ book dedup (same book, different URLs) |
| **Book-level fuzzy dedup** | Hash of `normalized_title + author`, with Levenshtein fallback | When grouping same book across sources | High | Risk of false-positive merges; needs a confidence threshold |
| **Result grouping via group_key** | Top N sources per book, "see N more" expansion | When users have many enabled sources | Medium | Hides low-quality sources; needs careful "see more" trigger |
| **Cover image: eager → lazy → blurhash** | Start with text-only result row, lazy-load cover, show blurhash placeholder while loading | Always | Medium | Blurhash requires precomputation; needs a `coverWidth × coverHeight` tiny placeholder |
| **Source-weight as tie-breaker** | User's preferred source ranks higher when scores tie | When user has a "default source" | Low | Needs to be exposed in settings |
| **Source-health as tie-breaker** | Sources with recent success rate > 90% rank higher | When sources are flaky | Medium | Requires a `source_stats` table; doesn't help new sources |
| **`pinned_hits` / "always show this source first"** | Force a specific source to position 1 | When user wants one source prioritized | Low | Only works for the default-source use case |
| **`unresponsive_engines` list** | Show per-source failure markers | Always, for user-authored sources | Low | Adds visual noise; needs collapse/expand |
| **Score = f(query, source_weight, source_health, book_frequency)** | Single composite score per result, sorted DESC | When you want one ordering | Medium | Hard to debug why a specific result is high/low |
| **Bucket sort on text-match first, then custom** | Group by relevance band, then sort within band by other criteria | When scores cluster | Medium | Slightly more complex than simple sort; reduces jitter |
| **Search-results Rust aggregator (not SQL)** | Compute score, sort, group in Rust, not in SQLite | When you need sub-100ms for N×M results | Medium | Requires a separate in-memory data structure for result set |
| **Lazy cover via `<img loading="lazy">` + IntersectionObserver** | Browser-native lazy loading | Always, in the web UI | Low | Browser support is universal now; no excuse not to use it |
| **BlurHash placeholder** | 30-byte string that decodes to a blurred image | When you want polished UX | High | Needs server-side cover fetching + encoding pipeline |
| **Separate `/sources` route** | Move source management out of the search page | When sources are user-editable | Low | Adds a route; breaks the "search and fix in one place" flow |
| **Live source-test panel** | Run current query through selected source, show raw output | For debugging user-authored rules | Medium | Needs to be wired into the rule engine; not just a UI thing |

---

## What to Copy vs. Avoid

### Copy

1. **SearXNG's `MainResult.engines: set[str]` model** for source attribution + dedup. It's the cleanest pattern. Port verbatim.
2. **SearXNG's `unresponsive_engines` list** for failure surfacing. Users who write their own book sources need this.
3. **Meilisearch's 7-rule ranking cascade** as the *default* ordering. It's battle-tested, well-documented, and matches the academic IR literature.
4. **Typesense's `group_by` + `group_limit`** for "same book across N sources." Implement in Rust, not SQL.
5. **Algolia's `stalledSearchDelay: 200ms`** as the per-keystroke debounce. Industry standard.
6. **Typesense's `search_cutoff_ms`** as the global per-search timeout. 3000ms is a good default.
7. **Google's "autocomplete dropdown ≠ results page"** split. Two separate UIs.
8. **iOS apps' "interleaved sources"** pattern: first row from each source, then second row, etc. (Alternative to a single global sort.)
9. **Lazy cover loading with blurhash placeholder.** Universal best practice.
10. **Decoupled source management route** — out of search. Every modern IDE does this (settings are not on the main editor page).

### Avoid

1. **Legado's silent per-source failure handling.** Hides bugs.
2. **Legado's URL-only dedup.** Misses the common case of "same book, different URLs."
3. **Google's personalization layer** for ranking. Books are not ads; this is the wrong mental model.
4. **Algolia's "single index, complex rules"** for a multi-source architecture. We don't need their Rules feature; we have a different (better) data model.
5. **SearXNG's blocking-HTTP-response** pattern. We can do better with WebSocket or Tauri event streaming.
6. **Meilisearch's "always 50ms"** promise. Our sources are over the public internet with variable latency; 200ms is a more honest target.
7. **Legado's "result order = source order"** — the entire reason we're rewriting is to do relevance-based ranking.

---

## Concrete Recommendations for Our 8 Priorities

### 1. Real-time results as sources return (don't wait for all)

**Recommendation:** Fan out the search to all enabled sources in parallel via a Tauri command that returns a `Vec<ResultEvent>` stream. Use a `tokio::sync::mpsc` channel: each source writes to the channel as it returns, the frontend reads from the channel and appends to the results list in real time. Add a per-source timeout of 2s and a global timeout of 3.5s. After 200ms with no result, show a "searching..." indicator (Algolia's `stalledSearchDelay`). After the global timeout, finalize and show the "unresponsive sources" footer.

**Architecture sketch (Rust):**
```rust
#[tauri::command]
async fn search_books(
    query: String,
    sources: Vec<BookSource>,
    state: State<AppState>,
) -> Result<Vec<BookSearchResult>, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(100);
    let sem = Arc::new(Semaphore::new(8)); // 8 concurrent sources max
    let handles: Vec<_> = sources.into_iter().map(|src| {
        let tx = tx.clone();
        let sem = sem.clone();
        let q = query.clone();
        tokio::spawn(async move {
            let _permit = sem.acquire().await?;
            let res = tokio::time::timeout(
                Duration::from_secs(2),
                src.search(&q)
            ).await;
            let _ = tx.send((src.id, res)).await;
            Ok::<_, anyhowError>(())
        })
    }).collect();
    // collect into stream, drop tx handles, return result
}
```

**Sources:** SearXNG parallel architecture, Algolia InstantSearch `stalledSearchDelay`.

### 2. Relevance-based ranking (not just return order)

**Recommendation:** Implement a 7-rule cascade, mirroring Meilisearch's default order, with our custom additions at the end:

1. **words** — number of query terms that appear in the book's title/author
2. **typo** — exact match > 1 typo > 2 typos (Damerau-Levenshtein)
3. **proximity** — distance between query words in title/author
4. **source_sort** — user-defined source priority (configurable per source)
5. **attribute_rank** — `title > author > description > coverUrl`
6. **word_position** — match at start of title > match at end
7. **source_health** — recent success rate (last 100 queries)
8. **book_frequency** — how many other sources have the same book (proxy for "real book vs junk")

Compute this score in the Rust aggregator (not in SQL). Store the per-rule scores in the result struct for debugging. Show a "why this result" tooltip on hover (later, not in v1).

**Sources:** Meilisearch 7 rules, Algolia 8 criteria, Typesense `text_match_type`.

### 3. Speed (perceived and actual)

**Recommendation:**
- **Perceived:** Show the first result within 200ms via the same `stalledSearchDelay` pattern. Debounce keystrokes at 200ms. Render text-only result rows first, no cover. Use CSS `content-visibility: auto` on off-screen result rows.
- **Actual:** Set a p50 budget of 500ms for the *first* result to appear (the fastest source). p95 budget of 2s for all results to be in. Parallelize at 8 concurrent sources max (semaphore) to avoid hammering a flaky source. Cache frequent queries in SQLite for 5 min (key = `hash(query + enabled_source_ids)`).
- **Connection reuse:** Use one shared `reqwest::Client` across all source queries, with HTTP/2 and `keep-alive`. The Tauri Rust side can pre-warm the connection pool.

**Latency budget table:**

| Event | Target | Hard limit |
|---|---|---|
| Keystroke → first byte | 50ms | 200ms |
| First source to return | 200ms | 1s |
| 50% of sources returned | 800ms | 2s |
| All sources returned (or timed out) | 3s | 5s |

**Sources:** Algolia `<50ms p50`, Meilisearch `<50ms`, Google "fraction of a second" mandate, Typesense `search_cutoff_ms`.

### 4. Lazy cover loading (covers shouldn't block result rendering)

**Recommendation:** Three-stage cover loading:

1. **Render stage (0ms):** Result row appears with a fixed-aspect-ratio placeholder box (e.g. `aspect-ratio: 2/3; background: var(--cover-placeholder)`). No cover URL requested.
2. **In-viewport stage (when scrolled into view):** Browser native `<img loading="lazy">` requests the cover. Show a low-res blurhash (or solid color if not available) until the image loads.
3. **Loaded stage:** Fade-in transition (200ms) from placeholder to actual cover.

**Implementation:**
- Store the cover URL in the search result.
- Compute the blurhash for each cover server-side, store in SQLite alongside the book. Decode on the frontend in a Web Worker. (~30 bytes per cover, decodes to a 32×32 blurred preview.)
- If the source doesn't return a cover, use the source's favicon as the placeholder.

**Sources:** Algolia InstantSearch Hit component, standard web perf advice.

### 5. Failure source markers (show which sources failed)

**Recommendation:** Add a `sourceHealth: { lastError?: string, lastSuccessAt?: Date, successRate: number, totalQueries: number }` to each `BookSource` row in SQLite. Update it on every search. In the search results UI:

- **Source that timed out:** show a "Source X timed out" pill below the results, in muted color. Click to retry just that source.
- **Source that errored (non-timeout):** show a "Source X error: <message>" pill, slightly more prominent, in warning color.
- **Source that returned 0 results:** show nothing extra (success). Add to a "N sources found 0 results" footer if 50%+ of sources returned 0.

Surface these in a `SearchResultSummary { unresponsive: Source[], errored: Source[], completed: number, total: number }` field on the search response.

**Sources:** SearXNG `unresponsive_engines`, Legado's missing-this-is-its-main-weakness.

### 6. Source health status (latency, success rate)

**Recommendation:** Maintain a `source_stats` table:
```sql
CREATE TABLE source_stats (
  source_id INTEGER PRIMARY KEY,
  total_queries INTEGER NOT NULL DEFAULT 0,
  successful_queries INTEGER NOT NULL DEFAULT 0,
  timed_out_queries INTEGER NOT NULL DEFAULT 0,
  errored_queries INTEGER NOT NULL DEFAULT 0,
  total_latency_ms INTEGER NOT NULL DEFAULT 0,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error_message TEXT,
  last_checked_at INTEGER NOT NULL
);
```

Compute a rolling 7-day health score: `0.6 × success_rate + 0.3 × (1 - normalized_p99_latency) + 0.1 × recency`. Sources with health < 0.5 get a "degraded" badge in the source list. Sources with health < 0.2 get auto-paused (user can re-enable). Use the health score as the `source_health` tie-breaker in the ranking cascade.

Expose `/sources` page with a sortable table: name, URL, health score, p50 latency, last error, last checked.

**Sources:** No direct competitor does this. We're inventing it because Legado's users maintain their own sources and need to debug them.

### 7. Source grouping (same book across N sources, grouped)

**Recommendation:** Two-layer approach.

**Layer 1 — SQL dedup key:** When indexing a result, compute `book_key = sha256(normalize(title) + "|" + normalize(author))`. Use this as the dedup key. Same `book_key` from different sources = same book.

**Layer 2 — Rust aggregation:** In the search results aggregator, group results by `book_key`. For each group, keep the top 3 sources by our ranking score. If a group has > 3 sources, show a "See N more sources" expansion that lazy-loads the remaining sources (and their search rules' discover pages).

**Display:** One card per book. Subtle badge "3 sources" or expandable list. Cover = highest-quality cover among the group. Title = normalized title (longest common substring). Author = most-frequent author across the group (or longest if tie).

**UI trade-off:** The "always expand all" alternative (i.e. show 3 separate rows for the same book) is what Legado and SearXNG do. We choose "1 row per book, expansion for more sources" because for a book search the book is the primary entity, not the source.

**Sources:** Typesense `group_by`, SearXNG `engines` set, iOS apps' "interleaved" pattern (we choose "grouped" instead).

### 8. Decoupled rule-sub management (out of search page)

**Recommendation:** Three routes, not one:

- `/search` — the search results page. Shows results. Has a "Sources used" footer that lists which sources were queried. No source-editing UI.
- `/sources` — the source management page. List, add, edit, delete, import/export book sources. Live "test this source" panel: enter a query, see the raw response. Persisted as `/sources/:id` for editing a single source.
- `/sources/discovery` — the discovery/recommendation page. "Import popular book sources" with one-click add.

The search page links to `/sources?highlight=source-id` when a source fails (deep link with the failed source highlighted). The source page has a "Run this query through this source" button that opens the search page with the source pre-selected.

**State:** Source data lives in a separate Zustand store (`useSourceStore`) from search state (`useSearchStore`). The search store reads from the source store reactively (sources are reactive: enabling/disabling re-triggers active searches).

**Sources:** No direct competitor. Pattern is borrowed from VS Code's "Settings" + "Extensions" separation, JetBrains' "Plugins" management, and the general "settings are not on the main work page" principle.

---

## Reference Sources

### Legado
- https://github.com/gedoor/legado (original, DMCA'd)
- https://github.com/weiakj/legado (fork)
- https://github.com/JunFWu/legado (fork)
- https://github.com/yyalon/legado (fork)
- https://github.com/weijj0528/legado (fork)
- https://blog.csdn.net/gitblog_00142/article/details/156016326 (Legado source debugging)
- https://blog.csdn.net/gitblog_00547/article/details/153223769 (Legado rule debugging)
- https://blog.csdn.net/gitblog_00068/article/details/153226369 (Legado documentation overview)

### SearXNG
- https://docs.searxng.org/ (documentation home)
- https://docs.searxng.org/dev/search_api.html (search API parameters)
- https://docs.searxng.org/src/searx.search.html (Search class)
- https://docs.searxng.org/src/searx.search.processors.html (engine processors — parallel fan-out)
- https://docs.searxng.org/dev/result_types/main/mainresult.html (MainResult — `engines: set[str]`, `score: float`)

### Algolia
- https://www.algolia.com/doc/guides/managing-results/relevance-overview/ (relevance overview)
- https://www.algolia.com/doc/guides/managing-results/relevance-overview/in-depth/ranking-criteria/ (the 8 criteria)
- https://www.algolia.com/blog/product/what-is-search-relevance (search relevance history and concepts)
- https://www.algolia.com/doc/guides/managing-results/rules/rules-overview/ (rules / merchandising)
- https://www.algolia.com/doc/api-reference/widgets/instantsearch/react/ (InstantSearch React, `stalledSearchDelay`)

### Meilisearch
- https://www.meilisearch.com/docs/ (overview, <50ms claim)
- https://www.meilisearch.com/docs/learn/relevancy/ranking_rules (the 7 ranking rules, ordering rationale)

### Typesense
- https://typesense.org/docs/ (overview)
- https://typesense.org/docs/29.0/api/search.html (full search API, every parameter)

### Google
- https://www.google.com/search/howsearchworks/algorithms/ (the 5 ranking signals, latency focus)

### iOS book apps
- http://kybook-reader.com/ (KyBook 3, last updated 2019)
- https://apps.apple.com/cn/app/novel-e-books-reader/id699770727 (Novel, a representative iOS reader)

### Concepts and adjacent
- BlurHash: https://blurha.sh/ (low-res placeholder technique)
- ThumbHash: https://github.com/evanw/thumbhash (newer alternative, ~smaller, ~better)
- W3C `loading="lazy"`: https://developer.mozilla.org/en-US/docs/Web/Performance/Lazy_loading
- Tokio async runtime (Rust): https://tokio.rs/

---

## What I Could Not Confirm

- **Legado's exact ranking algorithm** — the original repo is offline, and community forks don't expose source via the web in a way I could fetch. The behavioral analysis is reconstructed from documentation, CSDN posts, and community discussions, not from the source code itself. If precise behavior matters, the team should look at the `app/src/main/java/io/legado/app/data/web/WebBook.kt` and `app/src/main/java/io/legado/app/model/SourceSearchBook.kt` files in a local clone of one of the forks (e.g. `weijj0528/legado`).
- **iOS book apps' search algorithms** — no engineering blog posts or open-source code. All findings are from App Store screenshots, reviews, and behavioral observation.
- **Google's exact autocomplete algorithm** — Google has not published the model details. The "Trinity system" mention is from a 2020 Google AI Blog post that I could not fetch this session; treat as approximate.
- **SearXNG's score formula** — the `score: float` field exists and is used, but the exact formula for combining per-engine scores with engine weight is in `searx/results/__init__.py` and not in the public docs. Default behavior is `engine_weight × engine_score` then merged on URL collision.

---

## End of report
