import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ApiResponse, BookSource } from "../types";

interface DebugResult {
  request_url: string;
  raw_response: string;
  parsed_result: string;
}

export default function DebugPage() {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [selectedSourceUrl, setSelectedSourceUrl] = useState("");
  const [step, setStep] = useState("search");
  const [key, setKey] = useState("");
  const [bookUrl, setBookUrl] = useState("");
  const [chapterUrl, setChapterUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebugResult | null>(null);
  const [error, setError] = useState("");

  async function loadSources() {
    try {
      const resp = await invoke<ApiResponse<BookSource[]>>("get_book_sources");
      if (resp.success && resp.data) {
        setSources(resp.data);
        if (resp.data.length > 0 && !selectedSourceUrl) {
          setSelectedSourceUrl(resp.data[0].book_source_url);
        }
      }
    } catch (e) {
      console.error("Failed to load sources:", e);
    }
  }

  async function runDebug() {
    const source = sources.find((s) => s.book_source_url === selectedSourceUrl);
    if (!source) {
      setError("Please select a source");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const resp = await invoke<ApiResponse<DebugResult>>("debug_book_source", {
        source,
        step,
        key: key || null,
        book_url: bookUrl || null,
        chapter_url: chapterUrl || null,
      });
      if (resp.success && resp.data) {
        setResult(resp.data);
      } else {
        setError(resp.error || "Debug failed");
      }
    } catch (e) {
      setError(`Error: ${e}`);
    }
    setLoading(false);
  }

  return (
    <div>
      <h2>Source Debug Tool</h2>

      <div style={{ marginBottom: 16 }}>
        <button onClick={loadSources} disabled={loading}>
          Load Sources
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Source:</label>
          <select
            value={selectedSourceUrl}
            onChange={(e) => setSelectedSourceUrl(e.target.value)}
            style={{ width: "100%", padding: 8 }}
          >
            <option value="">Select a source</option>
            {sources.map((s) => (
              <option key={s.book_source_url} value={s.book_source_url}>
                {s.book_source_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Step:</label>
          <select
            value={step}
            onChange={(e) => setStep(e.target.value)}
            style={{ padding: 8 }}
          >
            <option value="search">Search</option>
            <option value="book_info">Book Info</option>
            <option value="chapter_list">Chapter List</option>
            <option value="content">Content</option>
          </select>
        </div>

        {step === "search" && (
          <div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Search Key:</label>
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter search keyword"
              style={{ width: "100%", padding: 8 }}
            />
          </div>
        )}

        {(step === "book_info" || step === "chapter_list") && (
          <div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Book URL:</label>
            <input
              type="text"
              value={bookUrl}
              onChange={(e) => setBookUrl(e.target.value)}
              placeholder="Enter book URL"
              style={{ width: "100%", padding: 8 }}
            />
          </div>
        )}

        {step === "content" && (
          <>
            <div>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Book URL:</label>
              <input
                type="text"
                value={bookUrl}
                onChange={(e) => setBookUrl(e.target.value)}
                placeholder="Enter book URL"
                style={{ width: "100%", padding: 8 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Chapter URL:</label>
              <input
                type="text"
                value={chapterUrl}
                onChange={(e) => setChapterUrl(e.target.value)}
                placeholder="Enter chapter URL"
                style={{ width: "100%", padding: 8 }}
              />
            </div>
          </>
        )}

        <button onClick={runDebug} disabled={loading} style={{ padding: "8px 16px" }}>
          {loading ? "Running..." : "Run Debug"}
        </button>
      </div>

      {error && <p style={{ color: "#c00" }}>{error}</p>}

      {result && (
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
          <h3>Request URL</h3>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 4,
              overflow: "auto",
              fontSize: 13,
            }}
          >
            {result.request_url}
          </pre>

          <h3>Raw Response (first 5000 chars)</h3>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 4,
              overflow: "auto",
              fontSize: 12,
              maxHeight: 400,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {result.raw_response}
          </pre>

          <h3>Parsed Result</h3>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 4,
              overflow: "auto",
              fontSize: 13,
              maxHeight: 400,
              whiteSpace: "pre-wrap",
            }}
          >
            {result.parsed_result}
          </pre>
        </div>
      )}
    </div>
  );
}
