import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/hooks/useI18n.tsx";
import { ComposerProjectChip } from "@/components/ComposerProjectChip.tsx";

/**
 * The composer's project chip, in the chrome it really opens in.
 *
 * The list is the composer's longest menu: every recent project, and on a phone one 44px
 * row per project. Hung above the chip, uncapped, it grew past the top of the chat window
 * (`.chat-window` is `overflow: hidden`, and its box starts under the app topbar) while the
 * topbar — `position: relative; z-index: var(--z-chrome)` — is drawn over the chat column.
 * The leading rows, the filter and the current project, were covered and unreachable.
 *
 * This mounts the chip inside the app's own structure with the app's real stylesheet, so
 * the clip is measurable, and `?broken=1` swaps in the markup that shipped before the fix
 * so the check can be shown to catch the bug it was written for.
 */

const PROJECTS = [
  "/Users/dev/pi-desk",
  "/Users/dev/branchshift",
  "/Users/dev/tab-to-find",
  "/Users/dev/auto-toc",
  "/Users/dev/sux-mac",
  "/Users/dev/pi-notify-test",
  "/Users/dev/sadoyo",
  "/Users/dev/github/pi-webui",
  "/Users/dev/github/pi-web-8505-seed",
  "/Users/dev/github/pi-codemode",
  "/Users/dev/github/pi-mcp",
  "/Users/dev/notes",
];
const BROKEN = new URL(window.location.href).searchParams.get("broken") === "1";
/**
 * The shell's height, in CSS pixels.
 *
 * On a phone in Safari the layout viewport (what `60vh` reads) is the full page height —
 * 956px — while the app sizes its shell to the *visual* viewport, which the browser's own
 * bars shrink to a few hundred. That is the mismatch the report came from: the panel's
 * `min(60vh, 420px)` cap was measured against the tall layout viewport, and the composer it
 * hangs above sits in the short visual one, so the list grew up behind the header. The
 * fixture reproduces the split: a tall page, a short shell.
 */
const SHELL_HEIGHT = Number(new URL(window.location.href).searchParams.get("shell") || 480);

/** The panel exactly as it shipped before the fix: the list's own cap, no boundary. */
function LegacyProjectChip({ open, onOpenChange }) {
  const [draftOpen, setDraftOpen] = useState(false);
  const isOpen = open ?? draftOpen;
  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        className="chat-project-context"
        style={{ maxWidth: 112 }}
        onClick={() => (onOpenChange ? onOpenChange((value) => !value) : setDraftOpen((value) => !value))}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        </svg>
        <span>pi-desk</span>
      </button>
      {isOpen && (
        <div
          className="native-popover app-menu composer-project-menu"
          role="menu"
          style={{
            position: "absolute",
            left: 0,
            bottom: "calc(100% + 6px)",
            zIndex: 500,
            minWidth: 220,
            maxWidth: 320,
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
            padding: 5,
          }}
        >
          {PROJECTS.map((projectRoot, index) => (
            <button
              key={projectRoot}
              type="button"
              role="menuitem"
              aria-current={index === 0 ? "true" : undefined}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", minWidth: 0,
                padding: "7px 9px", border: 0, borderRadius: "var(--radius-sm)",
                background: index === 0 ? "var(--bg-selected)" : "transparent",
                color: index === 0 ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer", textAlign: "left", fontSize: "var(--fs-caption)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
              </svg>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {projectRoot.split("/").pop()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const menuRef = useRef(null);
  const [cwd, setCwd] = useState(PROJECTS[0]);
  const [open, setOpen] = useState(false);
  return (
    <I18nProvider>
      <div style={{ display: "flex", height: SHELL_HEIGHT, minHeight: 0 }}>
        {/* The sidebar is a sibling of the conversation column, with a higher layer than
            the composer's menus: a menu must never need to reach into its column. */}
        <aside className="app-sidebar" style={{ width: 0, flexShrink: 0 }} />
        <div className="app-main-column" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <header className="app-topbar">
            <div className="app-topbar-title">
              <span>New session</span>
              <span className="app-topbar-subtitle-row">
                <small className="app-topbar-project">pi-desk</small>
                <small className="app-topbar-context">fix/flat-chat-blocks</small>
              </span>
            </div>
          </header>
          <div className="chat-window chat-content relative flex h-full min-w-0 flex-col overflow-hidden"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
            <div className="chat-scroll-container scrollbar-subtle min-w-0 flex-1 overflow-x-hidden overflow-y-scroll pt-4"
              style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto", overflowX: "hidden", minWidth: 0, paddingTop: 16 }}>
              <div style={{ padding: "0 14px", fontSize: "var(--fs-body)", color: "var(--text-muted)" }}>
                Choose a project, a branch, and start.
              </div>
            </div>
            <div className="chat-composer" style={{ padding: "10px 12px", flexShrink: 0 }}>
              <div className="chat-composer-actions" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button type="button" className="native-toolbar-button composer-attach-button" style={{ width: 32, height: 32 }}>+</button>
                {BROKEN ? (
                  <LegacyProjectChip open={open} onOpenChange={setOpen} />
                ) : (
                  <ComposerProjectChip
                    menuRef={menuRef}
                    open={open}
                    onOpenChange={setOpen}
                    label="pi-desk"
                    projectPath={cwd}
                    maxWidth={112}
                    projectOptions={PROJECTS}
                    onProjectChange={setCwd}
                  />
                )}
                <span className="chat-project-context chat-branch-context" style={{ maxWidth: 96 }}>
                  <span>fix/flat-chat-blocks</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
