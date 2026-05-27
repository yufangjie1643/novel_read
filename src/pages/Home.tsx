import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import type { ApiResponse, BookSource, SearchBook, SearchKeyword, RuleSub } from "../types";

export default function Home() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [searchResults, setSearchResults] = useState<SearchBook[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchKeyword[]>([]);
  const [ruleSubs, setRuleSubs] = useState<RuleSub[]>([]);
  const [newSubUrl, setNewSubUrl] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadSources();
    loadSearchHistory();
    loadRuleSubs();
  }, []);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>("get_book_sources");
      if (resp.success && resp.data) {
        setSources(resp.data);
      }
    } catch (e) {
      console.error("Failed to load sources:", e);
    }
  }

  async function loadSearchHistory() {
    try {
      const resp = await invoke<ApiResponse<SearchKeyword[]>>("get_search_keywords", {
        limit: 10,
      });
      if (resp.success && resp.data) {
        setSearchHistory(resp.data);
      }
    } catch (e) {
      console.error("Failed to load search history:", e);
    }
  }

  async function saveSearchKeyword(keyword: string) {
    try {
      await invoke("add_search_keyword", { keyword: keyword.trim() });
      await loadSearchHistory();
    } catch (e) {
      console.error("Failed to save keyword:", e);
    }
  }

  async function clearHistory() {
    try {
      await invoke("clear_search_keywords");
      setSearchHistory([]);
    } catch (e) {
      console.error("Failed to clear history:", e);
    }
  }

  async function loadRuleSubs() {
    try {
      const resp = await invoke<ApiResponse<RuleSub[]>>("get_rule_subs");
      if (resp.success && resp.data) {
        setRuleSubs(resp.data);
      }
    } catch (e) {
      console.error("Failed to load rule subs:", e);
    }
  }

  async function addRuleSub() {
    if (!newSubUrl.trim() || !newSubName.trim()) return;
    try {
      await invoke("add_rule_sub", {
        sub: {
          name: newSubName.trim(),
          url: newSubUrl.trim(),
          sub_type: 0,
          custom_order: 0,
          enabled: true,
          auto_update: true,
          last_update_time: 0,
        },
      });
      setNewSubUrl("");
      setNewSubName("");
      await loadRuleSubs();
    } catch (e) {
      setMessage(`Error adding subscription: ${e}`);
    }
  }

  async function deleteRuleSub(id: number) {
    try {
      await invoke("delete_rule_sub", { id });
      await loadRuleSubs();
    } catch (e) {
      setMessage(`Error deleting subscription: ${e}`);
    }
  }

  async function checkSubUpdates() {
    setLoading(true);
    setMessage("Checking subscriptions...");
    let updated = 0;
    for (const sub of ruleSubs.filter((s) => s.enabled && s.url)) {
      try {
        const resp = await invoke<ApiResponse<BookSource[]>>("import_source_from_url", {
          url: sub.url,
        });
        if (resp.success && resp.data) {
          for (const source of resp.data) {
            await invoke("add_book_source", { source });
          }
          updated += resp.data.length;
        }
      } catch (e) {
        console.error(`Failed to update ${sub.name}:`, e);
      }
    }
    setMessage(`Updated ${updated} sources from subscriptions`);
    setLoading(false);
    await loadSources();
  }

  async function importSource() {
    if (!sourceUrl.trim()) return;
    setLoading(true);
    setMessage("Importing...");
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>("import_source_from_url", {
        url: sourceUrl.trim(),
      });
      if (resp.success && resp.data) {
        for (const source of resp.data) {
          await invoke("add_book_source", { source });
        }
        setMessage(`Imported ${resp.data.length} sources`);
        await loadSources();
      } else {
        setMessage(`Import failed: ${resp.error || "unknown error"}`);
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
    setLoading(false);
  }

  async function searchBooks() {
    if (!searchKey.trim()) return;
    const enabledSources = sources.filter((s) => s.enabled && s.search_url);
    if (enabledSources.length === 0) {
      setMessage("No enabled sources with search URL");
      return;
    }
    setLoading(true);
    setMessage(`Searching ${enabledSources.length} sources...`);
    setSearchResults([]);

    // Concurrent search across all enabled sources
    const results = await Promise.allSettled(
      enabledSources.map(async (source) => {
        const resp = await invoke<ApiResponse<SearchBook[]>>("search_books", {
          source,
          key: searchKey.trim(),
          page: 1,
        });
        if (resp.success && resp.data) {
          return resp.data;
        }
        return [];
      })
    );

    const allResults: SearchBook[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      if (result.status === "fulfilled") {
        for (const book of result.value) {
          const key = `${book.name}|${book.author || ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            allResults.push(book);
          }
        }
      }
    }

    setSearchResults(allResults);
    setMessage(`Found ${allResults.length} unique results from ${enabledSources.length} sources`);
    setLoading(false);

    // Save search keyword to history
    await saveSearchKeyword(searchKey.trim());
  }

  async function openBook(book: SearchBook) {
    setMessage("Loading book info...");
    const source = sources.find((s) => s.book_source_url === book.origin);
    if (!source) {
      setMessage("Source not found");
      return;
    }

    const initialBook = {
      book_url: book.book_url,
      toc_url: book.toc_url || book.book_url,
      origin: book.origin || "",
      origin_name: book.origin_name || "",
      name: book.name,
      author: book.author || "",
      intro: book.intro,
      cover_url: book.cover_url,
      latest_chapter_title: book.latest_chapter_title,
    };

    try {
      const resp = await invoke<ApiResponse<Record<string, unknown>>>("fetch_book_info", {
        source,
        book: initialBook,
      });
      if (resp.success && resp.data) {
        const bookData = resp.data as unknown as {
          book_url: string;
          toc_url: string;
          origin: string;
          origin_name: string;
          name: string;
          author: string;
          intro?: string;
          cover_url?: string;
          latest_chapter_title?: string;
        };
        await invoke("add_book", { book: bookData });
        navigate(`/book/${encodeURIComponent(bookData.book_url)}`);
      } else {
        setMessage(`Failed to load book info: ${resp.error}`);
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
  }

  return (
    <div>
      <section style={{ marginBottom: 24 }}>
        <h2>Import Source</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="Enter book source URL"
            style={{ flex: 1, padding: 8 }}
          />
          <button onClick={importSource} disabled={loading}>
            Import
          </button>
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Sources ({sources.length})</h2>
        <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid #ccc", padding: 8 }}>
          {sources.length === 0 ? (
            <p style={{ color: "#888" }}>No sources imported yet</p>
          ) : (
            sources.map((s) => (
              <div key={s.book_source_url} style={{ marginBottom: 4, fontSize: 14 }}>
                <span style={{ fontWeight: "bold" }}>{s.book_source_name}</span>
                <span style={{ color: s.enabled ? "green" : "red", marginLeft: 8 }}>
                  {s.enabled ? "enabled" : "disabled"}
                </span>
                {s.search_url && <span style={{ color: "#888", marginLeft: 8 }}>[search]</span>}
              </div>
            ))
          )}
        </div>
      </section>

      <section style={{ marginBottom: 24 }}>
        <h2>Search</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            placeholder="Enter book name"
            style={{ flex: 1, padding: 8 }}
            onKeyDown={(e) => e.key === "Enter" && searchBooks()}
          />
          <button onClick={searchBooks} disabled={loading}>
            Search
          </button>
        </div>

        {/* Search history */}
        {searchHistory.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#888" }}>History:</span>
            {searchHistory.map((item) => (
              <button
                key={item.id || item.keyword}
                onClick={() => {
                  setSearchKey(item.keyword);
                  searchBooks();
                }}
                style={{
                  padding: "2px 10px",
                  borderRadius: 12,
                  border: "1px solid #ddd",
                  background: "#f5f5f5",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "#555",
                }}
              >
                {item.keyword}
              </button>
            ))}
            <button
              onClick={clearHistory}
              style={{
                padding: "2px 10px",
                borderRadius: 12,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
                color: "#c00",
              }}
            >
              Clear
            </button>
          </div>
        )}
      </section>

      {message && <p style={{ color: "#666", fontStyle: "italic" }}>{message}</p>}

      <section style={{ marginBottom: 24 }}>
        <h2>Results ({searchResults.length})</h2>
        {searchResults.map((book, i) => (
          <div
            key={i}
            onClick={() => openBook(book)}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              display: "flex",
              gap: 12,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9f9f9")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {book.cover_url && (
              <img
                src={book.cover_url}
                alt="cover"
                style={{ width: 80, height: 100, objectFit: "cover", borderRadius: 4 }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "bold", fontSize: 16 }}>{book.name}</div>
              <div style={{ color: "#666", fontSize: 14 }}>
                {book.author} {book.kind && `· ${book.kind}`}
              </div>
              {book.latest_chapter_title && (
                <div style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
                  Latest: {book.latest_chapter_title}
                </div>
              )}
              {book.intro && (
                <div style={{ color: "#555", fontSize: 13, marginTop: 4, lineHeight: 1.4 }}>
                  {book.intro.slice(0, 120)}
                  {book.intro.length > 120 ? "..." : ""}
                </div>
              )}
              <div style={{ color: "#999", fontSize: 12, marginTop: 4 }}>
                Source: {book.origin_name || "unknown"}
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Rule Subscriptions */}
      <section style={{ marginTop: 32, borderTop: "2px solid #eee", paddingTop: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2>Source Subscriptions</h2>
          <button onClick={checkSubUpdates} disabled={loading || ruleSubs.length === 0}>
            Check Updates
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Subscription name"
            value={newSubName}
            onChange={(e) => setNewSubName(e.target.value)}
            style={{ padding: 6, marginRight: 8, width: 150 }}
          />
          <input
            type="text"
            placeholder="Subscription URL"
            value={newSubUrl}
            onChange={(e) => setNewSubUrl(e.target.value)}
            style={{ padding: 6, marginRight: 8, width: 300 }}
          />
          <button onClick={addRuleSub}>Add</button>
        </div>

        {ruleSubs.length === 0 ? (
          <p style={{ color: "#888" }}>No subscriptions</p>
        ) : (
          <div style={{ border: "1px solid #ddd", borderRadius: 4 }}>
            {ruleSubs.map((sub) => (
              <div
                key={sub.id}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid #eee",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{sub.name || "Unnamed"}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>{sub.url}</div>
                </div>
                <button
                  onClick={() => sub.id && deleteRuleSub(sub.id)}
                  style={{
                    padding: "2px 8px",
                    fontSize: 12,
                    color: "#c00",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
