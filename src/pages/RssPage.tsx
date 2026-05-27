import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiResponse, RssSource, RssArticle } from "../types";

export default function RssPage() {
  const [sources, setSources] = useState<RssSource[]>([]);
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [selectedSource, setSelectedSource] = useState<RssSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceName, setNewSourceName] = useState("");
  const [readArticleIds, setReadArticleIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<RssSource[]>>("get_rss_sources");
      if (resp.success && resp.data) {
        setSources(resp.data);
      }
    } catch (e) {
      console.error("Failed to load RSS sources:", e);
    }
  }

  async function loadArticles(source: RssSource) {
    setSelectedSource(source);
    setLoading(true);
    setArticles([]);
    setMessage("Loading articles...");

    try {
      // For now, just show existing articles from DB
      const resp = await invoke<ApiResponse<RssArticle[]>>("get_rss_articles", {
        origin: source.source_url,
      });
      if (resp.success && resp.data) {
        setArticles(resp.data);
        setMessage(`${resp.data.length} articles`);

        // Check read status for each article
        const readIds = new Set<number>();
        for (const article of resp.data) {
          if (article.id) {
            try {
              const readResp = await invoke<ApiResponse<boolean>>("is_rss_read", {
                origin: source.source_url,
                article_id: article.id,
              });
              if (readResp.success && readResp.data) {
                readIds.add(article.id);
              }
            } catch {
              // ignore
            }
          }
        }
        setReadArticleIds(readIds);
      } else {
        setMessage("No articles found");
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
    setLoading(false);
  }

  async function addSource() {
    if (!newSourceUrl.trim() || !newSourceName.trim()) return;
    try {
      const source: RssSource = {
        source_url: newSourceUrl.trim(),
        source_name: newSourceName.trim(),
        enabled: true,
        custom_order: 0,
        last_update_time: 0,
      };
      await invoke("add_rss_source", { source });
      setNewSourceUrl("");
      setNewSourceName("");
      await loadSources();
    } catch (e) {
      setMessage(`Error adding source: ${e}`);
    }
  }

  async function deleteSource(source: RssSource) {
    if (!confirm(`Delete source "${source.source_name}"?`)) return;
    try {
      await invoke("delete_rss_source", { url: source.source_url });
      if (selectedSource?.source_url === source.source_url) {
        setSelectedSource(null);
        setArticles([]);
      }
      await loadSources();
    } catch (e) {
      setMessage(`Error deleting source: ${e}`);
    }
  }

  async function markAsRead(article: RssArticle) {
    if (!article.id) return;
    try {
      await invoke("mark_rss_read", {
        record: {
          origin: article.origin,
          article_id: article.id,
        },
      });
      setReadArticleIds((prev) => new Set(prev).add(article.id!));
    } catch (e) {
      console.error("Failed to mark as read:", e);
    }
  }

  return (
    <div style={{ display: "flex", gap: 24, minHeight: "70vh" }}>
      {/* Sources sidebar */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <h3>RSS Sources</h3>

        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Source name"
            value={newSourceName}
            onChange={(e) => setNewSourceName(e.target.value)}
            style={{ width: "100%", padding: 6, marginBottom: 4 }}
          />
          <input
            type="text"
            placeholder="Source URL"
            value={newSourceUrl}
            onChange={(e) => setNewSourceUrl(e.target.value)}
            style={{ width: "100%", padding: 6, marginBottom: 4 }}
          />
          <button onClick={addSource} style={{ width: "100%", padding: 6 }}>
            + Add Source
          </button>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 4, overflow: "hidden" }}>
          {sources.length === 0 ? (
            <p style={{ padding: 12, color: "#888" }}>No RSS sources</p>
          ) : (
            sources.map((s) => (
              <div
                key={s.source_url}
                onClick={() => loadArticles(s)}
                style={{
                  padding: "10px 12px",
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                  background:
                    selectedSource?.source_url === s.source_url ? "#e3f2fd" : "#fff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 500, fontSize: 14 }}>{s.source_name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSource(s);
                  }}
                  style={{
                    padding: "2px 6px",
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
            ))
          )}
        </div>
      </div>

      {/* Articles panel */}
      <div style={{ flex: 1 }}>
        {selectedSource ? (
          <>
            <h3>{selectedSource.source_name}</h3>
            {message && <p style={{ color: "#888" }}>{message}</p>}
            {loading ? (
              <p>Loading...</p>
            ) : (
              <div>
                {articles.map((article) => {
                  const isRead = article.id && readArticleIds.has(article.id);
                  return (
                    <div
                      key={article.id || article.title}
                      onClick={() => markAsRead(article)}
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #eee",
                        cursor: "pointer",
                        background: isRead ? "#f9f9f9" : "#fff",
                      }}
                    >
                      <div
                        style={{
                          fontWeight: isRead ? "normal" : "bold",
                          fontSize: 15,
                          color: isRead ? "#666" : "#333",
                        }}
                      >
                        {article.title}
                      </div>
                      {article.pub_date && (
                        <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                          {article.pub_date}
                        </div>
                      )}
                      {article.description && (
                        <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>
                          {article.description.slice(0, 200)}
                          {article.description.length > 200 ? "..." : ""}
                        </div>
                      )}
                      {article.link && (
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: 12, color: "#1976d2" }}
                        >
                          Open link
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <div style={{ color: "#888", textAlign: "center", padding: "60px 20px" }}>
            <p>Select a source to view articles</p>
          </div>
        )}
      </div>
    </div>
  );
}
