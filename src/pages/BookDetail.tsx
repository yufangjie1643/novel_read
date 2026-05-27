import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ApiResponse, Book, BookChapter, BookSource } from "../types";

export default function BookDetail() {
  const { bookUrl } = useParams();
  const navigate = useNavigate();
  const decodedUrl = decodeURIComponent(bookUrl || "");

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [_sources, setSources] = useState<BookSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    loadBookAndChapters();
  }, [decodedUrl]);

  async function loadBookAndChapters() {
    if (!decodedUrl) return;
    setLoading(true);

    // Load book from DB
    try {
      const bookResp = await invoke<ApiResponse<Book[]>>("get_books");
      if (bookResp.success && bookResp.data) {
        const found = bookResp.data.find((b) => b.book_url === decodedUrl);
        if (found) {
          setBook(found);
          // Load chapters from DB
          const chapResp = await invoke<ApiResponse<BookChapter[]>>("get_chapters", {
            book_url: decodedUrl,
          });
          if (chapResp.success && chapResp.data && chapResp.data.length > 0) {
            setChapters(chapResp.data);
            setLoading(false);
            return;
          }
          // No cached chapters - fetch from source
          await fetchChaptersFromSource(found);
        } else {
          setMessage("Book not found in bookshelf");
        }
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
    setLoading(false);
  }

  async function fetchChaptersFromSource(book: Book) {
    setMessage("Loading chapters from source...");
    try {
      const sourcesResp = await invoke<ApiResponse<BookSource[]>>("get_book_sources");
      if (!sourcesResp.success || !sourcesResp.data) {
        setMessage("Failed to load sources");
        return;
      }
      const source = sourcesResp.data.find((s) => s.book_source_url === book.origin);
      if (!source) {
        setMessage("Source not found");
        return;
      }
      setSources(sourcesResp.data);

      const chapResp = await invoke<ApiResponse<BookChapter[]>>("fetch_chapter_list", {
        source,
        book,
      });
      if (chapResp.success && chapResp.data) {
        setChapters(chapResp.data);
        // Cache chapters to DB
        await invoke("add_chapters", { chapters: chapResp.data });
        setMessage(`Loaded ${chapResp.data.length} chapters`);
      } else {
        setMessage(`Failed to load chapters: ${chapResp.error}`);
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
  }

  function readChapter(chapter: BookChapter) {
    navigate(`/reader/${encodeURIComponent(decodedUrl)}/${chapter.index}`);
  }

  if (loading) {
    return <p style={{ color: "#888" }}>Loading book info...</p>;
  }

  if (!book) {
    return <p style={{ color: "#c00" }}>{message || "Book not found"}</p>;
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} style={{ marginBottom: 16 }}>
        ← Back
      </button>

      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        {book.cover_url && (
          <img
            src={book.cover_url}
            alt="cover"
            style={{ width: 120, height: 150, objectFit: "cover", borderRadius: 4 }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
          />
        )}
        <div>
          <h1>{book.name}</h1>
          <p style={{ color: "#666" }}>
            {book.author}
            {book.latest_chapter_title && ` · ${book.latest_chapter_title}`}
          </p>
          {book.intro && (
            <p style={{ color: "#555", fontSize: 14, lineHeight: 1.5 }}>{book.intro}</p>
          )}
        </div>
      </div>

      {message && <p style={{ color: "#666", fontStyle: "italic", marginBottom: 12 }}>{message}</p>}

      <h2>Chapters ({chapters.length})</h2>
      <div
        style={{
          maxHeight: 500,
          overflow: "auto",
          border: "1px solid #ccc",
          padding: 8,
        }}
      >
        {chapters.map((ch) => (
          <div
            key={ch.index}
            onClick={() => readChapter(ch)}
            style={{
              padding: "6px 8px",
              cursor: "pointer",
              borderBottom: "1px solid #eee",
              fontSize: 14,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {ch.title}
          </div>
        ))}
      </div>
    </div>
  );
}
