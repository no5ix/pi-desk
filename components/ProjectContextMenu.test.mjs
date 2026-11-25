import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  MENU_SKELETON_REVEAL_MS,
  ProjectContextMenuPanel,
  createProjectWorktree,
  currentCheckout,
  filterBranchRows,
  fetchProjectBranchMenu,
  fetchRemoteBranches,
  removeProjectWorktree,
} = await jiti.import("./ProjectContextMenu.tsx");
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const cssSource = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

const ROOT = "/repo";
const MAIN = { path: ROOT, branch: "main", isMain: true };
const FEATURE = { path: "/repo-worktrees/feature", branch: "feature", isMain: false };
const DEV = { path: "/repo-worktrees/dev", branch: "dev", isMain: false };

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Answers fetch with `status`/`body` and records the requests. */
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return calls;
}

test("the menu data carries isGit and falls back to an empty non-git state", async () => {
  stubFetch(200, { projectRoot: ROOT, isGit: true, branches: ["main"], remoteBranches: ["r"], worktrees: [MAIN] });
  assert.deepEqual(await fetchProjectBranchMenu(ROOT), {
    root: ROOT, projectRoot: ROOT, isGit: true, branches: ["main"], remoteBranches: ["r"], worktrees: [MAIN], loaded: true,
  });
  // A linked worktree answers with the repository's root. The list belongs to the
  // checkout asked about, and the actions run there: git branches are the repository's,
  // so `feature` and `main` are the worktree's branches too. The old equality check
  // (`data.projectRoot === cwd`) threw the payload away in every worktree, and a
  // repository with a dozen branches read as "No other branches".
  stubFetch(200, {
    projectRoot: ROOT, currentWorktreePath: FEATURE.path, isGit: true,
    branches: ["main", "feature"], remoteBranches: ["r"], worktrees: [MAIN, FEATURE],
  });
  assert.deepEqual(await fetchProjectBranchMenu(FEATURE.path), {
    root: FEATURE.path, projectRoot: ROOT, isGit: true,
    branches: ["main", "feature"], remoteBranches: ["r"], worktrees: [MAIN, FEATURE], loaded: true,
  });
  stubFetch(200, { projectRoot: "/elsewhere", isGit: true });
  assert.equal((await fetchProjectBranchMenu(ROOT)).isGit, false);
  stubFetch(403, { error: "Access denied" });
  assert.deepEqual((await fetchProjectBranchMenu(ROOT)).worktrees, []);
});

test("fetching remote branches posts the project root and surfaces git's error", async () => {
  const calls = stubFetch(200, { success: true, branches: ["main", "x"], remoteBranches: ["y"] });
  assert.deepEqual(await fetchRemoteBranches(ROOT), { branches: ["main", "x"], remoteBranches: ["y"] });
  assert.deepEqual(calls, [{ url: "/api/worktrees/fetch", method: "POST", body: { cwd: ROOT } }]);
  stubFetch(400, { error: "fatal: unable to access remote" });
  await assert.rejects(fetchRemoteBranches(ROOT), /unable to access remote/);
});

test("creating a worktree posts the branch and returns its path", async () => {
  const calls = stubFetch(200, { path: FEATURE.path, branch: "feature" });
  assert.deepEqual(await createProjectWorktree(ROOT, "feature"), { path: FEATURE.path, branch: "feature" });
  assert.deepEqual(calls, [{ url: "/api/worktrees", method: "POST", body: { cwd: ROOT, branch: "feature" } }]);
  stubFetch(400, { error: "Directory already exists: /repo-worktrees/feature" });
  await assert.rejects(createProjectWorktree(ROOT, "feature"), /already exists/);
});

test("removing a dirty worktree asks for force first, then reports git's refusal", async () => {
  const calls = stubFetch(200, { success: true });
  assert.equal(await removeProjectWorktree(ROOT, FEATURE.path, false), "removed");
  assert.deepEqual(calls[0], { url: "/api/worktrees", method: "DELETE", body: { cwd: ROOT, path: FEATURE.path, force: false } });

  stubFetch(409, { error: "contains modified or untracked files", dirty: true });
  assert.equal(await removeProjectWorktree(ROOT, FEATURE.path, false), "needs-force");
  await assert.rejects(removeProjectWorktree(ROOT, FEATURE.path, true), /modified or untracked/);
  stubFetch(400, { error: "Cannot remove the main worktree" });
  await assert.rejects(removeProjectWorktree(ROOT, ROOT, false), /main worktree/);
});

test("the current checkout is the selected worktree, else the main one", () => {
  assert.equal(currentCheckout([MAIN, FEATURE], FEATURE.path), FEATURE);
  assert.equal(currentCheckout([MAIN, FEATURE], "/somewhere/else"), MAIN);
  assert.equal(currentCheckout([], null), undefined);
});

const noop = () => {};
/** Which of the three glyphs a row wears, read off the drawing inside its mark. */
function glyphFor(html, branch) {
  const name = html.indexOf(`data-branch="${branch}"`);
  assert.notEqual(name, -1, `a row for ${branch}`);
  const mark = html.lastIndexOf("sidebar-project-context-menu-branch-mark", name);
  const slice = html.slice(mark, name);
  if (slice.includes("m6 14 1.5-2.9")) return "folder";
  if (slice.includes("M4 4h9a2 2")) return "worktree";
  if (slice.includes('x1="6" y1="3"')) return "branch";
  throw new Error(`no glyph in the row for ${branch}`);
}
function render(overrides = {}) {
  const props = {
    menuRef: { current: null },
    projectRoot: ROOT,
    pos: { top: 0, left: 0 },
    view: "actions",
    branchMenu: { root: ROOT, projectRoot: ROOT, isGit: true, branches: ["main", "feature", "dev"], remoteBranches: ["remote-only"], worktrees: [MAIN, FEATURE, DEV], loaded: true },
    branchLoading: false,
    selectedCwd: FEATURE.path,
    switchingBranch: null,
    fetching: false,
    worktreeBusy: false,
    worktreeError: null,
    confirmRemove: null,
    newBranch: "",
    canReveal: true,
    revealLabel: "Reveal",
    projectRevealError: null,
    t: (key, params) => params ? `${key}(${Object.values(params).join(",")})` : key,
    onShowBranches: noop, onShowWorktrees: noop, onShowNewWorktree: noop, onBackToActions: noop,
    onOpenTerminal: noop, onReveal: noop, onArchive: noop, onRestore: noop, onSwitchBranch: noop, onFetch: noop,
    onSelectWorktree: noop, onRequestRemove: noop, onConfirmRemove: noop, onCancelRemove: noop,
    onNewBranchChange: noop, onCreateWorktree: noop,
    ...overrides,
  };
  return renderToStaticMarkup(React.createElement(ProjectContextMenuPanel, props));
}

test("the actions page is folder actions only", () => {
  const html = render();
  for (const key of ["sidebar.openTerminalHere", "Reveal", "sidebar.archiveProject"]) {
    assert.ok(html.includes(key), key);
  }
  // Branching belongs to the composer's branch chip now; the project's "…" menu
  // offers Switch branch / Worktrees… nowhere, DOM or native.
  for (const key of ["sidebar.switchBranch", "sidebar.worktrees"]) {
    assert.ok(!html.includes(key), `${key} is not a project-menu entry`);
  }
  assert.doesNotMatch(html, /sidebar-project-context-menu--wide/);
});

test("a branch row's worktree button opens the form, and only where a worktree can start", () => {
  const plain = render({ view: "branches" });
  assert.ok(!plain.includes("sidebar-project-context-menu-branch-action\""), "the sidebar's own page gets no worktree button");
  const chip = render({ view: "branches", onCreateWorktreeFromBranch: () => {} });
  assert.match(chip, /sidebar-project-context-menu-row sidebar-project-context-menu-row--branch/);
  // One button, on the rows where a worktree can start. The branch this folder is on and
  // the branch a worktree already holds get none: git refuses both, and the row's name is
  // the switch. The button is the way into the new-worktree form, the page that names the
  // folder the branch will land in — it never opens a list of names.
  assert.equal(chip.match(/class="sidebar-project-context-menu-branch-action"/g)?.length, 1,
    "one action button, on the one branch that can start a worktree");
  assert.equal(chip.match(/sidebar\.worktreeFromBranchTitle\(/g)?.length, 2, "the button is named (title and aria-label)");
  for (const key of ["sidebar.checkOutBranchTitle", "sidebar.openWorktreeForBranchTitle"]) {
    assert.ok(!chip.includes(key), `${key} belonged to the removed branch glyph`);
  }
  // The name is the switch, and it is the one that says what it will do.
  assert.ok(chip.includes('aria-current="true"'), "the checked-out branch is marked in its own row");
  assert.equal(chip.match(/sidebar\.currentWorktreeBranchTitle\(feature\)/g)?.length, 1,
    "the current row of a linked worktree names the worktree, not just the branch");
  assert.equal(chip.match(/sidebar\.currentBranchTitle\(/g)?.length ?? 0, 0,
    "the plain-folder title belongs to the main checkout's row, not to this one");
  assert.equal(chip.match(/sidebar\.mainCheckoutBranchTitle\(/g)?.length, 1,
    "the row for a branch the project's own folder holds names that folder");
  assert.equal(chip.match(/sidebar\.branchInWorktreeTitle\(/g)?.length, 1,
    "the row of a branch a linked worktree holds names that worktree");
  assert.equal(chip.match(/title="sidebar\.branchRemoteTitle"/g)?.length, 1, "the remote row says what checking it out does");
  // A worktree is removed from the row of the branch it holds. The "Worktrees…" page is
  // not a menu item any more: every branch with a folder of its own is in this list with
  // the glyph that says so. The desktop shell keeps its native Worktrees… popup.
  assert.equal(chip.match(/class="worktree-remove-button"/g)?.length, 1, "the linked worktree's row carries the removal");
  assert.ok(chip.includes(`sidebar.removeWorktreeTitle(${DEV.path})`), "and names the folder it takes away");
  assert.ok(!chip.includes(">sidebar.worktrees<"), "no Worktrees… row on the branch page");
  assert.ok(!plain.includes(">sidebar.worktrees<"));
  assert.ok(!chip.includes("sidebar.moreActions"), "the branch page opens on its own: no Project actions step back");
  assert.ok(!chip.includes("sidebar-project-context-menu-back"), "and no back button");
});
test("the current row wears the glyph of the folder it is on", () => {
  // The screenshot: `main-bak` is checked out in `auto-toc-worktrees/main-bak3-test-wt`,
  // the user clicks it, and every glyph in the window goes back to the plain folder — on
  // the old rule that a folder whose name does not match its branch is an ordinary folder.
  // The folder is a linked worktree, and the glyph is how the user checks which folder a
  // prompt runs in, so the current row wears the checkout glyph too. `holderIsMain` (the
  // checkout that holds the branch — here, this folder) is what says which of the two.
  const menu = {
    root: ROOT, projectRoot: ROOT, isGit: true,
    branches: ["main", "feature", "dev"], remoteBranches: [], worktrees: [MAIN, FEATURE, DEV], loaded: true,
  };
  const inWorktree = render({ view: "branches", branchMenu: menu, selectedCwd: FEATURE.path });
  assert.equal(glyphFor(inWorktree, "feature"), "worktree", "the branch this linked worktree is on");
  assert.equal(glyphFor(inWorktree, "dev"), "worktree", "a branch another linked worktree holds");
  assert.equal(glyphFor(inWorktree, "main"), "folder", "a branch the project's own folder holds stays the project");
  assert.ok(inWorktree.includes("sidebar.currentWorktreeBranchTitle(feature)"), "and the row's title says worktree");
  const onMain = render({ view: "branches", branchMenu: menu, selectedCwd: MAIN.path });
  assert.equal(glyphFor(onMain, "main"), "folder", "the main checkout's branch is the project's own folder");
  assert.ok(onMain.includes("sidebar.currentBranchTitle(main)"), "and its title says folder");
  assert.equal(glyphFor(onMain, "feature"), "worktree", "the linked rows keep theirs either way");
});
test("the branch list narrows from its filter box once it is long", () => {
  const many = {
    root: ROOT, isGit: true,
    branches: ["main", "feature", "dev", "claude/settings-layout-review-8265af", "fix/a", "fix/b", "fix/c"],
    remoteBranches: ["origin/only"],
    worktrees: [MAIN, FEATURE],
    loaded: true,
  };
  const long = render({ view: "branches", branchMenu: many, onCreateWorktreeFromBranch: () => {} });
  assert.ok(long.includes("sidebar-project-context-menu-filter"), "a seven-branch list gets a filter box");
  assert.ok(long.includes('aria-label="sidebar.filterBranches"'), "the box is named");
  const short = render({ view: "branches", onCreateWorktreeFromBranch: () => {} });
  assert.ok(!short.includes("sidebar-project-context-menu-filter"), "a four-branch list is read, not filtered");

  // The matcher itself: case-insensitive substring, local and remote rows alike,
  // and a blank query changes nothing (the order the list arrives in).
  const rows = [
    { name: "main", remote: false },
    { name: "Claude/Settings-Layout-Review", remote: false },
    { name: "fix/main-bak", remote: false },
    { name: "only-on-remote", remote: true },
  ];
  assert.deepEqual(filterBranchRows(rows, "main").map((r) => r.name), ["main", "fix/main-bak"]);
  assert.deepEqual(filterBranchRows(rows, "  CLAUDE/settings ").map((r) => r.name), ["Claude/Settings-Layout-Review"]);
  assert.deepEqual(filterBranchRows(rows, "remote").map((r) => r.name), ["only-on-remote"]);
  assert.equal(filterBranchRows(rows, "nope").length, 0);
  assert.equal(filterBranchRows(rows, "   ").length, rows.length, "a blank query narrows nothing");
});

test("the row's tag stays a word, and the panel is as wide as its longest name", async () => {
  // The shape the user screenshotted: a panel told to be 240px, a branch name wrapped in
  // half, and the `worktree` tag squeezed to `w…`. Nothing in this panel may be cut — a
  // branch name is the one thing on the screen that exists nowhere else.
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const chip = render({ view: "branches", onCreateWorktreeFromBranch: () => {} });
  assert.match(chip, /<span class="sidebar-project-context-menu-branch-name" data-branch="remote-only">remote-only<\/span>/,
    "the name is its own element, and the row carries the full branch name for a test to read");
  assert.match(css, /\.sidebar-project-context-menu--wide \{[\s\S]*?width: max-content;[\s\S]*?max-width: min\(420px, calc\(100vw - 16px\)\);/,
    "the panel asks for its rows' width, capped at the window");
  assert.match(css, /\.sidebar-project-context-menu-branch-name \{[\s\S]*?min-width: 4em;[\s\S]*?overflow-wrap: anywhere;/,
    "at the window's own edge a name breaks inside a word, so it is never squeezed to a strip");
  assert.match(css, /\.sidebar-project-context-menu-branch-tag \{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap;/,
    "the tag keeps its word whole: it no longer ellipsizes");
  assert.match(css, /\.sidebar-project-context-menu-row--branch > button\[role="menuitem"\] \{[\s\S]*?overflow: hidden;/,
    "the last line of defence: the button clips, nothing reaches the icons");
  assert.match(css, /\.sidebar-project-context-menu-branch-actions \{[\s\S]*?flex: 0 0 auto;/);
  // The new-worktree form ends in an absolute path on a row of its own: a folder the
  // user is being asked to create is not a thing to cut in half.
  assert.match(css, /\.sidebar-project-context-menu-worktree-hint \{[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(css, /\.sidebar-project-context-menu-worktree-path \{[\s\S]*?font-family: var\(--font-mono\);[\s\S]*?overflow-wrap: anywhere;/,
    "the path row is mono and breaks inside a word, so a long folder is read whole");
});

test("the branch list is the current branch, the worktree branches, then a tree of prefixes", () => {
  const menu = {
    root: ROOT, projectRoot: ROOT, isGit: true,
    branches: [
      "main", "wt-test",
      "fix/a", "fix/b",
      "wt/wt-test-icon-face",
      "probe",
      "feat/a-very-long-branch-name-for-the-header-worktrees",
    ],
    remoteBranches: [],
    worktrees: [MAIN, { path: "/repo-worktrees/wt-test", branch: "wt-test", isMain: false }],
    loaded: true,
  };
  const html = render({ view: "branches", branchMenu: menu, selectedCwd: MAIN.path, onCreateWorktreeFromBranch: () => {} });
  const order = [...html.matchAll(/data-(branch|group)="([^"]+)"/g)].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(order, [
    "branch:main", "branch:wt-test",
    "branch:probe",
    "group:feat", "branch:feat/a-very-long-branch-name-for-the-header-worktrees",
    "group:fix", "branch:fix/a", "branch:fix/b",
    "group:wt", "branch:wt/wt-test-icon-face",
  ], "the checkout's branch, then the branch with a folder of its own, then the rest: names that"
    + " stand on their own, then the prefix groups in order, each with its branches under it");
  // A leaf under a group is named by what the group's row did not already say; the row
  // keeps the full name, which is what a git call takes.
  assert.match(html, /<span class="sidebar-project-context-menu-branch-name" data-branch="wt\/wt-test-icon-face">wt-test-icon-face<\/span>/);
  // The glyphs are the three facts in two voices: the accent for the branch this folder is
  // on and for the branch with a worktree of its own, quiet ink for every other name and
  // for every group.
  assert.equal(html.match(/<span class="sidebar-project-context-menu-branch-mark">/g)?.length, 2);
  // 5 ordinary branches (two of them under `fix`) and 3 groups: eight quiet glyphs.
  assert.equal(html.match(/<span class="sidebar-project-context-menu-branch-mark is-plain">/g)?.length, 8);
  assert.match(html, /data-branch="main">main<\/span>/, "the current row carries the whole name, not a suffix");
  // Every group says it is open, and names the fold it offers.
  assert.equal(html.match(/aria-expanded="true"/g)?.length, 3);
  assert.ok(html.includes('aria-label="sidebar.branchGroupCollapse(fix)"'), "the arrow names the fold it offers");
  assert.ok(html.includes('aria-label="sidebar.branchGroupCollapse(feat)"'));
  assert.match(html, /class="sidebar-project-context-menu-branch-group" style="--branch-depth:0"/,
    "a group is a row of its own, at its depth, with an arrow to fold it");
  assert.match(html, /class="sidebar-project-context-menu-branch-chevron" aria-hidden="true"/, "the arrow is the arrow");
  assert.ok(html.includes('sidebar-project-context-menu-row--branch sidebar-project-context-menu-row--tree" style="--branch-depth:1"'),
    "a branch under a group is indented one step");
});

test("the new-worktree page names the branch it starts from and the folder it lands in", () => {
  const plain = render({ view: "new-worktree", newBranch: "test-upload" });
  assert.ok(!plain.includes("sidebar.newWorktreeFrom("), "from HEAD: no base sentence");
  // Two rows: the sentence (with the base branch inside it when there is one), then
  // the folder on its own line. One line carrying both was the sentence the user
  // screenshotted cut off mid-path.
  assert.match(plain, /sidebar-project-context-menu-worktree-hint">\s*<div class="sidebar-project-context-menu-worktree-sentence">sidebar\.newWorktreeInto<\/div>/,
    "without a base branch the sentence is short and carries no path");
  const from = render({ view: "new-worktree", newBranch: "wt/wt-test-icon-face", worktreeBaseBranch: "fix/initial-heading-offset" });
  assert.match(from, /sidebar-project-context-menu-worktree-sentence">sidebar\.newWorktreeFrom\(fix\/initial-heading-offset\)<\/div>/,
    "the sentence names the base branch and stops at the folder");
  for (const [html, path] of [
    [plain, "/repo-worktrees/test-upload"],
    [from, "/repo-worktrees/wt-wt-test-icon-face"],
  ]) {
    assert.match(html, new RegExp(`sidebar-project-context-menu-worktree-path" title="${path.replace(/[/]/g, "\\/")}">${path.replace(/[/]/g, "\\/")}<\/div>`),
      "the folder is the one addWorktree() will create, read off the name being typed, whole and in its title");
  }
  // A folder under the home folder is shown in the app's `~` shape, like every other
  // path label; the row's title keeps the absolute path for the git call's reader.
  const home = render({
    view: "new-worktree",
    projectRoot: "/Users/tester/auto-toc",
    branchMenu: {
      root: "/Users/tester/auto-toc", projectRoot: "/Users/tester/auto-toc", isGit: true,
      branches: ["main"], remoteBranches: [], worktrees: [], loaded: true,
    },
    newBranch: "main-bak2",
  });
  assert.match(home, /sidebar-project-context-menu-worktree-path" title="\/Users\/tester\/auto-toc-worktrees\/main-bak2">~\/auto-toc-worktrees\/main-bak2<\/div>/,
    "the home folder collapses to ~ on screen, never in the path that gets posted");
  // No "Switch worktree" page to step back to: the form is the page, and it closes with
  // Escape, Cancel, or a click outside, like every other menu in the app.
  assert.ok(!from.includes("sidebar-project-context-menu-back"), "no back button");
  assert.ok(!from.includes("sidebar.switchWorktree"), "no title for the page it is not");
  assert.ok(!from.includes('class="sidebar-project-context-menu-heading"'), "and no heading over one sentence");
});

test("an archived project's menu offers only restore and reveal", () => {
  const html = render({ archived: true });
  assert.ok(html.includes("sidebar.restoreProject"));
  assert.ok(html.includes("Reveal"));
  for (const key of ["sidebar.switchBranch", "sidebar.worktrees", "sidebar.openTerminalHere", "sidebar.archiveProject"]) {
    assert.ok(!html.includes(key), key);
  }
});

test("the worktree page switches, removes non-main checkouts and creates new ones", () => {
  const html = render({ view: "worktrees" });
  assert.match(html, /sidebar-project-context-menu--wide/);
  assert.ok(html.includes("sidebar.switchWorktree"));
  // One remove button per linked checkout; the main checkout is never removable.
  assert.equal(html.match(/worktree-remove-button/g)?.length, 2);
  assert.ok(html.includes(`sidebar.removeWorktreeTitle(${FEATURE.path})`));
  assert.ok(html.includes(`sidebar.removeWorktreeTitle(${DEV.path})`));
  assert.ok(!html.includes(`sidebar.removeWorktreeTitle(${ROOT})`), "the project's own folder is not a checkout to remove");
  // Current-checkout semantics drive the shared selection pill; main keeps its tag.
  assert.match(html, /aria-current="true"><span class="sidebar-project-context-menu-label">feature<\/span>/);
  assert.match(html, /<span class="sidebar-project-context-menu-label">main<\/span><span class="sidebar-project-context-menu-branch-tag">sidebar.main<\/span>/);
  assert.ok(html.includes("sidebar.newWorktree"));
});

test("a removal is confirmed in place, and a dirty checkout asks for force", () => {
  const confirm = render({ view: "worktrees", confirmRemove: { path: FEATURE.path, force: false } });
  assert.ok(confirm.includes("sidebar.confirmRemoveWorktree"));
  assert.ok(confirm.includes("i18n.remove"));
  // The row that asked stops asking: its button is replaced by the strip, while the
  // other checkouts keep theirs.
  assert.equal(confirm.match(/worktree-remove-button/g)?.length, 1);
  assert.ok(!confirm.includes(`sidebar.removeWorktreeTitle(${FEATURE.path})`), "the confirmed row has no button of its own");
  assert.ok(confirm.includes(`sidebar.removeWorktreeTitle(${DEV.path})`));
  const force = render({ view: "worktrees", confirmRemove: { path: FEATURE.path, force: true } });
  assert.ok(force.includes("sidebar.forceRemoveCheckout"));
  assert.match(force, /sidebar-project-context-menu-danger[^>]*>sidebar.force</);
});

test("worktrees and fetch are hidden for a folder that is not a git repository", () => {
  const branchMenu = { root: ROOT, isGit: false, branches: [], remoteBranches: [], worktrees: [], loaded: true };
  const worktrees = render({ view: "worktrees", branchMenu });
  assert.ok(worktrees.includes("sidebar.worktreesNeedGit"));
  assert.ok(!worktrees.includes("sidebar.newWorktree"));
  const branches = render({ view: "branches", branchMenu });
  assert.ok(!branches.includes("sidebar.fetchBranches"));
  assert.ok(branches.includes("sidebar.noOtherBranches"));
});

test("the branch page's fetch is the title row's corner icon, and shows its progress", () => {
  const idle = render({ view: "branches" });
  assert.match(idle, /class="sidebar-project-context-menu-heading sidebar-project-context-menu-heading--row"[^>]*>\s*<span>sidebar\.switchBranch<\/span>/,
    "the title row is a row, and its label is its own element");
  assert.match(idle, /class="sidebar-project-context-menu-fetch"[^>]*aria-label="sidebar\.fetchBranches"/,
    "the corner icon names the action it performs");
  assert.ok(!idle.includes(">sidebar.fetchBranches<"), "icon only: the row carries no words");
  const at = idle.indexOf("sidebar-project-context-menu-fetch");
  assert.ok(at > idle.indexOf("heading--row") && at < idle.indexOf("</div>"), "the icon lives in the title row");
  assert.ok(at < idle.indexOf('data-branch="main"'), "and above the list, so the list starts at its first branch");
  assert.ok(idle.includes("remote-only"));
  const busy = render({ view: "branches", fetching: true });
  assert.ok(busy.includes("sidebar.fetchingBranches"), "while it runs the icon says so");
  assert.match(busy, /sidebar-project-context-menu-fetch"[^>]*disabled/);
  assert.match(busy, /class="sidebar-project-context-menu-branch-spinner"/);
});

test("the new-worktree page suggests local branches and only creates with a name", () => {
  const empty = render({ view: "new-worktree" });
  assert.match(empty, /<input[^>]*role="combobox"/);
  assert.doesNotMatch(empty, /<datalist|<select/);
  assert.match(empty, /sidebar-project-context-menu-primary"[^>]*disabled/);
  const named = render({ view: "new-worktree", newBranch: "topic" });
  assert.doesNotMatch(named, /sidebar-project-context-menu-primary"[^>]*disabled/);
  const busy = render({ view: "new-worktree", newBranch: "topic", worktreeBusy: true });
  assert.ok(busy.includes("sidebar.creating"));
});

test("git errors are shown on the page that caused them", () => {
  for (const view of ["branches", "worktrees", "new-worktree"]) {
    const html = render({ view, worktreeError: "fatal: invalid reference" });
    assert.match(html, /role="alert">fatal: invalid reference</, view);
  }
});

test("the composer chip wires the branch and worktree pages, the sidebar does not", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const chip = await readFile(new URL("./ComposerBranchMenu.tsx", import.meta.url), "utf8");
  const hook = await readFile(new URL("../hooks/useProjectWorktreeActions.ts", import.meta.url), "utf8");
  // The DOM menu's pages are driven by the chip, through the shared action hook.
  for (const prop of ["view={view}", "onFetch=", "onSelectWorktree=", "onConfirmRemove=", "onCreateWorktree=", "onCreateWorktreeFromBranch="]) {
    assert.ok(chip.includes(prop), prop);
  }
  assert.match(chip, /useProjectWorktreeActions\(\{/);
  assert.match(chip, /showNativeProjectBranchMenu\(\{/);
  assert.match(chip, /showNativeProjectWorktreeMenu\(\{/);
  // Steps a native menu cannot do open the DOM menu at the same point.
  assert.match(chip, /openMenuAt\(NEW_WORKTREE_VIEW, point\)/);
  assert.match(chip, /openMenuAt\(WORKTREES_VIEW, point\);\s*actions\.requestRemove\(path\)/);
  // The worktree created from a branch starts from that branch.
  assert.match(hook, /createProjectWorktree\(projectRoot, branch, baseBranch\)/);
  assert.match(chip, /actions\.create\(cwd, baseBranch \?\? undefined\)/);
  // The sidebar has none of it left.
  assert.doesNotMatch(sidebar, /showNativeProjectWorktreeMenu\(\{|openDomProjectMenu\(|wtDropdownOpen|sidebar-folder-row/);
});
test("the branch panel does not paint a shape the list resizes, and sizes by the number placement starts from", () => {
  const loading = render({
    view: "branches",
    branchLoading: true,
    branchMenu: { root: ROOT, isGit: true, branches: [], remoteBranches: [], worktrees: [MAIN], loaded: false },
  });
  assert.match(loading, /data-loading="true"/,
    "the panel is invisible while the list is in flight, so the first rectangle the user sees is the final one (the flash was a panel that moved as the list landed)");
  assert.ok(!loading.includes("sidebar-project-context-menu-branch-skeleton"),
    "the loading shape is delayed, not painted on open: a fetch that lands in tens of milliseconds must not show a shape the list then resizes");
  const loaded = render({ view: "branches" });
  assert.ok(!loaded.includes('data-loading="true"'), "the panel is visible once the list is here");
  assert.match(loaded, /max-height: ?min\(70vh, 420px\)/,
    "the cap is MENU_MAX_HEIGHT_CSS: the chip's estimate, the hook's first placement, and the panel's own cap are one number");
  // The shape, when a slow fetch earns it, is the height the list settles at.
  const css = cssSource;
  const shape = css.match(/\.sidebar-project-context-menu-branch-skeletons \{([^}]*)\}/);
  assert.ok(shape, "the loading shape has no rule");
  assert.match(shape[1], /height: ?min\(70vh, 420px\);/);
  assert.ok(MENU_SKELETON_REVEAL_MS > 0 && MENU_SKELETON_REVEAL_MS < 400,
    "the reveal is a beat, timed in code: `prefers-reduced-motion` must not be able to strand the panel invisible");
});
