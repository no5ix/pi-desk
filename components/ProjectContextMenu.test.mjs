import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
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

const ROOT = "/repo";
const MAIN = { path: ROOT, branch: "main", isMain: true };
const FEATURE = { path: "/repo-worktrees/feature", branch: "feature", isMain: false };

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
    root: ROOT, isGit: true, branches: ["main"], remoteBranches: ["r"], worktrees: [MAIN], loaded: true,
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
function render(overrides = {}) {
  const props = {
    menuRef: { current: null },
    projectRoot: ROOT,
    pos: { top: 0, left: 0 },
    view: "actions",
    branchMenu: { root: ROOT, isGit: true, branches: ["main", "feature", "dev"], remoteBranches: ["remote-only"], worktrees: [MAIN, FEATURE], loaded: true },
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

test("a branch row gets the composer chip's two buttons, and the plain row does not", () => {
  const plain = render({ view: "branches" });
  assert.ok(!plain.includes("sidebar-project-context-menu-branch-actions"), "the sidebar's own page keeps the plain row");
  const chip = render({ view: "branches", onCreateWorktreeFromBranch: () => {} });
  assert.match(chip, /sidebar-project-context-menu-row sidebar-project-context-menu-row--branch/);
  // One pair per branch: check it out (or open the worktree that already holds it),
  // and the worktree it can start. Each button names itself twice (title and
  // aria-label), so four branches mean eight worktree hits and six checkout hits:
  // `main` is checked out in the main checkout, so its branch button opens that folder.
  assert.equal(chip.match(/sidebar\.checkOutBranchTitle\(/g)?.length, 6, "feature, dev, remote-only");
  assert.equal(chip.match(/sidebar\.openWorktreeForBranchTitle\(/g)?.length, 2, "main lives in another worktree");
  assert.equal(chip.match(/sidebar\.worktreeFromBranchTitle\(/g)?.length, 8);
  const mainButton = chip.match(/<button[^>]*sidebar\.openWorktreeForBranchTitle\(main\)[^>]*>/);
  assert.ok(mainButton, "the branch held in a worktree gets the worktree-opening button");
  assert.ok(!/disabled/.test(mainButton[0]), "opening the worktree that holds it is allowed");
  // The branch already checked out (the render's selectedCwd is the feature
  // worktree) cannot be checked out again.
  const featureButton = chip.match(/<button[^>]*sidebar\.checkOutBranchTitle\(feature\)[^>]*>/);
  assert.ok(featureButton, "the checkout button for the current branch");
  assert.match(featureButton[0], /disabled/, "the current branch's checkout button is off");
  const devButton = chip.match(/<button[^>]*sidebar\.checkOutBranchTitle\(dev\)[^>]*>/);
  assert.ok(devButton && !/disabled/.test(devButton[0]), "another branch can be checked out");
  // The worktree list hangs off the chip's branch page, where a checkout is switched or removed.
  assert.ok(chip.includes(">sidebar.worktrees</"), "Worktrees… opens from the branch page");
  assert.ok(!plain.includes(">sidebar.worktrees</"));
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

test("the remote tag never lands on the row's icons", async () => {
  // The overlap the user screenshotted: a long name and the `remote` tag share
  // the row's button, and the button's right edge is the icon column. The tag
  // used to be pushed past that edge and painted over the branch/worktree glyphs.
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const chip = render({ view: "branches", onCreateWorktreeFromBranch: () => {} });
  assert.match(chip, /<span class="sidebar-project-context-menu-branch-name">remote-only<\/span>/,
    "the name is its own element, so it can be the flexible one");
  assert.match(css, /\.sidebar-project-context-menu-branch-name \{[\s\S]*?min-width: 4em;[\s\S]*?overflow-wrap: anywhere;/,
    "the name breaks anywhere and keeps a floor, so it is never squeezed to a strip");
  assert.match(css, /\.sidebar-project-context-menu-branch-tag \{[\s\S]*?flex: 0 1 auto;[\s\S]*?text-overflow: ellipsis;/,
    "the tag is the part that gives way");
  assert.match(css, /\.sidebar-project-context-menu-row--branch > button\[role="menuitem"\] \{[\s\S]*?overflow: hidden;/,
    "the last line of defence: the button clips, nothing reaches the icons");
  assert.match(css, /\.sidebar-project-context-menu-branch-actions \{[\s\S]*?flex: 0 0 auto;/);
});

test("the new-worktree page names the branch it starts from", () => {
  const plain = render({ view: "new-worktree", newBranch: "test-upload" });
  assert.ok(!plain.includes("sidebar.newWorktreeFrom("), "from HEAD: no base sentence");
  const from = render({ view: "new-worktree", newBranch: "test-upload", worktreeBaseBranch: "find-icons" });
  assert.match(from, /sidebar-project-context-menu-hint">sidebar\.newWorktreeFrom\(find-icons\)</);
  // Back is the worktree list, the page the form was opened from.
  assert.match(from, /sidebar-project-context-menu-back[^>]*>[\s\S]*?sidebar\.switchWorktree</);
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
  // One remove button, for the feature worktree only; main is never removable.
  assert.equal(html.match(/worktree-remove-button/g)?.length, 1);
  assert.ok(html.includes(`sidebar.removeWorktreeTitle(${FEATURE.path})`));
  // Current-checkout semantics drive the shared selection pill; main keeps its tag.
  assert.match(html, /aria-current="true"><span class="sidebar-project-context-menu-label">feature<\/span>/);
  assert.match(html, /<span class="sidebar-project-context-menu-label">main<\/span><span class="sidebar-project-context-menu-branch-tag">sidebar.main<\/span>/);
  assert.ok(html.includes("sidebar.newWorktree"));
});

test("a removal is confirmed in place, and a dirty checkout asks for force", () => {
  const confirm = render({ view: "worktrees", confirmRemove: { path: FEATURE.path, force: false } });
  assert.ok(confirm.includes("sidebar.confirmRemoveWorktree"));
  assert.ok(confirm.includes("i18n.remove"));
  assert.equal(confirm.match(/worktree-remove-button/g), null);
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

test("the branch page leads with a fetch row that shows its progress", () => {
  const idle = render({ view: "branches" });
  assert.match(idle, /sidebar-project-context-menu-fetch[^>]*>.*sidebar.fetchBranches/);
  assert.ok(idle.includes("remote-only"));
  const busy = render({ view: "branches", fetching: true });
  assert.ok(busy.includes("sidebar.fetchingBranches"));
  assert.match(busy, /sidebar-project-context-menu-fetch"[^>]*disabled/);
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
