import { createRoot } from "react-dom/client";
import { ProjectContextMenuPanel } from "@/components/ProjectContextMenu.tsx";

/**
 * The composer branch chip's menu, in a real browser.
 *
 * The names in the screenshot that started this are long — a remote branch like
 * `claude/settings-layout-review-8265af` wrapped to three lines in the chip's
 * 240px menu, and the `remote` tag — right-aligned in that button — was pushed
 * past its edge and painted over the icons that follow it. Only real layout shows
 * that, so this mounts the real panel with the real CSS and the reported branch
 * names; e2e/branch-menu-rows.mjs measures the width, the names and the icons.
 */
/**
 * Real strings, not translation keys: the widths are what this measures, and a
 * tag rendered as `sidebar.remoteBranchTag` (23 characters) is not the tag the
 * app shows.
 */
const TRANSLATED = {
  "sidebar.switchBranch": "Switch branch",
  "sidebar.fetchBranches": "Fetch from remote",
  "sidebar.remoteBranchTag": "remote",
  "sidebar.worktrees": "Worktrees…",
  "sidebar.checkOutBranchTitle": "Check out {branch}",
  "sidebar.switchBranchTitle": "Check out {branch} in the current checkout",
  "sidebar.branchRemoteTitle": "Remote branch — checking it out creates a local tracking branch",
  "sidebar.currentBranchTitle": "This folder is on {branch}",
  "sidebar.currentWorktreeBranchTitle": "This worktree is on {branch}",
  "sidebar.mainCheckoutBranchTitle": "{branch} is checked out in the project's own folder — work there",
  "sidebar.branchInWorktreeTitle": "{branch} is already checked out in another worktree — open that worktree",
  "sidebar.worktreeFromBranchTitle": "New worktree from {branch}",
  "sidebar.removeWorktreeTitle": "Remove the worktree checkout at {path}",
  "sidebar.branchGroupExpand": "Expand the {group} branches",
  "sidebar.branchGroupCollapse": "Collapse the {group} branches",
  "sidebar.branchGroupCount": "{count} branches",
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

const REMOTE_BRANCHES = [
  "claude/revert-readme-video-intro",
  "claude/github-readme-video-intro-303e64",
  "claude/settings-layout-review-8265af",
  "claude/pi-latest-version-upgrade-6c2e94",
  "claude/conversation-list-optimization-9ec111",
  "feature/a",
];

const menu = {
  root: "/repo",
  projectRoot: "/repo",
  isGit: true,
  branches: ["main"],
  remoteBranches: REMOTE_BRANCHES,
  worktrees: [{ path: "/repo", branch: "main", isMain: true }],
  loaded: true,
};

export function renderFixture(root) {
  createRoot(root).render(
    <ProjectContextMenuPanel
      menuRef={{ current: null }}
      projectRoot="/repo"
      pos={{ top: 8, left: 8 }}
      anchor={null}
      view="branches"
      branchMenu={menu}
      selectedCwd="/repo"
      canReveal={false}
      revealLabel="Reveal"
      projectRevealError={null}
      t={t}
      onSwitchBranch={() => {}}
      onFetch={() => {}}
      onCreateWorktreeFromBranch={() => {}}
      onReveal={() => {}}
      onArchive={() => {}}
      onRestore={() => {}}
      onTogglePin={() => {}}
      onDeleteSessions={() => {}}
    />,
  );
}

const mount = typeof document !== "undefined" ? document.getElementById("root") : null;
if (mount) renderFixture(mount);
