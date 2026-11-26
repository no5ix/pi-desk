import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";

/**
 * The composer's card with the corner button, in the box the app puts it in, so the
 * corner can be measured collapsed, expanded, and expanded with the keyboard up.
 *
 * The structure and the inline styles mirror components/ChatInput.tsx (the card, the
 * editor box, the textarea's inline box, the control row) and components/ChatWindow.tsx
 * (the floating overlay the card sits in). The fold runs the same effect the composer
 * runs, because the bug the effect fixes — a collapsed card that keeps the tall editor's
 * height — is only measurable if the fixture has the effect. e2e/composer-expand.mjs
 * asserts the mirror against the two sources, so a fixture that drifts measures nothing.
 */
function Composer({ inline, expanded, onExpandedChange }) {
  const textareaRef = useRef(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (expanded) {
      ta.style.height = "auto";
      return;
    }
    const from = ta.offsetHeight;
    ta.style.height = "auto";
    const target = Math.min(ta.scrollHeight, 200);
    ta.style.height = `${from}px`;
    void ta.offsetHeight;
    ta.style.height = `${target}px`;
  }, [expanded]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const grow = () => {
      if (expanded) return;
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    };
    ta.addEventListener("input", grow);
    return () => ta.removeEventListener("input", grow);
  }, [expanded]);

  return (
    <div className={`chat-composer${expanded ? " is-expanded" : ""} has-expand`}>
      <button
        type="button"
        className="chat-composer-expand"
        data-expanded={expanded ? "true" : "false"}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse the message box" : "Expand the message box"}
        title={expanded ? "Collapse the message box" : "Expand the message box"}
        onClick={() => onExpandedChange(!expanded)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {expanded ? <><path d="M4 10h6V4" /><path d="M20 14h-6v6" /></> : <><path d="M14 4h6v6" /><path d="M10 20H4v-6" /></>}
        </svg>
      </button>
      <div
        className="chat-composer-editor"
        data-inline={inline ? "true" : undefined}
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 0,
          alignItems: "stretch",
          background: "var(--bg)",
          borderRadius: 14,
          padding: "6px 6px 6px 12px",
          boxShadow: "var(--shadow-composer)",
        }}
      >
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          rows={1}
          placeholder="Message Pi…"
          style={{
            flex: "none",
            minWidth: 0,
            background: "none",
            border: "none",
            outline: "none",
            resize: "none",
            minHeight: 24,
            maxHeight: 200,
            overflow: "auto",
            height: 24,
          }}
        />
        <div className="chat-composer-actions">
          <button type="button" className="native-toolbar-button composer-attach-button" aria-label="Attach files">+</button>
          <div className="chat-composer-controls">
            <button type="button" aria-label="Reasoning: high" aria-haspopup="listbox" style={{ width: "var(--control-h-lg)", height: "var(--control-h-lg)", padding: 0 }} />
            <button type="button" aria-label="Change tool preset: default" aria-haspopup="listbox" style={{ width: "var(--control-h-lg)", height: "var(--control-h-lg)", padding: 0 }} />
          </div>
          <button type="button" className="composer-side-chat-button" aria-label="Side chat" />
          <button type="button" className="native-primary-button composer-send-button" data-action="send" aria-label="Send" />
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const inline = new URLSearchParams(window.location.search).get("inline") === "1";
  const [expanded, setExpanded] = useState(new URLSearchParams(window.location.search).get("expanded") === "1");
  return (
    <div className="app-shell" style={{ position: "relative", height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="chat-scroll-container" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 12px 34px" }}>
        {Array.from({ length: 14 }, (_, i) => (
          <p key={i} className="markdown-body" style={{ fontSize: "var(--fs-body)", color: "var(--text)" }}>
            {`Row ${i + 1}: the transcript the composer floats over, so the card's growth can be seen against the shell's own bottom edge.`}
          </p>
        ))}
      </div>
      <div className="chat-composer-overlay" style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 20 }}>
        <div className="chat-composer-wrap">
          <Composer inline={inline} expanded={expanded} onExpandedChange={setExpanded} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Shell />);
