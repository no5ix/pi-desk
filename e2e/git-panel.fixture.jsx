/* @jsx runtime:automatic */
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import { GitPanel } from "../components/GitPanel";

/**
 * The Git panel's fixture: the panel, with a repository in words.
 *
 * The panel reads git through `POST /api/git/execute` and `GET /api/git/repos`,
 * so the fixture answers those (and the commit-diff route) with a fixed
 * repository: eight branches, one checked out in a linked folder, two remote
 * only, three under a `chore/` prefix the tree folds; three tags; four commits
 * of which the newest is a merge, touching two files; a working tree with a
 * staged edit, an unstaged edit and an untracked file.
 *
 * The point is the shape of the data the panel renders — enough branches to
 * grow its filter box, a merge to give the graph two lanes, a file list with
 * every state the Commit tab splits. `?theme=dark` renders the other theme.
 */
const REMOTE = "origin";

const BRANCH = (name, extra = {}) => ({
  name,
  fullName: name,
  fullRef: `refs/heads/${name}`,
  isRemote: false,
  isCurrent: false,
  ...extra,
});

const MAIN = "fix/flat-chat-blocks";

const LOCAL_BRANCHES = [
  BRANCH(MAIN, { isCurrent: true, checkedOutWorktreePath: "/repo", ahead: 2, behind: 0, lastCommitDate: "2026-11-20T10:00:00.000Z" }),
  BRANCH("feat/panel/git-view", { ahead: 0, behind: 1, lastCommitDate: "2026-11-19T10:00:00.000Z" }),
  BRANCH("chore/panel-notes", { lastCommitDate: "2026-11-18T10:00:00.000Z" }),
  BRANCH("chore/panel-colours", { lastCommitDate: "2026-11-17T10:00:00.000Z" }),
  BRANCH("chore/panel-copy", { lastCommitDate: "2026-11-16T10:00:00.000Z" }),
  BRANCH("docs/panel-notes", { lastCommitDate: "2026-11-15T10:00:00.000Z" }),
  BRANCH("release/1.2", { lastCommitDate: "2026-11-14T10:00:00.000Z" }),
  BRANCH("side/worktree", { checkedOutWorktreePath: "/repo/wt-side", lastCommitDate: "2026-11-13T10:00:00.000Z" }),
];

/*
 * The answer is per remote, exactly as `GitService.getRemoteBranches` answers:
 * `{ remote, branches: string[] }`. It used to be a list of `BranchInfo`, which
 * is what the panel assumed, and the two agreed with each other instead of with
 * the server. The real answer has no `name` on the group at all, and the branch
 * tree — which splits every row's name into folders — crashed on the first click
 * of the Git button. Keep this faithful to `lib/git/git-service.ts`.
 */
const REMOTE_BRANCHES = [
  { remote: REMOTE, branches: ["main", "preview", "feat/remote-only"] },
];

const TAGS = [
  { name: "v1.2.0", fullRef: "refs/tags/v1.2.0", isRemote: false, isCurrent: false },
  { name: "v1.1.0", fullRef: "refs/tags/v1.1.0", isRemote: false, isCurrent: false },
];

const COMMITS = [
  {
    hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    shortHash: "aaaaaaaa",
    parents: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccccccccccc"],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-11-20T10:00:00+01:00",
    commitDate: "2026-11-20T10:00:00+01:00",
    subject: "merge the panel branch",
    body: "",
    refs: [{ type: "HEAD", name: "HEAD" }, { type: "branch", name: MAIN }],
  },
  {
    hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    shortHash: "bbbbbbbb",
    parents: ["dddddddddddddddddddddddddddddddddddddddd"],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-11-19T10:00:00+01:00",
    commitDate: "2026-11-19T10:00:00+01:00",
    subject: "fix: keep the memory sampler inside the session budget",
    // Long on purpose: a long message used to run out of the panel and under the
    // window's status bar, so the harness measures that it scrolls in its box.
    body: Array.from({ length: 40 }, (unused, index) => `  * paragraph line ${index}: the graph is drawn from the lane snapshot, and a lane that leaves the page keeps its colour when it comes back.`).join("\n"),
    // A local branch and its remote, at the same commit: the row shows one chip.
    refs: [
      { type: "branch", name: "feat/synced-branch" },
      { type: "remote-branch", name: "origin/feat/synced-branch" },
      // The branch the harness picks to test the log filter: `git log
      // feat/panel/git-view` answers from this commit down, three of the four.
      { type: "branch", name: "feat/panel/git-view" },
    ],
  },
  {
    hash: "cccccccccccccccccccccccccccccccccccccccc",
    shortHash: "cccccccc",
    parents: ["dddddddddddddddddddddddddddddddddddddddd"],
    authorName: "Grace",
    authorEmail: "grace@example.com",
    authorDate: "2026-11-18T10:00:00+01:00",
    commitDate: "2026-11-18T10:00:00+01:00",
    subject: "the branch tree",
    body: "",
    refs: [{ type: "branch", name: "feat/panel/git-view" }],
  },
  {
    hash: "dddddddddddddddddddddddddddddddddddddddd",
    shortHash: "dddddddd",
    parents: [],
    authorName: "Ada",
    authorEmail: "ada@example.com",
    authorDate: "2026-11-17T10:00:00+01:00",
    commitDate: "2026-11-17T10:00:00+01:00",
    subject: "initial commit",
    body: "",
    refs: [{ type: "tag", name: "v1.1.0" }],
  },
];

const LANES = {
  [COMMITS[0].hash]: {
    column: 0,
    color: 0,
    lines: [
      { fromColumn: 0, toColumn: 0, toCommit: COMMITS[1].hash, type: "straight" },
      { fromColumn: 0, toColumn: 1, toCommit: COMMITS[2].hash, type: "merge-right" },
    ],
  },
  [COMMITS[1].hash]: {
    column: 0,
    color: 0,
    lines: [{ fromColumn: 0, toColumn: 0, toCommit: COMMITS[3].hash, type: "straight" }],
  },
  [COMMITS[2].hash]: {
    column: 1,
    color: 1,
    lines: [{ fromColumn: 1, toColumn: 0, toCommit: COMMITS[3].hash, type: "merge-left" }],
  },
  [COMMITS[3].hash]: { column: 0, color: 0, lines: [] },
};

const COMMIT_FILES = [
  { oldPath: "components/git/log/LogPanel.tsx", newPath: "components/git/log/LogPanel.tsx", status: "modified", isBinary: false, additions: 42, deletions: 6 },
  { oldPath: "app/native-theme.css", newPath: "app/native-theme.css", status: "modified", isBinary: false, additions: 12, deletions: 0 },
];

const WORKING_TREE = [
  { path: "components/GitPanel.tsx", oldPath: "", status: "modified", staged: true, additions: 8, deletions: 2 },
  { path: "components/git/git-ui.tsx", oldPath: "", status: "modified", staged: false, additions: 3, deletions: 1 },
  { path: "docs/agents/branchshift-git.md", oldPath: "", status: "untracked", staged: false, additions: 0, deletions: 0 },
];

const PATCH = [
  "diff --git a/components/git/log/LogPanel.tsx b/components/git/log/LogPanel.tsx",
  "--- a/components/git/log/LogPanel.tsx",
  "+++ b/components/git/log/LogPanel.tsx",
  "@@ -10,6 +10,8 @@",
  " const COLUMN_WIDTH = 10;",
  "+// Ten pixel lanes, as Branchshift drew them.",
  "+const ROW_HEIGHT = 28;",
  " ",
  "diff --git a/app/native-theme.css b/app/native-theme.css",
  "--- a/app/native-theme.css",
  "+++ b/app/native-theme.css",
  "@@ -1,3 +1,5 @@",
  " .git-panel {",
  "+  --git-lane-1: var(--ansi-blue);",
  "+}",
].join("\n");

/*
 * `?wide=1&commits=200&lanes=18` replaces the log with a repository the size of
 * a real one: many lanes, long subjects, ref chips on the top row. The four
 * commits of the small fixture hide the layouts that only appear when the graph
 * is wide and the list is long — which is how the commit rows shipped broken
 * (text laid out where the graph's padding is, columns overlapping, the subject
 * not visible at all).
 */
const WIDE = (() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("wide") !== "1") return null;
  const lanes = Number(params.get("lanes") ?? 18);
  const count = Number(params.get("commits") ?? 200);
  const hex = (index) => index.toString(16).padStart(40, "0");
  const commits = [];
  const laneMap = {};
  for (let index = 0; index < count; index += 1) {
    const hash = hex(index);
    const parent = hex(index + 1);
    const column = index % lanes;
    commits.push({
      hash,
      shortHash: hash.slice(0, 8),
      parents: [parent],
      authorName: index % 3 === 0 ? "Davy Massonetoto" : "no5ix",
      authorEmail: "lynx@example.com",
      authorDate: new Date(Date.UTC(2026, 10, 27) - index * 40 * 60 * 1000).toISOString(),
      commitDate: new Date(Date.UTC(2026, 10, 27) - index * 40 * 60 * 1000).toISOString(),
      subject: `commit ${index}: docs: a fixture's answer comes from the server, not the component`,
      body: "",
      refs: index === 0
        ? [{ type: "branch", name: "pi-desk-main" }, { type: "remote-branch", name: "origin/pi-desk-main" }]
        : [],
    });
    laneMap[hash] = {
      column,
      color: column % 8,
      lines: [{ fromColumn: column, toColumn: column, toCommit: parent, type: "commit" }],
    };
  }
  return { commits, lanes: laneMap };
})();

const COMMANDS = {
  getRepos: () => ({
    repos: [
      { id: "/repo", name: "pi-desk", rootPath: "/repo", isWorktree: false, branch: MAIN, label: "pi-desk" },
      { id: "/repo/wt-side", name: "wt-side", rootPath: "/repo/wt-side", isWorktree: true, branch: "side/worktree", label: "wt-side" },
    ],
    currentId: "/repo",
    // The app's project list (`?projects=1`): the folders the sessions live in.
    projects: [
      { path: "/repo", name: "pi-desk", branch: MAIN, isWorktree: false },
      { path: "/repo/wt-side", name: "wt-side", branch: "side/worktree", isWorktree: true },
      { path: "/projects/pi-web", name: "pi-web", branch: "main", isWorktree: false },
      { path: "/projects/codex", name: "codex", branch: "feat/memory", isWorktree: false },
      { path: "/projects/skills", name: "skills", branch: "main", isWorktree: false },
    ],
  }),
  getBranches: () => LOCAL_BRANCHES,
  getRemoteBranches: () => REMOTE_BRANCHES,
  getTags: () => TAGS,
  getBranchDashboardPreferences: () => ({ preferences: { showTags: true, singleClickAction: "filter" }, favorites: {} }),
  getGraphData: (params) => {
    // The panel's filters have to reach git, so the fixture answers them the way
    // git does: `branch` is that ref's history, `search` is --grep. The queries
    // are recorded for the harness to read.
    (window.__logQueries ??= []).push(params ?? {});
    const page = WIDE
      ? { commits: WIDE.commits, lanes: WIDE.lanes }
      : { commits: COMMITS, lanes: LANES };
    let commits = page.commits;
    if (params?.branch) {
      // `git log <branch>`: the branch's own commits, tip first.
      const tip = commits.find((commit) =>
        commit.refs.some((ref) => ref.name === params.branch),
      );
      const wanted = new Set();
      const walk = (hash) => {
        const commit = commits.find((entry) => entry.hash === hash);
        if (!commit || wanted.has(commit.hash)) return;
        wanted.add(commit.hash);
        commit.parents.forEach(walk);
      };
      if (tip) walk(tip.hash);
      // The wide fixture's branch names are all tips of one synthetic history, so a
      // name that carries no ref there still answers the history — the layout pass
      // is about 200 commits in 18 lanes, not about which branch owns which commit.
      // The small fixture names its refs, and the real repository is covered by
      // `app/api/git/flow.test.mjs`.
      commits = tip ? commits.filter((commit) => wanted.has(commit.hash)) : commits;
    }
    const search = (params?.search ?? "").trim();
    if (search) {
      commits = commits.filter((commit) =>
        `${commit.subject} ${commit.body ?? ""}`.toLowerCase().includes(search.toLowerCase()),
      );
    }
    return { graphData: { commits, lanes: page.lanes }, hasMore: false };
  },
  loadMoreLog: () => ({ graphData: { commits: [], lanes: {} }, hasMore: false }),
  getLog: () => COMMITS,
  getCommitFiles: () => COMMIT_FILES,
  getAheadCommits: () => [],
  getWorkingTreeChanges: () => WORKING_TREE,
  getStatus: () => WORKING_TREE.map((file) => ({ path: file.path, indexStatus: file.staged ? "M" : " ", workTreeStatus: file.staged ? " " : "M" })),
  getConflictFiles: () => [],
  getMergeState: () => ({ isMerging: false }),
  getRebaseState: () => ({ isRebasing: false }),
  getCherryPickState: () => ({ isCherryPicking: false }),
  getShelves: () => [{ id: "stash@{0}", message: "panel work in progress", date: "2026-11-21T09:00:00.000Z", files: ["components/GitPanel.tsx"] }],
  getIdeaShelves: () => [],
  getAmendMessage: () => "merge the panel branch",
  getRecentCommitMessages: () => ["draw the commit graph", "the branch tree"],
  refreshGitState: () => null,
};

// The event stream is not what this harness measures, and a served SSE stream
// would sit open for the whole run. The panel's own reconnect logic is its
// suite's business; here the stream is a connection that never reports.
class StubEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}
globalThis.EventSource = StubEventSource;

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input?.url ?? input), "http://fixture.local");
  if (url.pathname === "/api/git/execute") {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const handler = COMMANDS[body.command];
    const payload = handler
      ? { ok: true, data: handler(body.params ?? {}) }
      : { ok: false, error: { code: "UNKNOWN", message: `${body.command} is not mocked` } };
    return new Response(JSON.stringify(payload), { status: handler ? 200 : 400, headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/api/git/repos") {
    return new Response(JSON.stringify(COMMANDS.getRepos()), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.pathname === "/api/git/commit-diff") {
    return new Response(JSON.stringify({ isGitRepository: true, patch: PATCH }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // The event stream: answered as an empty stream, so the panel settles into
  // its polled state rather than retrying.
  if (url.pathname === "/api/git/events") {
    return new Response("", { status: 501, headers: { "content-type": "text/event-stream" } });
  }
  return realFetch(input, init);
};

// The app's own theme switch: the same two flags `THEME_INIT_SCRIPT` sets, with
// the choice taken from the harness's `?theme=`.
const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
try { localStorage.setItem("pi-theme", theme); } catch { /* private mode */ }
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");
void THEME_INIT_SCRIPT;

const strip = document.createElement("div");
strip.className = "right-panel-tab-strip";
strip.innerHTML = `
  <button type="button" class="file-workbench-icon-button file-tree-toggle" aria-label="Files"></button>
  <button type="button" class="file-workbench-icon-button git-panel-toggle" aria-label="Git" aria-pressed="true"></button>
  <div class="file-tab-bar-slot"></div>
  <div class="right-panel-actions"><button type="button" class="icon-button">Close</button></div>`;

const panel = document.createElement("div");
panel.id = "git-panel-host";
// The panel fills the space the shell gives it: the strip is its own row, and
// the panel takes the rest, exactly as in the app's right panel.
panel.style.flex = "1";
panel.style.minHeight = "0";
panel.style.display = "flex";

const root = document.getElementById("root");
root.style.display = "flex";
root.style.flexDirection = "column";
root.style.height = "100vh";
root.appendChild(strip);
root.appendChild(panel);

createRoot(panel).render(
  <I18nProvider>
    <GitPanel cwd="/repo" onOpenFile={() => {}} onSwitchRepository={() => {}} />
  </I18nProvider>,
);
