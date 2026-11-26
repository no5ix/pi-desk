import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { growComposerTextarea, measureComposerTextLines } from "@/lib/composer-textarea-height";

/**
 * The composer's card with its corner, in the box the app puts it in, so the corner can be
 * measured on a resting card, open as the tall editor, and open with the keyboard up.
 *
 * The structure and the inline styles mirror components/ChatInput.tsx (the card, the one
 * row, the `+`, the textarea's inline box, the control row) and components/ChatWindow.tsx
 * (the floating overlay the card sits in). The corner is not drawn on a resting card: the
 * mirror measures the prompt's lines with the app's own helper, because the ask — no corner
 * until the text has a second line, and the corner back when it does not — is only
 * measurable if the fixture gates on the same measurement. The fold runs the same effect the
 * composer runs, because the bug the effect fixes — a collapsed card that keeps the tall
 * editor's height — is only measurable if the fixture has the effect.
 * e2e/composer-expand.mjs asserts the mirror against the sources, so a fixture that drifts
 * measures nothing.
 */
function Composer({ expanded, onExpandedChange }) {
  const textareaRef = useRef(null);
  const [textLines, setTextLines] = useState(1);
  const cornerVisible = expanded || textLines > 1;

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
    const measure = () => setTextLines(measureComposerTextLines(ta));
    const grow = () => {
      growComposerTextarea(ta);
      measure();
    };
    ta.addEventListener("input", grow);
    measure();
    return () => ta.removeEventListener("input", grow);
  }, []);

  // A prompt that shrinks back to one line is the resting card again.
  useEffect(() => {
    if (textLines === 1 && expanded) onExpandedChange(false);
  }, [textLines, expanded, onExpandedChange]);

  return (
    <div className={`chat-composer${expanded ? " is-expanded" : ""}${cornerVisible ? " has-expand" : ""}`}>
      {cornerVisible && (
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
      )}
      <div
        className="chat-composer-editor"
        data-inline="true"
        style={{
          minWidth: 0,
          display: "flex",
          flexDirection: "row",
          gap: 0,
          alignItems: "flex-end",
          background: "var(--bg)",
          borderRadius: 14,
          padding: "6px 6px 6px 12px",
          boxShadow: "var(--shadow-composer)",
        }}
      >
        <button type="button" className="native-toolbar-button composer-attach-button" aria-label="Attach files">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          className="chat-input-textarea"
          rows={1}
          placeholder="Message Pi…"
          style={{
            flex: "1 1 auto",
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
          <div className="chat-composer-controls" style={{ flex: "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" aria-label="Reasoning: high" aria-haspopup="listbox" style={{ width: "var(--composer-send-size)", height: "var(--composer-send-size)", padding: 0 }} />
            <button type="button" aria-label="Change tool preset: default" aria-haspopup="listbox" style={{ width: "var(--composer-send-size)", height: "var(--composer-send-size)", padding: 0 }} />
          </div>
          <button type="button" className="composer-side-chat-button" aria-label="Side chat" />
          <button type="button" className="native-primary-button composer-send-button" data-action="send" aria-label="Send" />
        </div>
      </div>
    </div>
  );
}

function Shell() {
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
          <Composer expanded={expanded} onExpandedChange={setExpanded} />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Shell />);
