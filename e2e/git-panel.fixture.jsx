import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { GitPanel } from "../components/GitPanel";

/**
 * The right panel's Git view, in a real browser with the real component, at a phone's
 * width and a desktop's.
 *
 * The view is three levels — the branch tree, one branch's commits, one commit's diff —
 * and each level is a git read. So the fixture answers the three routes with a fixed
 * repository: eight branches (over the count at which the list grows its filter box),
 * one of them checked out in a linked folder, two remote-only, three under a `chore/`
 * prefix the tree folds; then commits of one branch; then a two-file commit.
 *
 * The panel's header strip is AppShell's markup, copied here in the two-button shape
 * the view is measured in: the file list's toggle and the Git view's, side by side. The
 * measurement is that pair's finger size and order, which is CSS's job, not AppShell's.
 */

const ROOT = "/repo";

const WORKTREES = [
  { path: ROOT, branch: "fix/flat-chat-blocks", isMain: true },
  { path: "/repo-worktrees/panel-git-view", branch: "feat/panel/git-view", isMain: false },
];

const BRANCHES = [
  "fix/flat-chat-blocks",
  "feat/panel/git-view",
  "main",
  "chore/raise-the-ceiling",
  "chore/trim-the-strip",
  "chore/widen-the-list",
  "docs/panel-notes",
  "release/2026-01",
];

// The raw list the route answers with: the remote ref, its prefix stripped by the menu.
const REMOTE_BRANCHES = ["origin/preview"];

const COMMIT_PAGE = {
  commits: [
    {
      sha: "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
      shortSha: "0a1b2c3",
      subject: "the right panel grows a Git view",
      body: "",
      authorName: "Lynx",
      authorEmail: "lynx@example.com",
      dateMs: Date.parse("2026-01-04T09:12:00.000Z"),
      parentCount: 1,
    },
    {
      sha: "1111111111111111111111111111111111111111",
      shortSha: "1111111",
      subject: "a merge of the release branch, whose diff is against its first parent and has to say so",
      body: "",
      authorName: "A very long author name for the phone",
      authorEmail: "someone@example.com",
      dateMs: Date.parse("2026-01-03T19:02:00.000Z"),
      parentCount: 2,
    },
  ],
  hasMore: false,
  repositoryRoot: ROOT,
  isGitRepository: true,
};

const COMMIT_DETAIL = {
  supported: true,
  commit: COMMIT_PAGE.commits[0],
  repositoryRoot: ROOT,
  files: [
    { path: "components/GitPanel.tsx", status: "added", additions: 604, deletions: 0 },
    { path: "app/native-theme.css", status: "modified", additions: 12, deletions: 3, oldPath: null },
  ],
  patch: [
    "diff --git a/components/GitPanel.tsx b/components/GitPanel.tsx",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/components/GitPanel.tsx",
    "@@ -0,0 +1,4 @@",
    "+export function GitPanel() {",
    "+  return null;",
    "+}",
    "diff --git a/app/native-theme.css b/app/native-theme.css",
    "index 2222222..3333333 100644",
    "--- a/app/native-theme.css",
    "+++ b/app/native-theme.css",
    "@@ -10,3 +10,4 @@",
    " .strip {",
    "   display: flex;",
    "-  gap: 2px;",
    "+  gap: 4px;",
    "+  order: -1;",
  ].join("\n"),
};

function answer(url, init) {
  if (url.startsWith("/api/worktrees/fetch")) {
    return { branches: BRANCHES, remoteBranches: REMOTE_BRANCHES };
  }
  if (url.startsWith("/api/worktrees")) {
    return { projectRoot: ROOT, isGit: true, branches: BRANCHES, remoteBranches: REMOTE_BRANCHES, worktrees: WORKTREES };
  }
  if (url.startsWith("/api/git/commits")) {
    const params = new URL(url, "http://fixture.local").searchParams;
    if (params.get("ref") === "origin/preview") return { commits: [], hasMore: false, repositoryRoot: ROOT, isGitRepository: true };
    return COMMIT_PAGE;
  }
  if (url.startsWith("/api/git/commit-diff")) {
    return COMMIT_DETAIL;
  }
  return {};
}

const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  const body = JSON.stringify(answer(url, init));
  if (!url.startsWith("/api/")) return realFetch(input, init);
  return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
};

window.__opened = [];

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    {/* The panel's header row, as AppShell builds it: the strip, and the two view toggles
        at its leading edge. The Git button's own markup is AppShell's; the classes and the
        glyph are what is measured, so the shape is copied once, here. */}
    <div className="right-panel" style={{ display: "flex", flexDirection: "column", height: "100vh", border: "1px solid var(--border)" }}>
      <div className="right-panel-tab-strip">
        <div className="file-tab-bar-slot" />
        <button type="button" className="file-workbench-icon-button file-tree-toggle" title="Show file list" aria-label="Show file list">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="4.25" cy="5.25" r="1.35" /></svg>
        </button>
        <button type="button" className="file-workbench-icon-button git-panel-toggle is-active" title="Hide the Git view" aria-label="Hide the Git view" aria-pressed="true" aria-controls="git-panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
            <line x1="6" y1="4" x2="6" y2="15" /><circle cx="18" cy="6" r="2.6" /><circle cx="6" cy="18" r="2.6" /><path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
        </button>
      </div>
      <div className="right-panel-body" style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <GitPanel cwd={ROOT} onOpenFile={(filePath, fileName) => { window.__opened = [filePath, fileName]; }} />
        </div>
      </div>
    </div>
  </I18nProvider>,
);
