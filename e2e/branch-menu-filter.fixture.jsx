import { createRoot } from "react-dom/client";
import { ProjectContextMenuPanel } from "@/components/ProjectContextMenu.tsx";

/**
 * The composer branch chip's branch page, in a real browser, with a long list.
 *
 * A project can carry forty branches. The page gained a filter box above the
 * list; a branch that lives in a worktree is a row that opens that folder; and
 * the rest of the list is a tree of the prefix each name carries, with an arrow
 * that folds a group. All three are behaviour you can only drive in a browser
 * (typing narrows, Escape closes, the arrow folds, a group's leaves come back),
 * so they are driven here with the real CSS.
 *
 * `?short=1` serves a three-branch project: the box must be absent, so the check
 * cannot pass by always having a box.
 */
const TRANSLATED = {
  "sidebar.switchBranch": "Switch branch",
  "sidebar.fetchBranches": "Fetch from remote",
  "sidebar.fetchingBranches": "Fetching…",
  "sidebar.remoteBranchTag": "remote",
  "sidebar.worktrees": "Worktrees…",
  "sidebar.noOtherBranches": "No other branches",
  "sidebar.checkOutBranchTitle": "Check out {branch} in this checkout",
  "sidebar.switchBranchTitle": "Check out {branch} in the current checkout",
  "sidebar.branchRemoteTitle": "Remote branch — checking it out creates a local tracking branch",
  "sidebar.currentBranchTitle": "This folder is on {branch}",
  "sidebar.mainCheckoutBranchTitle": "{branch} is checked out in the project's own folder — work there",
  "sidebar.openWorktreeForBranchTitle": "{branch} is checked out in a worktree — work in that folder",
  "sidebar.worktreeFromBranchTitle": "New worktree from {branch}",
  "sidebar.branchInWorktreeTitle": "{branch} is already checked out in another worktree — open that worktree",
  "sidebar.removeWorktreeTitle": "Remove the worktree checkout at {path}",
  "sidebar.branchGroupExpand": "Expand the {group} branches",
  "sidebar.branchGroupCollapse": "Collapse the {group} branches",
  "sidebar.branchGroupCount": "{count} branches",
  "sidebar.worktreeTag": "worktree",
  "sidebar.filterBranches": "Filter branches",
  "sidebar.filterBranchesTitle": "Type to narrow the list",
  "sidebar.noBranchMatches": "No branch matches “{query}”",
  "sidebar.moreActions": "More actions",
  "sidebar.currentWorktreeTitle": "In {path}",
};
const t = (key, params) => {
  const text = TRANSLATED[key] ?? key;
  if (!params) return text;
  return Object.entries(params).reduce(
    (acc, [name, value]) => acc.replace(new RegExp(`\\{${name}\\}`, "g"), String(value)),
    text,
  );
};

const LONG = {
  root: "/repo",
  projectRoot: "/repo",
  isGit: true,
  branches: [
    "main",
    "fix/a",
    "fix/b",
    "fix/c",
    "claude/settings-layout-review-8265af",
    "feat/x",
    "release/1.0",
    "probe",
    "bak/4old",
  ],
  remoteBranches: ["origin/main", "origin/claude/settings-x", "origin/HEAD"],
  worktrees: [
    { path: "/repo", branch: "main", isMain: true },
    { path: "/repo-worktrees/feat-x", branch: "feat/x", isMain: false },
  ],
  loaded: true,
};

const SHORT = {
  root: "/repo",
  projectRoot: "/repo",
  isGit: true,
  branches: ["main", "fix/a", "feat/x"],
  remoteBranches: [],
  worktrees: [
    { path: "/repo", branch: "main", isMain: true },
    { path: "/repo-worktrees/feat-x", branch: "feat/x", isMain: false },
  ],
  loaded: true,
};

export function renderFixture(root, { short = false } = {}) {
  const calls = [];
  window.__calls = calls;
  createRoot(root).render(
    <ProjectContextMenuPanel
      menuRef={{ current: null }}
      projectRoot="/repo"
      pos={{ top: 8, left: 8 }}
      anchor={null}
      view="branches"
      branchMenu={short ? SHORT : LONG}
      selectedCwd="/repo-worktrees/feat-x"
      canReveal={false}
      revealLabel="Reveal"
      projectRevealError={null}
      t={t}
      onSwitchBranch={(branch) => calls.push(["switch", branch])}
      onCreateWorktreeFromBranch={(branch) => calls.push(["worktree", branch])}
      onFetch={() => calls.push(["fetch"])}
      onReveal={() => {}}
      onArchive={() => {}}
      onRestore={() => {}}
      onClose={() => calls.push(["close"])}
    />,
  );
}

const mount = typeof document !== "undefined" ? document.getElementById("root") : null;
if (mount) {
  renderFixture(mount, { short: new URL(location.href).searchParams.get("short") === "1" });
}
