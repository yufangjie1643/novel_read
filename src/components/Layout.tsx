import { Link, useLocation } from "react-router-dom";

const navItems = [
  { path: "/", label: "Bookshelf" },
  { path: "/explore", label: "Explore" },
  { path: "/search", label: "Search" },
  { path: "/rss", label: "RSS" },
  { path: "/debug", label: "Debug" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      <nav
        style={{
          display: "flex",
          gap: 24,
          padding: "12px 20px",
          borderBottom: "1px solid #ddd",
          background: "#fff",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ fontWeight: "bold", fontSize: 18, marginRight: 16 }}>
          Legado Desktop
        </div>
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            style={{
              textDecoration: "none",
              color: location.pathname === item.path ? "#1976d2" : "#555",
              fontWeight: location.pathname === item.path ? "bold" : "normal",
              padding: "4px 8px",
              borderRadius: 4,
              background: location.pathname === item.path ? "#e3f2fd" : "transparent",
            }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <main style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
        {children}
      </main>
    </div>
  );
}
