import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/hooks/useI18n";
import { TopbarBranchChip } from "@/components/TopbarBranchChip";
import { TopbarProjectChip } from "@/components/TopbarProjectChip";

/**
 * The conversation header's project row, in a real browser.
 *
 * The row — `[folder] project  [branch] branch  [clock]  [✓] 2` — lives inside
 * `.app-topbar-title`, and that column is sized by its own content (the bar's
 * actions push with `margin-left: auto`, which takes the free space before
 * flex-grow does). The column's old 420px cap and the branch's `flex: 1 1 0`
 * together ellipsized a normal branch name and pushed the clock and the counts to
 * the far edge, away from the branch they describe. This renders the header with
 * the app's real CSS and the real branch chip; e2e/topbar-project-row.mjs measures
 * the labels, the distance between them and the tip at desktop, narrow and phone
 * widths, and puts the old rules back to prove the measurement sees the bug.
 */
function TopbarRow() {
  // `?long=1` is the case a phone cannot fit: a branch name and a path long enough that
  // the row cuts them to a stub, and the tips have to wrap to show them complete.
  const long = new URLSearchParams(location.search).get("long") === "1";
  const branch = long
    ? "claude/conversation-list-optimization-and-header-widths-9ec111"
    : "feat/branch-picker-header-worktrees";
  const projectRoot = long
    ? "/Users/lynx/Documents/github/pi-desk-worktrees/branch-picker-header-worktrees"
    : "/Users/lynx/Documents/github/pi-desk";
  return (
    <div className="app-main-column" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
      <div
        className="app-topbar"
        style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          gap: 2,
          height: "auto",
          minHeight: 36,
        }}
      >
        <button type="button" className="native-icon-button" style={{ width: 32, height: 32 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
        <div className="app-topbar-title" title="Fix Remote Text Overlap in Composer Branch Menu">
          <span>Fix Remote Text Overlap in Composer Branch Menu</span>
          <span className="app-topbar-subtitle-row">
            <TopbarProjectChip name="pi-desk" path={projectRoot} />
            <TopbarBranchChip
              branch={branch}
              projectRoot={projectRoot}
              isWorktree={false}
            />
            <small className="app-topbar-elapsed">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
              </svg>
              11m5s
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
        <div className="app-topbar-actions" style={{ display: "flex", alignItems: "center", gap: 2, flex: "0 0 auto" }}>
          {["More", "Panel"].map((label) => (
            <button key={label} type="button" className="native-icon-button" style={{ width: 32, height: 32 }}>{label[0]}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function renderFixture(root) {
  createRoot(root).render(
    <I18nProvider>
      <TopbarRow />
    </I18nProvider>,
  );
}

const mount = typeof document !== "undefined" ? document.getElementById("root") : null;
if (mount) renderFixture(mount);
