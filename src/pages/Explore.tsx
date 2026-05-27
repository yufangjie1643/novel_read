import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import type { ApiResponse, BookSource, SearchBook } from "../types";

interface ExploreItem {
  source: BookSource;
  label: string;
  url: string;
}

export default function Explore() {
  const navigate = useNavigate();
  const [sources, setSources] = useState<BookSource[]>([]);
  const [exploreItems, setExploreItems] = useState<ExploreItem[]>([]);
  const [results, setResults] = useState<SearchBook[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [activeItem, setActiveItem] = useState<ExploreItem | null>(null);

  useEffect(() => {
    loadSources();
  }, []);

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>("get_book_sources");
      if (resp.success && resp.data) {
        setSources(resp.data);

        // Parse explore URLs from sources
        const items: ExploreItem[] = [];
        for (const source of resp.data) {
          if (!source.enabled_explore || !source.explore_url) continue;

          // Explore URLs can be multi-line: "label::url\nlabel2::url2"
          const lines = source.explore_url.split(/\n|\r\n/);
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.includes("::")) {
              const parts = trimmed.split("::");
              items.push({
                source,
                label: parts[0] || source.book_source_name,
                url: parts.slice(1).join("::"),
              });
            } else {
              items.push({
                source,
                label: source.book_source_name,
                url: trimmed,
              });
            }
          }
        }
        setExploreItems(items);
      }
    } catch (e) {
      console.error("Failed to load sources:", e);
    }
  }

  async function fetchExplore(item: ExploreItem) {
    setActiveItem(item);
    setLoading(true);
    setMessage("Loading...");
    setResults([]);

    try {
      const resp = await invoke<ApiResponse<SearchBook[]>>("explore_books", {
        source: item.source,
        url: item.url,
        page: 1,
      });
      if (resp.success && resp.data) {
        setResults(resp.data);
        setMessage(`Found ${resp.data.length} books`);
      } else {
        setMessage(`Failed: ${resp.error || "unknown error"}`);
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
    setLoading(false);
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
        setMessage(`Failed: ${resp.error}`);
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
  }

  return (
    <div>
      <h1>Explore</h1>

      {exploreItems.length === 0 ? (
        <p style={{ color: "#888" }}>No sources with explore URLs configured.</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {exploreItems.map((item, i) => (
            <button
              key={i}
              onClick={() => fetchExplore(item)}
              disabled={loading}
              style={{
                padding: "6px 12px",
                borderRadius: 16,
                border: "1px solid #ccc",
                background: activeItem === item ? "#1976d2" : "#fff",
                color: activeItem === item ? "#fff" : "#333",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {message && <p style={{ color: "#666", fontStyle: "italic" }}>{message}</p>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
        {results.map((book, i) => (
          <div
            key={i}
            onClick={() => openBook(book)}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: 12,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9f9f9")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {book.cover_url && (
              <img
                src={book.cover_url}
                alt={book.name}
                style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 4 }}
                onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
              />
            )}
            <div style={{ fontWeight: "bold", fontSize: 14 }}>{book.name}</div>
            <div style={{ color: "#666", fontSize: 12 }}>{book.author}</div>
            {book.intro && (
              <div style={{ color: "#888", fontSize: 12, lineHeight: 1.4 }}>
                {book.intro.slice(0, 80)}{book.intro.length > 80 ? "..." : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
