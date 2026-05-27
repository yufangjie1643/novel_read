import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import type { ApiResponse, Book, BookChapter, BookSource, ReplaceRule } from "../types";

export default function Reader() {
  const { bookUrl, chapterIndex } = useParams();
  const navigate = useNavigate();
  const decodedUrl = decodeURIComponent(bookUrl || "");
  const idx = parseInt(chapterIndex || "0", 10);
  const contentRef = useRef<HTMLDivElement>(null);

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [replaceRules, setReplaceRules] = useState<ReplaceRule[]>([]);

  // Reader settings
  const [fontSize, setFontSize] = useState(() => {
    return parseInt(localStorage.getItem("reader_font_size") || "18", 10);
  });
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem("reader_theme") || "light";
  });
  const [showSettings, setShowSettings] = useState(false);

  // TTS state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [ttsRate, setTtsRate] = useState(() => {
    return parseFloat(localStorage.getItem("reader_tts_rate") || "1");
  });
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Cleanup TTS on unmount or chapter change
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [idx]);

  function startTTS() {
    if (!window.speechSynthesis) {
      setMessage("TTS not supported in this browser");
      return;
    }

    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    const text = applyReplaceRules(content);
    if (!text.trim()) return;

    // Split into paragraphs/sentences
    const chunks = text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let currentIndex = 0;

    function speakNext() {
      if (currentIndex >= chunks.length) {
        setIsSpeaking(false);
        setIsPaused(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[currentIndex]);
      utterance.rate = ttsRate;
      utterance.lang = "zh-CN"; // Default to Chinese for novel reading

      utterance.onend = () => {
        currentIndex++;
        speakNext();
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
        setIsPaused(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    }

    setIsSpeaking(true);
    setIsPaused(false);
    speakNext();
  }

  function pauseTTS() {
    if (window.speechSynthesis && isSpeaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }

  function resumeTTS() {
    if (window.speechSynthesis && isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }

  function stopTTS() {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
  }

  useEffect(() => {
    loadData();
  }, [decodedUrl, idx]);

  async function loadData() {
    if (!decodedUrl) return;
    setLoading(true);
    setContent("");

    try {
      // Load book
      const bookResp = await invoke<ApiResponse<Book[]>>("get_books");
      if (bookResp.success && bookResp.data) {
        const found = bookResp.data.find((b) => b.book_url === decodedUrl);
        if (found) setBook(found);
      }

      // Load chapters
      const chapResp = await invoke<ApiResponse<BookChapter[]>>("get_chapters", {
        book_url: decodedUrl,
      });
      if (chapResp.success && chapResp.data) {
        setChapters(chapResp.data);
      }

      // Load replace rules
      const rulesResp = await invoke<ApiResponse<ReplaceRule[]>>("get_replace_rules");
      if (rulesResp.success && rulesResp.data) {
        setReplaceRules(rulesResp.data);
      }

      // Load content
      await loadContent(decodedUrl, idx);
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
    setLoading(false);
  }

  async function loadContent(_url: string, index: number) {
    setMessage("Loading content...");
    try {
      // 1. Try local cache first
      const cacheResp = await invoke<ApiResponse<string | null>>("get_local_chapter_content", {
        book_url: decodedUrl,
        chapter_index: index,
      });
      if (cacheResp.success && cacheResp.data) {
        setContent(cacheResp.data);
        setMessage("");
        await saveProgress(index);
        return;
      }

      const chapter = chapters.find((c) => c.index === index);
      if (!chapter) {
        setMessage("Chapter not found");
        return;
      }

      // 2. No cache — fetch from source
      if (!book) {
        setMessage("Book not loaded");
        return;
      }

      if (book.origin === "local") {
        // Local book: extract from stored chapters (content not yet split from original TXT)
        setMessage("Local chapter content extraction not yet implemented");
        return;
      }

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

      const resp = await invoke<ApiResponse<string>>("fetch_chapter_content", {
        source,
        book,
        chapter,
      });
      if (resp.success && resp.data !== undefined) {
        setContent(resp.data);
        setMessage("");

        // Save to local cache
        await invoke("save_local_chapter_content", {
          book_url: decodedUrl,
          chapter_index: index,
          content: resp.data,
        });

        await saveProgress(index);
      } else {
        setMessage(`Failed to load content: ${resp.error}`);
      }
    } catch (e) {
      setMessage(`Error: ${e}`);
    }
  }

  async function saveProgress(index: number) {
    if (!book) return;
    const chapter = chapters.find((c) => c.index === index);
    const updatedBook = {
      ...book,
      dur_chapter_title: chapter?.title || "",
      dur_chapter_index: index,
      dur_chapter_pos: 0,
      dur_chapter_time: Date.now(),
    };
    await invoke("update_book", { book: updatedBook });
  }

  function applyReplaceRules(rawContent: string): string {
    if (!replaceRules.length) return rawContent;

    const sortedRules = [...replaceRules]
      .filter((r) => r.enabled)
      .sort((a, b) => a.order - b.order);

    let result = rawContent;
    for (const rule of sortedRules) {
      if (!rule.pattern) continue;

      // Check scope: if scope is set, only apply to matching book names/origins
      if (rule.scope && book) {
        const scopes = rule.scope.split(/[,|]/).map((s) => s.trim());
        const match = scopes.some(
          (s) =>
            s === book.name ||
            s === book.origin ||
            s === book.book_url ||
            s === book.author
        );
        if (!match) continue;
      }

      try {
        if (rule.is_regex) {
          const regex = new RegExp(rule.pattern, "g");
          result = result.replace(regex, rule.replacement || "");
        } else {
          result = result.split(rule.pattern).join(rule.replacement || "");
        }
      } catch {
        // Skip invalid regex
      }
    }
    return result;
  }

  const currentChapter = chapters.find((c) => c.index === idx);
  const prevChapter = chapters.find((c) => c.index === idx - 1);
  const nextChapter = chapters.find((c) => c.index === idx + 1);

  function goToChapter(index: number) {
    navigate(`/reader/${encodeURIComponent(decodedUrl)}/${index}`);
    window.scrollTo(0, 0);
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          if (prevChapter) {
            e.preventDefault();
            goToChapter(prevChapter.index);
          }
          break;
        case "ArrowRight":
        case "d":
        case "D":
          if (nextChapter) {
            e.preventDefault();
            goToChapter(nextChapter.index);
          }
          break;
        case "Escape":
          navigate(`/book/${encodeURIComponent(decodedUrl)}`);
          break;
        case " ":
          e.preventDefault();
          if (isSpeaking) {
            if (isPaused) resumeTTS();
            else pauseTTS();
          } else {
            startTTS();
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          setFontSize((s) => {
            const ns = Math.min(32, s + 2);
            localStorage.setItem("reader_font_size", String(ns));
            return ns;
          });
          break;
        case "-":
        case "_":
          e.preventDefault();
          setFontSize((s) => {
            const ns = Math.max(12, s - 2);
            localStorage.setItem("reader_font_size", String(ns));
            return ns;
          });
          break;
        case "s":
        case "S":
          e.preventDefault();
          setShowSettings((prev) => !prev);
          break;
        case "t":
        case "T":
          e.preventDefault();
          if (isSpeaking) stopTTS();
          else startTTS();
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [prevChapter, nextChapter, isSpeaking, isPaused, decodedUrl, navigate]);

  const themeStyles: Record<
    string,
    { bg: string; text: string; button: string }
  > = {
    light: { bg: "#fff", text: "#333", button: "#f0f0f0" },
    dark: { bg: "#1a1a1a", text: "#ccc", button: "#333" },
    sepia: { bg: "#f4ecd8", text: "#5b4636", button: "#e8dec0" },
  };
  const t = themeStyles[theme] || themeStyles.light;

  return (
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh" }}>
      {/* Toolbar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          background: t.bg,
          borderBottom: "1px solid #ccc",
          padding: "8px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={() => navigate(`/book/${encodeURIComponent(decodedUrl)}`)}
            style={{
              background: t.button,
              border: "1px solid #ccc",
              borderRadius: 4,
              padding: "4px 12px",
              cursor: "pointer",
              color: t.text,
            }}
          >
            ← Chapters
          </button>
          <span style={{ fontSize: 14, fontWeight: "bold" }}>
            {currentChapter?.title || `Chapter ${idx}`}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/* TTS Controls */}
          {isSpeaking ? (
            <>
              {isPaused ? (
                <button
                  onClick={resumeTTS}
                  style={{
                    background: t.button,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    padding: "4px 12px",
                    cursor: "pointer",
                    color: t.text,
                  }}
                >
                  Resume
                </button>
              ) : (
                <button
                  onClick={pauseTTS}
                  style={{
                    background: t.button,
                    border: "1px solid #ccc",
                    borderRadius: 4,
                    padding: "4px 12px",
                    cursor: "pointer",
                    color: t.text,
                  }}
                >
                  Pause
                </button>
              )}
              <button
                onClick={stopTTS}
                style={{
                  background: t.button,
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  padding: "4px 12px",
                  cursor: "pointer",
                  color: "#c00",
                }}
              >
                Stop
              </button>
            </>
          ) : (
            <button
              onClick={startTTS}
              disabled={!content}
              style={{
                background: t.button,
                border: "1px solid #ccc",
                borderRadius: 4,
                padding: "4px 12px",
                cursor: content ? "pointer" : "not-allowed",
                color: t.text,
              }}
            >
              TTS
            </button>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              background: t.button,
              border: "1px solid #ccc",
              borderRadius: 4,
              padding: "4px 12px",
              cursor: "pointer",
              color: t.text,
            }}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div
          style={{
            position: "sticky",
            top: 45,
            background: t.bg,
            borderBottom: "1px solid #ccc",
            padding: 12,
            zIndex: 49,
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            Font: {" "}
            <button
              onClick={() => {
                const s = Math.max(12, fontSize - 2);
                setFontSize(s);
                localStorage.setItem("reader_font_size", String(s));
              }}
              style={{ padding: "2px 8px" }}
            >
              -
            </button>
            <span style={{ margin: "0 8px" }}>{fontSize}px</span>
            <button
              onClick={() => {
                const s = Math.min(32, fontSize + 2);
                setFontSize(s);
                localStorage.setItem("reader_font_size", String(s));
              }}
              style={{ padding: "2px 8px" }}
            >
              +
            </button>
          </div>
          <div>
            Theme:{" "}
            {["light", "dark", "sepia"].map((tName) => (
              <button
                key={tName}
                onClick={() => {
                  setTheme(tName);
                  localStorage.setItem("reader_theme", tName);
                }}
                style={{
                  padding: "2px 8px",
                  marginLeft: 4,
                  background: theme === tName ? "#1976d2" : t.button,
                  color: theme === tName ? "#fff" : t.text,
                  border: "1px solid #ccc",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                {tName}
              </button>
            ))}
          </div>
          <div>
            TTS Speed:{" "}
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={ttsRate}
              onChange={(e) => {
                const r = parseFloat(e.target.value);
                setTtsRate(r);
                localStorage.setItem("reader_tts_rate", String(r));
              }}
              style={{ verticalAlign: "middle" }}
            />
            <span style={{ marginLeft: 8 }}>{ttsRate}x</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div
        ref={contentRef}
        style={{
          maxWidth: 800,
          margin: "0 auto",
          padding: "24px 20px 100px",
          lineHeight: 1.8,
          fontSize,
          whiteSpace: "pre-wrap",
        }}
      >
        {loading ? (
          <p style={{ color: "#888" }}>Loading...</p>
        ) : message ? (
          <p style={{ color: "#c00" }}>{message}</p>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: applyReplaceRules(content).replace(/\n/g, "<br/>") }} />
        )}
      </div>

      {/* Navigation footer */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: t.bg,
          borderTop: "1px solid #ccc",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          zIndex: 50,
        }}
      >
        <button
          onClick={() => prevChapter && goToChapter(prevChapter.index)}
          disabled={!prevChapter}
          style={{
            padding: "8px 20px",
            background: prevChapter ? "#1976d2" : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: prevChapter ? "pointer" : "not-allowed",
          }}
        >
          ← Prev
        </button>
        <span style={{ fontSize: 14, alignSelf: "center" }}>
          {idx + 1} / {chapters.length}
        </span>
        <button
          onClick={() => nextChapter && goToChapter(nextChapter.index)}
          disabled={!nextChapter}
          style={{
            padding: "8px 20px",
            background: nextChapter ? "#1976d2" : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: nextChapter ? "pointer" : "not-allowed",
          }}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
