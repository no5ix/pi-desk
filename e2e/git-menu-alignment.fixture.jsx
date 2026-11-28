import { createRoot } from "react-dom/client";
import { GitMenu, GitRowMenuButton, MENU_WIDTH, useGitMenu } from "@/components/git/git-ui";

/**
 * The Git panel's row menus, mounted for measurement.
 *
 * A menu opened from the kebab at a row's right edge is a menu about the row, so
 * it opens at the row's left edge. Anchored to the button it hung in the middle
 * of the list, and in a narrow panel the button's own x pushed it off the row it
 * described. `?unfixed=1` reproduces the pre-fix placement (the menu placed at
 * the button) so the check can prove it measures the difference it was written for.
 */

const params = new URLSearchParams(window.location.search);
const unfixed = params.get("unfixed") === "1";
const panelWidth = Number(params.get("width") || 380);
const flushRight = params.get("edge") === "flush";

const branchItems = [
  { id: "checkout", label: "Checkout" },
  { id: "merge", label: "Merge into current" },
  { id: "sep", separator: true },
  { id: "delete", label: "Delete branch", danger: true },
];

const commitItems = [
  { id: "copy", label: "Copy SHA" },
  { id: "revert", label: "Revert" },
  { id: "sep2", separator: true },
  { id: "reset", label: "Reset to this commit", danger: true },
];

function GitMenuFixture() {
  const { menu, open, close } = useGitMenu();

  const openFrom = (anchor, items) => {
    if (!unfixed) {
      open(anchor, items);
      return;
    }
    // Pre-fix: the placement is computed from the kebab, not from the row.
    const rect = anchor.getBoundingClientRect();
    open({ x: rect.right - MENU_WIDTH, y: rect.bottom }, items);
  };

  return (
    <div
      className="git-panel"
      style={{
        width: panelWidth,
        marginLeft: flushRight ? `calc(100vw - ${panelWidth}px)` : 12,
        padding: 8,
        // The real panel is a positioned box, and its commit list is virtualized:
        // `.git-log-row` is `position: absolute` inside a positioned viewport. The
        // fixture stands in for that viewport, so the commit rows land where the
        // panel puts them and not at the window's edge.
        position: "relative",
      }}
    >
      <div className="git-branch-list" data-list="branches">
        <div className="git-branch-row" data-row="branch">
          <span className="git-branch-name">main</span>
          <GitRowMenuButton label="Branch menu" items={branchItems} onOpen={openFrom} />
        </div>
        <div className="git-branch-row" data-row="branch">
          <span className="git-branch-name">claude/conversation-list-optimization-9ec111</span>
          <GitRowMenuButton label="Branch menu" items={branchItems} onOpen={openFrom} />
        </div>
        <div className="git-branch-row" data-row="branch">
          <span className="git-branch-name">wt/one</span>
          <GitRowMenuButton label="Branch menu" items={branchItems} onOpen={openFrom} />
        </div>
      </div>
      <div className="git-log-list" data-list="commits" style={{ position: "relative", height: 96, marginTop: 12 }}>
        <div className="git-log-row" data-row="commit">
          <span className="git-log-subject">fix: the tab strip's centring</span>
          <GitRowMenuButton label="Commit menu" items={commitItems} onOpen={openFrom} />
        </div>
        <div className="git-log-row" data-row="commit">
          <span className="git-log-subject">docs: the panel's notes</span>
          <GitRowMenuButton label="Commit menu" items={commitItems} onOpen={openFrom} />
        </div>
      </div>
      {menu ? <GitMenu menu={menu} onDone={close} /> : null}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<GitMenuFixture />);
