import React, { useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * The scroll-to-latest disc, over the two things it floats on.
 *
 * The app anchors the disc to the composer, above it, so it rides on the prose that is
 * scrolling out of view. The fixture draws it twice on purpose — once over a block of
 * text, once over an empty page — because a translucent disc is a different colour on
 * each, and an opaque one (what it used to be) is the same on both.
 */
function Disc() {
  return (
    <div style={{ position: "absolute", top: 34, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 20 }}>
      <button type="button" className="chat-scroll-to-bottom is-visible" title="Scroll to latest" aria-label="Scroll to latest" onClick={() => {}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </button>
    </div>
  );
}

const LINES = [
  "Fix 12 phone issues: the composer keyboard, the code blocks, the thinking rows.",
  "The disc rides on the conversation, so the conversation has to read through it.",
  "Remove the text after Search titles in the sidebar's search box.",
  "The separators in settings start at the label's first letter, not under the icon.",
  "The go-to-bottom button has no border and a shadow that lifts it off moving prose.",
  "A collapsed thinking ends its first line with three marks, not one ellipsis.",
  "The terminal panel's plus button opens a tab, and numbers the duplicate.",
  "The subagent report is set in the thinking block's type, on its own surface.",
];

function Fixture() {
  const [theme, setTheme] = useState("dark");
  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "var(--bg)" }}>
      <div style={{ display: "flex", gap: 8, padding: "8px 12px" }}>
        <button id="theme-dark" onClick={() => setTheme("dark")}>dark</button>
        <button id="theme-light" onClick={() => setTheme("light")}>light</button>
      </div>
      <div className="chat-scroll-container" style={{ flex: 1, overflowY: "auto", padding: "0 16px", position: "relative" }}>
        {/* The disc over the conversation: prose, and one band of solid ink so the
            transparency has something unambiguous to read. */}
        <div data-host="ink" style={{ position: "relative", padding: "12px 0" }}>
          <Disc />
          {LINES.map((line, i) => (
            <p key={i} style={{ margin: "0 0 14px", fontFamily: "var(--font-mono)", fontSize: 15, lineHeight: 1.7, color: "var(--text)" }}>{line}</p>
          ))}
          <div style={{ height: 40, background: "var(--text)" }} />
        </div>
        {/* The same disc over an empty page: the transparency is the difference. */}
        <div data-host="empty" style={{ position: "relative", height: 180, background: "var(--bg)", marginTop: 24 }}>
          <Disc />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
