import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import type { ApiResponse, Book, BookGroup } from "../types";

export default function Bookshelf() {
  const [books, setBooks] = useState<Book[]>([]);
  const [groups, setGroups] = useState<BookGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [serverRunning, setServerRunning] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBookshelf();
    checkServerStatus();
  }, []);

  async function loadBookshelf() {
    setLoading(true);
    try {
      const [booksResp, groupsResp] = await Promise.all([
        invoke<ApiResponse<Book[]>>("get_books"),
        invoke<ApiResponse<BookGroup[]>>("get_book_groups"),
      ]);
      if (booksResp.success && booksResp.data) {
        setBooks(booksResp.data);
      }
      if (groupsResp.success && groupsResp.data) {
        setGroups(groupsResp.data.filter((g) => g.show));
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
    setLoading(false);
  }

  async function checkServerStatus() {
    try {
      const resp = await invoke<ApiResponse<boolean>>("get_web_server_status");
      if (resp.success && resp.data) {
        setServerRunning(resp.data);
      }
    } catch (e) {
      console.error("Failed to check server status:", e);
    }
  }

  async function toggleServer() {
    if (serverRunning) {
      try {
        await invoke("stop_web_server");
        setServerRunning(false);
        setServerUrl("");
      } catch (e) {
        setMessage(`Error stopping server: ${e}`);
      }
    } else {
      try {
        const resp = await invoke<ApiResponse<string>>("start_web_server", { port: 1122 });
        if (resp.success && resp.data) {
          setServerRunning(true);
          setServerUrl(resp.data);
        } else {
          setMessage(`Failed to start server: ${resp.error}`);
        }
      } catch (e) {
        setMessage(`Error starting server: ${e}`);
      }
    }
  }

  async function deleteBook(bookUrl: string) {
    if (!confirm("Delete this book from bookshelf?")) return;
    try {
      const resp = await invoke<ApiResponse<null>>("delete_book", { book_url: bookUrl });
      if (resp.success) {
        setBooks((prev) => prev.filter((b) => b.book_url !== bookUrl));
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setMessage("Please select a .txt file");
      return;
    }

    setImporting(true);
    setMessage("Reading file...");

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) {
        setMessage("Failed to read file");
        setImporting(false);
        return;
      }

      setMessage("Importing...");
      try {
        const resp = await invoke<ApiResponse<{ book_url: string; name: string; chapter_count: number }>>(
          "import_txt_book",
          { content, file_name: file.name }
        );
        if (resp.success && resp.data) {
          setMessage(`Imported "${resp.data.name}" with ${resp.data.chapter_count} chapters`);
          await loadBookshelf();
        } else {
          setMessage(`Import failed: ${resp.error || "unknown error"}`);
        }
      } catch (err) {
        setMessage(`Error: ${err}`);
      }
      setImporting(false);
      // Reset input so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.onerror = () => {
      setMessage("Failed to read file");
      setImporting(false);
    };
    reader.readAsText(file, "UTF-8");
  }

  if (loading) {
    return <p style={{ color: "#888" }}>Loading bookshelf...</p>;
  }

  const filteredBooks =
    selectedGroup === null
      ? books
      : books.filter((b) => b.group === selectedGroup);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Bookshelf</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {serverRunning && (
            <span style={{ fontSize: 12, color: "#4caf50" }}>
              Server: {serverUrl}
            </span>
          )}
          <button
            onClick={toggleServer}
            style={{
              padding: "6px 12px",
              background: serverRunning ? "#ff5722" : "#2196f3",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {serverRunning ? "Stop Server" : "Start Server"}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            style={{
              padding: "8px 16px",
              background: "#4caf50",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              cursor: importing ? "not-allowed" : "pointer",
              fontSize: 14,
            }}
          >
            {importing ? "Importing..." : "+ Import TXT"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            style={{ display: "none" }}
            onChange={handleFileSelect}
          />
        </div>
      </div>
      {message && <p style={{ color: "#c00" }}>{message}</p>}

      {/* Group tabs */}
      {groups.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button
            onClick={() => setSelectedGroup(null)}
            style={{
              padding: "4px 12px",
              borderRadius: 16,
              border: "1px solid #ddd",
              background: selectedGroup === null ? "#1976d2" : "#fff",
              color: selectedGroup === null ? "#fff" : "#333",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            All
          </button>
          {groups.map((g) => (
            <button
              key={g.group_id}
              onClick={() => setSelectedGroup(g.group_id)}
              style={{
                padding: "4px 12px",
                borderRadius: 16,
                border: "1px solid #ddd",
                background: selectedGroup === g.group_id ? "#1976d2" : "#fff",
                color: selectedGroup === g.group_id ? "#fff" : "#333",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {g.group_name}
            </button>
          ))}
        </div>
      )}

      {filteredBooks.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "#888" }}>
          <p>No books saved yet.</p>
          <p>
            <Link to="/search" style={{ color: "#1976d2" }}>
              Go search for books
            </Link>
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
          {filteredBooks.map((book) => (
            <div
              key={book.book_url}
              style={{
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {book.cover_url && (
                <img
                  src={book.cover_url}
                  alt={book.name}
                  style={{ width: "100%", height: 200, objectFit: "cover", borderRadius: 4 }}
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              )}
              <Link
                to={`/book/${encodeURIComponent(book.book_url)}`}
                style={{ fontWeight: "bold", fontSize: 15, color: "#333", textDecoration: "none" }}
              >
                {book.name}
              </Link>
              <div style={{ color: "#666", fontSize: 13 }}>{book.author}</div>
              {book.dur_chapter_title && (
                <div style={{ color: "#888", fontSize: 12 }}>
                  Reading: {book.dur_chapter_title}
                </div>
              )}
              <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
                <Link
                  to={`/book/${encodeURIComponent(book.book_url)}`}
                  style={{
                    flex: 1,
                    textAlign: "center",
                    padding: "6px 12px",
                    background: "#1976d2",
                    color: "#fff",
                    borderRadius: 4,
                    textDecoration: "none",
                    fontSize: 13,
                  }}
                >
                  {book.dur_chapter_title ? "Continue" : "Read"}
                </Link>
                <button
                  onClick={() => deleteBook(book.book_url)}
                  style={{
                    padding: "6px 12px",
                    background: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
