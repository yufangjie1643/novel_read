# Search Relevance Tuning — Observations

> Status: **No code change recommended yet.** Tuning is data-driven and the new search has not yet been used in production to collect meaningful signal.

## Current cascade (locked at v1)

Defined in `src-tauri/src/book_source/relevance.rs:189-201` (`Ord for ScoreBreakdown`):

| Order | Rule | Direction | Mapping |
|---|---|---|---|
| 1 | `words` | DESC | count of query chars present in title+author |
| 2 | `typo` | DESC | 255 − Damerau-Levenshtein |
| 3 | `proximity` | ASC | min span of query chars in title |
| 4 | `source_weight` | DESC | 100 + source.weight (clamp 50–200) |
| 5 | `attribute_rank` | DESC | title:3, author:2, intro:1 |
| 6 | `word_position` | ASC | first match char position in title |
| 7 | `source_health` | DESC | source_stats.health_score × 100 |

## When to revisit

- After 1+ weeks of real usage, query the `source_stats` table for sources with `health_score < 0.5` — these should rank lower in result lists.
- If users report typo queries returning too many false positives, swap `typo` later in the cascade or tighten the Damerau-Levenshtein distance.
- If users prefer a particular source, expose `source_weight` editing in `/sources/:sourceUrl` (currently a placeholder).

## Where to look when collecting data

- `source_stats` table: `total_queries`, `successful_queries`, `health_score` per source
- Tauri `cargo tauri dev` console: streaming events show each result's `ScoreBreakdown` indirectly (frontend logs to console)
- Browser DevTools (WebView2): Console pane shows the full event stream
