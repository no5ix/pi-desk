import { createRoot } from "react-dom/client";
import { useViewportHeight } from "@/hooks/useViewportHeight";

/**
 * The composer in the two boxes it ships in, so the phone's keyboard can be
 * simulated against the shipped `useViewportHeight()` and the shipped CSS.
 *
 * `?page=empty` is the new-session page: `components/ChatWindow.tsx` puts the
 * composer block in the document flow (`className="relative shrink-0"`), with
 * `NewSessionWelcome` above the card inside that same block and a
 * `min-h-0 flex-1` spacer after it. `?page=chat` is a session with messages:
 * the card floats in `.chat-composer-overlay` (`absolute inset-x-0 z-20`), over
 * a transcript that scrolls.
 *
 * The chain, the classes and the inline styles mirror `components/AppShell.tsx`
 * (shell, main column, topbar, the two centre wrappers), `components/ChatWindow.tsx`
 * (chat window, content region, composer block, spacer, scroll container) and
 * `components/ChatInput.tsx` (fieldset, centred column, card, row, `+`, textarea,
 * Send). The hook is the shipped one, so what the keyboard does to the page is
 * produced by the code under test: `--app-viewport-height`,
 * `html[data-keyboard-open]` and the hook's `window.scrollTo(0, 0)` all run for
 * real. `e2e/composer-keyboard.mjs` asserts this mirror against those sources,
 * so a fixture that drifts measures nothing.
 *
 * The harness serves the three stylesheets raw, without Tailwind's utility
 * layer, so the utilities the app's class lists compile to (`relative`, `flex`,
 * `h-full`, `min-h-0`, `flex-1`, `shrink-0`, `inset-x-0`, `z-20`,
 * `overflow-y-scroll`, `pt-4`) are written inline here, at their shipped values;
 * every semantic class is the real one, so the cascade that decides the
 * composer's box is the shipped cascade.
 *
 * No keyboard is faked here. `e2e/composer-keyboard.mjs` scripts the visual
 * viewport and iOS's own keyboard rules: the field takes focus, the keyboard
 * opens, iOS scrolls the page to reveal the field, and iOS closes the keyboard
 * when the focused field is not in the room above it.
 */

/** The composer card, as `components/ChatInput.tsx` renders it on a phone. */
function Composer({ isNarrow }) {
  return (
    <fieldset
      className="chat-input-shell"
      style={{
        flexShrink: 0,
        minWidth: 0,
        margin: 0,
        border: 0,
        background: "transparent",
        padding: "0 16px 8px",
        opacity: 1,
        transition: "opacity var(--dur-base) var(--ease-native)",
      }}
    >
      <div style={{ maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto" }}>
        <div className="chat-composer">
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
            {isNarrow ? (
              <button type="button" className="native-toolbar-button composer-plus-button" aria-label="More">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            ) : (
              <button type="button" className="native-toolbar-button composer-attach-button" aria-label="Attach files">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            )}
            <textarea
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
                color: "var(--text)",
                fontSize: "var(--chat-content-font-size, 14px)",
                lineHeight: 1.6,
                fontFamily: "inherit",
                minHeight: 24,
                maxHeight: 200,
                overflow: "auto",
              }}
            />
            <div className="chat-composer-actions">
              {!isNarrow && (
                <div className="chat-composer-controls" style={{ marginTop: 0, flex: "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  <button type="button" aria-label="Reasoning: high" aria-haspopup="listbox" style={{ width: "var(--composer-send-size)", height: "var(--composer-send-size)", padding: 0 }} />
                  <button type="button" aria-label="Change tool preset: default" aria-haspopup="listbox" style={{ width: "var(--composer-send-size)", height: "var(--composer-send-size)", padding: 0 }} />
                </div>
              )}
              <button type="button" className="composer-side-chat-button" aria-label="Side chat" />
              <button type="button" className="native-primary-button composer-send-button" data-action="send" aria-label="Send" />
            </div>
          </div>
        </div>
      </div>
    </fieldset>
  );
}

/** `components/NewSessionWelcome.tsx`, the greeting above a fresh composer. */
function Welcome() {
  return (
    <div className="new-session-welcome">
      <h1 className="new-session-welcome-title">Good evening</h1>
      <p className="new-session-welcome-subtitle">pi-web</p>
    </div>
  );
}

function Transcript({ rows }) {
  return (
    <div style={{ minWidth: 0, padding: "0 16px" }}>
      <div style={{ width: "100%", minWidth: 0, maxWidth: "var(--chat-content-max-width, 820px)", margin: "0 auto" }}>
        {Array.from({ length: rows }, (_, i) => (
          <p key={i} className="markdown-body" style={{ fontSize: "var(--fs-body)", color: "var(--text)" }}>
            {`Row ${i + 1}: a transcript long enough that its own column scrolls, the way a real session's does.`}
          </p>
        ))}
      </div>
    </div>
  );
}

/** The composer block: `ChatWindow.tsx`'s two shapes, in flow and overlaying. */
function ComposerBlock({ empty, isNarrow }) {
  return (
    <div
      className={empty ? "relative shrink-0" : "chat-composer-overlay absolute inset-x-0 z-20"}
      style={empty
        ? { position: "relative", flexShrink: 0 }
        : { position: "absolute", left: 0, right: 0, zIndex: 20, bottom: "env(safe-area-inset-bottom)" }}
    >
      {empty && <Welcome />}
      <Composer isNarrow={isNarrow} />
    </div>
  );
}

function Shell({ empty }) {
  // The shipped hook: from the visual viewport in front of it, it writes
  // `--app-viewport-height` and `html[data-keyboard-open]`, and pins the page.
  useViewportHeight();
  const isNarrow = window.matchMedia("(max-width: 480px)").matches;
  return (
    <div
      className="app-shell"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "var(--app-viewport-height, 100dvh)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <div className="app-main-column" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <div
          className="app-topbar"
          style={{
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            minHeight: "calc(36px + env(safe-area-inset-top))",
            paddingTop: "env(safe-area-inset-top)",
            background: "var(--bg-panel)",
          }}
        >
          <span style={{ fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>pi-web</span>
        </div>
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, position: "relative" }}>
            <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
              <div
                className="chat-window chat-content"
                data-empty={empty ? "true" : "false"}
                style={{
                  position: "relative",
                  display: "flex",
                  height: "100%",
                  minWidth: 0,
                  flexDirection: "column",
                  overflow: "hidden",
                  paddingBottom: "env(safe-area-inset-bottom)",
                }}
              >
                <div style={{ position: "relative", display: "flex", minHeight: 0, minWidth: 0, flex: 1, overflow: "hidden" }}>
                  {empty ? (
                    <>
                      <ComposerBlock empty isNarrow={isNarrow} />
                      <div style={{ minHeight: 0, flex: 1 }} />
                    </>
                  ) : (
                    <>
                      <div
                        className="chat-scroll-container scrollbar-subtle"
                        style={{ minWidth: 0, flex: 1, overflowX: "hidden", overflowY: "scroll", paddingTop: 16 }}
                      >
                        <Transcript rows={30} />
                        {/* ChatWindow's composer-height spacer. */}
                        <div style={{ height: 90 }} />
                      </div>
                      <ComposerBlock empty={false} isNarrow={isNarrow} />
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const query = new URLSearchParams(window.location.search);
if (query.get("standalone") === "1") document.documentElement.setAttribute("data-standalone-safe-area", "");

createRoot(document.getElementById("root")).render(
  <Shell empty={query.get("page") === "empty"} />,
);
