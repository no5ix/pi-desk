import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The right panel's Git view: Branchshift's workflow, ported.
//
// The panel began as three levels built on the app's branch menu. Branchshift
// brings the rest of the workflow — the commit graph, the staging workflow, the
// shelf, conflicts, blame — and the temptation that comes with a port is to
// carry its whole private world along: its own bridge, its own colours, its own
// branch list, its own diff renderer, its own polling. So the assertions below
// are mostly about what the port may *not* duplicate: the app's tree model, the
// app's diff renderer, the app's menu surface, the app's tokens, the app's
// one-way-to-read-git. The last of them is the old view's rule, kept: nothing
// reads git on a timer.

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const appShell = read("./AppShell.tsx");
const panel = read("./GitPanel.tsx");
const fileViewer = read("./FileViewer.tsx");
const branch = read("./git/branch/BranchSidebar.tsx");
const log = read("./git/log/LogPanel.tsx");
const detail = read("./git/log/CommitDetail.tsx");
const commit = read("./git/commit/CommitPanel.tsx");
const dialogs = read("./git/dialogs/GitDialogs.tsx");
const ui = read("./git/git-ui.tsx");
const api = read("./git/git-api.ts");
const css = read("../app/native-theme.css");
const cssSectionStart = css.indexOf("/* ═════════════════════════════════════════════════════════════════════\n   The Git panel — Branchshift");
const cssSection = css.slice(cssSectionStart);
const cssRules = cssSection.replace(/\/\*[\s\S]*?\*\//g, "");

test("the Git button lives in the right panel's header row, beside the file list's toggle", () => {
  const strip = appShell.slice(
    appShell.indexOf("className={`right-panel-tab-strip"),
    appShell.indexOf("<FileTabs"),
  );
  assert.ok(strip.length > 200, "the strip is read from AppShell");
  const toggleIndex = appShell.indexOf("file-workbench-icon-button file-tree-toggle");
  const gitIndex = appShell.indexOf("file-workbench-icon-button git-panel-toggle");
  assert.ok(toggleIndex > -1 && gitIndex > toggleIndex, "the Git button sits with the file list's toggle, after it");
  assert.match(appShell, /aria-pressed=\{gitPanelOpen\}/, "pressed says the view is open");
  assert.match(appShell, /aria-controls="git-panel"/, "and points at the view it opens");
  assert.match(appShell, /translate\(gitPanelOpen \? "gitPanel\.hide" : "gitPanel\.show"\)/,
    "the title and label are the app's translate");
  assert.match(appShell, /aria-label=\{changesCount > 0[\s\S]{0,220}?gitPanel\.show"\)\}/,
    "the label is on the button, not only the title, and names the count when there is one");
  // The count the panel is about, on the button that opens it.
  assert.match(appShell, /<span className="git-panel-toggle-badge" aria-hidden="true" data-count=\{changesCount\}>/,
    "the button carries the number of files the working tree changed");
  assert.match(appShell, /translate\("sidebar\.changedFiles", \{ count: changesCount \}\)/,
    "the count is spoken in the app's words, beside the show/hide label");
});

test("a chat's panel has no Git button, and no view", () => {
  const guard = appShell.match(/\{visibleProjectCwd && !isChatWorkspaceActive && \(\s*<button[\s\S]{0,400}?git-panel-toggle/);
  assert.ok(guard, "the button is guarded by the project's cwd and the chat workspace flag");
  const view = appShell.slice(appShell.indexOf("{visibleProjectCwd && rightPanelOpen ? ("));
  assert.ok(view.length > 200, "the content area's branch is in AppShell");
  assert.ok(/<GitPanel/.test(view.slice(0, 900)), "the view only renders for a project folder");
});

test("opening the Git view takes the panel's content area, and gives it back", () => {
  assert.match(appShell, /hidden=\{tab\.id !== activeFileTabId \|\| gitPanelOpen\}/,
    "a shell is hidden while the Git view is on screen");
  assert.match(appShell, /active=\{rightPanelOpen && tab\.id === activeFileTabId && !gitPanelOpen\}/,
    "and a hidden shell is not told it is active — its xterm must not repaint under the view");
  const body = appShell.slice(
    appShell.indexOf("{visibleProjectCwd && rightPanelOpen ? ("),
    appShell.indexOf("{terminalTabs.map((tab) => ("),
  );
  assert.ok(/<GitPanel/.test(body.slice(0, 900)), "the Git view is the branch's first case");
  // The view is not unmounted by its own toggle: closing the Git view inside an
  // open sidebar hides it, so reopening is a look at the same read of the
  // repository. Closing the sidebar is the boundary that starts a fresh read.
  assert.match(body, /className="git-panel-keepalive" hidden=\{!gitPanelOpen\}/,
    "the view is hidden, not unmounted, while its toggle is off");
  assert.match(appShell, /\{gitPanelOpen \? null : \(/, "the file, side-chat and empty content step aside while it is on");
  assert.match(body, /className="session-chat-panel"/, "the side-chat tab steps aside with it");
  assert.match(body, /className="right-panel-empty"/, "and so does the \"no file open\" line");
  const openFile = appShell.slice(appShell.indexOf("const handleGitPanelOpenFile"), appShell.indexOf("const handleGitPanelOpenFile") + 260);
  assert.match(openFile, /setGitPanelOpen\(false\)/, "opening a file from the view hands the panel to the file");
  assert.match(openFile, /handleOpenFile\(filePath, fileName\)/, "through the app's one open-file path");
  assert.match(appShell, /const GitPanel = dynamic\(\(\) => import\("\.\/GitPanel"\)\.then\(\(m\) => m\.GitPanel\)/,
    "the view is loaded on the first tap, not on the panel's load");
});

test("the branch tree is the app's own tree model, not Branchshift's copy of it", () => {
  for (const name of ["buildBranchTree", "flattenBranchTree"]) {
    assert.match(branch, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from "@/lib/branch-tree"`),
      `${name} builds the tree — the sidebar's own tree, folders from a / name`);
  }
  assert.match(branch, /import \{ filterBranchRows \} from "\.\.\/\.\.\/ProjectContextMenu"/,
    "the search box is the branch menu's own filter");
  assert.match(branch, /sidebar-project-context-menu-branch-name/, "a branch name is the menu's class");
  assert.match(branch, /sidebar-project-context-menu-branch-mark/, "and its mark is the menu's glyph slot");
  assert.match(branch, /sidebar-project-context-menu-branch-chevron/, "a folder folds with the menu's chevron");
  assert.match(branch, /t\("sidebar\.remoteBranchTag"\)/, "a remote-only branch is tagged, as in the menu");
  assert.match(branch, /BranchIcon, WorktreeIcon.*from "\.\.\/\.\.\/GitIcons"/s, "the same glyphs as the rest of the app");
  // Branchshift's own contributions: the favourite star, the ahead/behind pair,
  // and the worktree that already holds a branch.
  assert.match(branch, /"git\.favorite"/, "the star is Branchshift's dashboard favourite");
  assert.match(branch, /setFavorite/, "and it is written through the command table");
  assert.match(branch, /git-branch-track/, "ahead and behind are shown on the row");
  assert.match(branch, /checkedOutWorktreePath/, "a branch checked out in another worktree says so");
  assert.match(branch, /onOpenWorktree/, "and its row can open that worktree");
});

test("one diff renderer, one patch parser, and git read through the panel's one door", () => {
  assert.match(detail, /from "\.\.\/\.\.\/FileViewer"/, "the diff is painted by the file viewer's view");
  assert.match(detail, /<DiffView patch=\{patch\} \/>/, "the same renderer, handed the commit's patch");
  assert.match(fileViewer, /export function DiffView\(/, "the file viewer exports its diff view — one renderer");
  assert.match(detail, /import \{ patchForFile \} from "@\/lib\/patch"/, "one file's section is cut by the shared patch parser");
  assert.match(detail, /fetch\(`\/api\/git\/commit-diff\?\$\{query\}`/, "a commit's patch comes from the app's route");
  // Every git read and write in the panel is a command name on one envelope.
  assert.match(api, /fetch\("\/api\/git\/execute"/, "the bridge replacement is one POST");
  for (const source of [panel, branch, log, detail, commit]) {
    assert.doesNotMatch(source, /fetch\("\/api\/git\/execute|new WebSocket|child_process/,
      "a view never talks to the transport around the hook");
  }
  assert.match(log, /gitCommand<GraphPage>\(target, "getGraphData"/, "the graph page is a named command");
  assert.match(log, /gitCommand<GraphPage>\(target, "loadMoreLog"/, "and its continuation is another");
  assert.match(commit, /"commitChanges"/, "the commit is a command, with the selections as data");
  assert.match(commit, /"shelveChanges"|"unshelveChanges"/, "the shelf is commands, not a shell");
  assert.match(branch, /"checkoutBranch"|"mergeBranch"|"rebaseBranch"/, "so are the branch operations");
});

test("the graph is Branchshift's geometry, windowed, and paged from a snapshot", () => {
  assert.match(log, /const ROW_HEIGHT = 28;/, "the row pitch is the reference's");
  assert.match(log, /const COLUMN_WIDTH = 10;/, "the lane pitch is the reference's");
  assert.match(log, /const LANE_COLORS = \[[\s\S]*?\];/, "the eight lane colours come with it");
  assert.match(log, /const laneColor = \(index: number\) => LANE_COLORS\[index % LANE_COLORS\.length\]/,
    "a lane keeps its colour by index, as Branchshift assigns it");
  assert.match(log, /function linePath\([\s\S]*?M \$\{fromX\} \$\{fromY\}[\s\S]*?diagonal/,
    "a lane line is vertical, one row of diagonal, vertical");
  assert.match(log, /function resolveVisibleTarget/, "a filtered-out parent is walked through, not dropped");
  assert.match(log, /useVirtualizer/, "the commit list is windowed");
  assert.match(log, /visibleLines = geometry\.lines\.filter/, "so is the SVG layer, which is the point of the pitch");
  assert.match(log, /snapshot/, "a page continues from the layout snapshot");
  assert.match(log, /status === "ref-unavailable"/, "a branch that vanished mid-filter keeps its own message");
  assert.match(log, /page\.status === "ok"[\s\S]*setCommits\(\(current\)/, "the next page appends, without losing the first");
});

test("nothing reads git on a timer, and the live refresh is the stream's", () => {
  for (const [name, source] of [
    ["GitPanel.tsx", panel],
    ["GitDialogs.tsx", dialogs],
    ["BranchSidebar.tsx", branch],
    ["LogPanel.tsx", log],
    ["CommitDetail.tsx", detail],
    ["CommitPanel.tsx", commit],
  ]) {
    assert.doesNotMatch(source, /setInterval|setTimeout|requestAnimationFrame/, `${name} runs no timer`);
  }
  assert.match(api, /new EventSource\(`\/api\/git\/events/, "the watcher arrives as the server's own stream");
  assert.match(api, /timer = setTimeout\(flush, batchMs\)/,
    "the burst batching lives in the transport, where the watcher's dozen events arrive");
  assert.match(api, /clearTimeout\(timer\)/, "and the timer is released with the stream");
  assert.match(log, /requestRef/, "a stale answer for another filter is dropped");
  assert.match(api, /if \(request !== requestRef\.current\) return;/, "in the shared read hook, once, not per call site");
});

test("loading, empty and error are named, in words, in all three packs", () => {
  const sources = [panel, branch, log, detail, commit, dialogs];
  const keys = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/t\("(git\.[A-Za-z]+)"/g)) keys.add(match[1]);
  }
  assert.ok(keys.size >= 120, `the panel's copy is keyed (${keys.size} keys)`);
  const locales = read("../lib/i18n/locale-plugins.ts");
  for (const key of keys) {
    const quoted = `"${key}"`;
    const count = locales.split(quoted).length - 1;
    assert.equal(count, 3, `${key} is in English, Simplified Chinese and Traditional Chinese`);
    const shapes = [...locales.matchAll(new RegExp(`"${key}": "([^"]*)"`, "g"))].map((m) =>
      [...m[1].matchAll(/\{(\w+)\}/g)].map((p) => p[1]).sort().join(","),
    );
    assert.equal(new Set(shapes).size, 1, `${key} takes the same placeholders in every locale (${shapes.join(" | ")})`);
  }
  assert.match(ui, /role=\{kind === "error" \? "alert" : "status"\}/, "a state that finished is announced");
  assert.match(ui, /role="alert"/, "and a read that failed is announced");
  for (const key of ["git.changesEmpty", "git.logEmpty", "git.branchesLoading", "git.refUnavailable", "git.conflictEmpty"]) {
    assert.ok(sources.some((source) => source.includes(`"${key}"`)), `${key} is the panel's own words for a state`);
  }
});

test("the panel's CSS is the app's, in the fork stylesheet, with no invented palette", () => {
  assert.ok(cssSectionStart > 1500, "the panel has its own commented section at the end of native-theme.css");
  assert.ok(cssSection.length > 4000, "and it carries the panel, not a stub");
  assert.doesNotMatch(cssRules, /#[0-9a-fA-F]{3,8}\b/, "no hex colour in the section");
  assert.doesNotMatch(cssRules, /rgba?\(/, "no raw rgb()");
  assert.doesNotMatch(cssRules, /font-size: \d+px/, "no pixel font size — the app has --fs-* tokens");
  assert.match(cssRules, /font-size: var\(--fs-small\)/, "fonts are tokens");
  assert.match(cssRules, /\.git-tree-scroll,[\s\S]*?\.git-panel-file-list \{[\s\S]*?overflow-y: auto;[\s\S]*?overflow-x: hidden;/,
    "a long list scrolls inside the view, never sideways on the page");
  assert.match(cssRules, /\.git-commit-diff,[\s\S]*?\.git-panel-diff \{[\s\S]*?overflow: auto;/,
    "a long diff line scrolls inside the diff box");
  assert.match(cssRules, /@media \(pointer: coarse\) \{[\s\S]*?\.git-icon-button,[\s\S]*?width: 36px;/,
    "a finger gets a 36px plate for the panel's icon buttons");
  assert.match(cssRules, /--git-graph-node-hole: var\(--bg-panel\)/,
    "even the graph's node hole is a token, so a theme change repaints it");
});

test("the panel's menus are the application's menu surface, and they behave", () => {
  assert.match(ui, /className="native-popover app-menu git-menu"/, "the context menu is the app's menu");
  assert.match(ui, /role="menu"/, "with the menu roles a screen reader expects");
  assert.match(ui, /role=\{item\.checked === undefined \? "menuitem" : "menuitemcheckbox"\}/,
    "a toggle row is a checkbox row");
  assert.match(ui, /scrollMovesAnchor\(event\.target, menu\.anchor\)/,
    "a window-wide scroll listener asks whether that scroll moves this menu's control");
  assert.match(ui, /function GitDialog\(\{[\s\S]*role="dialog"[\s\S]*aria-modal="true"/,
    "the dialogs are the app's modal surface");
  // Branchshift asked the extension host for these; the client does them.
  assert.match(branch, /navigator\.clipboard\?\.writeText/, "copy is the browser's clipboard");
  assert.match(detail, /navigator\.clipboard\?\.writeText/, "in the detail rows too");
  assert.match(commit, /"git\.importPatch"/, "and a clipboard patch is imported as data, not pasted into a shell");
});

test("the columns split, and stack when the panel is too narrow for them", () => {
  assert.match(panel, /NARROW_BREAKPOINT/, "the width the split gives way at is named");
  assert.match(panel, /clientWidth < NARROW_BREAKPOINT/, "measured on the panel's own box, not the window");
  assert.match(panel, /ResizeObserver/, "and re-measured when the panel is dragged");
  assert.match(panel, /gridTemplateColumns: `\$\{split\}px 6px minmax\(0, 1fr\)`/,
    "the split is a grid column, so the log side cannot be squeezed to nothing");
  assert.match(panel, /panel-resize-handle git-split-resizer/, "the divider is the app's resizable handle");
  assert.match(panel, /role="separator"[\s\S]*aria-orientation="vertical"/, "announced as a separator");
  assert.match(panel, /ArrowLeft[\s\S]*clampSplit/, "a keyboard moves it, and the clamp keeps it sane");
  assert.match(panel, /localStorage/, "the width survives a reload");
  assert.match(panel, /git-narrow/, "narrow: the branch tree and the log take turns, in the panel's own tab row");
});

test("the panel names its repository, and switches between the ones the folder can reach", () => {
  assert.match(panel, /fetchGitRepos/, "the list is the repos route, not a client-side guess");
  assert.match(panel, /aria-haspopup="menu"/, "the switcher is a menu");
  assert.match(panel, /role="menuitemradio"/, "with one selected repository");
  assert.match(panel, /git-repo-row-tag/, "a worktree is marked as one");
  assert.match(panel, /isGitRepository|t\("git\.repoNone"\)/, "and a folder that is not one says so");
  assert.match(api, /\/api\/git\/repos\?\$\{query\}/, "the route is the panel's only way to the list");
  assert.match(api, /cwd=\$\{encodeURIComponent\(cwd\)\}/, "the folder is named in the query");
  assert.match(api, /&projects=1/, "and the app's projects are asked for with it");
});
