import { createRoot } from "react-dom/client";

/**
 * The conversation header's project row, in a real browser.
 *
 * The row — `[folder] project  [branch] branch  [clock]  [subagents]` — lives
 * inside `.app-topbar-title`, and that column's `max-width` is the row's room. It
 * was 420px, so a normal branch name ellipsized (`feat/branch-picker-header-…`)
 * in a window with most of its width free. This reproduces the header's markup
 * with the app's real classes and CSS; e2e/topbar-project-row.mjs measures the
 * labels at desktop and phone widths.
 */
function TopbarRow() {
  return (
    <div className="app-main-column" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
      <div
        className="app-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          flexWrap: "wrap",
          gap: 2,
          height: "auto",
          minHeight: 36,
        }}
      >
        <div className="app-topbar-title" title="Fix Remote Text Overlap in Composer Branch Menu">
          <span>Fix Remote Text Overlap in Composer Branch Menu</span>
          <span className="app-topbar-subtitle-row">
            <small className="app-topbar-project">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
              </svg>
              <span>pi-desk</span>
            </small>
            <small className="app-topbar-branch">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" />
                <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
              </svg>
              <span>feat/branch-picker-header-worktrees</span>
            </small>
            <small className="app-topbar-elapsed">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
              3m35s
            </small>
            <button type="button" className="app-topbar-subagents">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M12 7V4" />
              </svg>
              <span className="app-topbar-subagent-count is-completed">
                <span className="app-topbar-subagent-glyph">✓</span>
                <span>2</span>
              </span>
            </button>
          </span>
        </div>
        <div className="app-topbar-actions" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 2, flex: "0 0 auto" }}>
          {["Files", "Terminal", "Agents", "Close"].map((label) => (
            <button key={label} type="button" className="native-icon-button" style={{ width: 32, height: 32 }}>{label[0]}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function renderFixture(root) {
  createRoot(root).render(<TopbarRow />);
}

const mount = typeof document !== "undefined" ? document.getElementById("root") : null;
if (mount) renderFixture(mount);
