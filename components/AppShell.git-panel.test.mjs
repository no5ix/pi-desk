import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The right panel's Git view: the button in the panel's header row, and the three
// levels it opens — the branch tree, that branch's commits, one commit's diff.
//
// The panel already had a file list, a browser and a diff tab, and the app already had
// a branch list (the composer's chip) and a diff renderer (the file viewer). What it
// did not have was the middle: from the panel a user could not ask what has happened on
// this branch. So the assertions below are mostly about *not* building a second of
// anything the app has, and about the two things that make the view usable on a phone:
// a button a thumb can hit, and levels that fit 390px without a sideways page scroll.

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./GitPanel.tsx", import.meta.url), "utf8");
const fileViewer = readFileSync(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8");
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");

test("the Git button lives in the right panel's header row, beside the file list's toggle", () => {
  const strip = appShell.slice(
    appShell.indexOf("className={`right-panel-tab-strip"),
    appShell.indexOf("<FileTabs"),
  );
  assert.ok(strip.length > 200, "the strip is read from AppShell");
  const button = appShell.slice(
    appShell.indexOf("git-panel-toggle"),
    appShell.indexOf("</svg>", appShell.indexOf("git-panel-toggle")),
  );
  assert.ok(button.length > 200, "the button is in AppShell");
  // A sibling of the file list's toggle: the two view toggles of one panel.
  assert.match(strip, /file-workbench-icon-button file-tree-toggle/, "the file list's toggle is in the strip");
  const toggleIndex = appShell.indexOf("file-workbench-icon-button file-tree-toggle");
  const gitIndex = appShell.indexOf("file-workbench-icon-button git-panel-toggle");
  assert.ok(toggleIndex > -1 && gitIndex > toggleIndex, "the Git button sits with the file list's toggle, after it");
  assert.match(appShell, /className=\{`file-workbench-icon-button git-panel-toggle\$\{gitPanelOpen \? " is-active" : ""\}\`\}/,
    "it carries the strip's own button class and its active state");
  assert.match(appShell, /aria-pressed=\{gitPanelOpen\}/, "pressed says the view is open");
  assert.match(appShell, /aria-controls="git-panel"/, "and points at the view it opens");
  // A named control, in both directions, from the message packs — not a bare icon.
  assert.match(appShell, /translate\(gitPanelOpen \? "gitPanel\.hide" : "gitPanel\.show"\)/,
    "the title and label are the app's translate");
  assert.match(appShell, /aria-label=\{translate\(gitPanelOpen \? "gitPanel\.hide" : "gitPanel\.show"\)\}/,
    "the label is on the button, not only the title");
});

test("a chat's panel has no Git button, and no view", () => {
  // Chat workspaces have no repository (visibleProjectCwd is null), so the button that
  // reads one must not appear there — and the view must not render for that null.
  const guard = appShell.match(/\{visibleProjectCwd && !isChatWorkspaceActive && \(\s*<button[\s\S]{0,400}?git-panel-toggle/);
  assert.ok(guard, "the button is guarded by the project's cwd and the chat workspace flag");
  const view = appShell.slice(appShell.indexOf("{gitPanelOpen && visibleProjectCwd ? ("));
  assert.ok(view.length > 200, "the content area's branch is in AppShell");
  assert.ok(/<GitPanel/.test(view.slice(0, 900)), "the view only renders for a project folder");
});

test("opening the Git view takes the panel's content area, and gives it back", () => {
  // The view is a panel view, not a dialog: the terminals step aside while it is shown
  // and the empty state does not speak under it.
  assert.match(appShell, /hidden=\{tab\.id !== activeFileTabId \|\| gitPanelOpen\}/,
    "a shell is hidden while the Git view is on screen");
  assert.match(appShell, /active=\{rightPanelOpen && tab\.id === activeFileTabId && !gitPanelOpen\}/,
    "and a hidden shell is not told it is active — its xterm must not repaint under the view");
  // The side-chat tab and the panel's empty state are inside the branch the Git view
  // guards, so neither is shown under it — and their own markup is untouched, which is
  // what components/side-chat.test.mjs pins.
  const body = appShell.slice(
    appShell.indexOf("{gitPanelOpen && visibleProjectCwd ? ("),
    appShell.indexOf("{terminalTabs.map((tab) => ("),
  );
  assert.ok(/<GitPanel/.test(body.slice(0, 900)), "the Git view is the branch's first case");
  assert.ok(body.length > 300, "the content area is one guarded branch, read from AppShell");
  assert.match(body, /className="session-chat-panel"/, "the side-chat tab steps aside with it");
  assert.match(body, /className="right-panel-empty"/, "and so does the \"no file open\" line");
  const openFile = appShell.slice(appShell.indexOf("const handleGitPanelOpenFile"), appShell.indexOf("const handleGitPanelOpenFile") + 260);
  assert.match(openFile, /setGitPanelOpen\(false\)/, "opening a file from the view hands the panel to the file");
  assert.match(openFile, /handleOpenFile\(filePath, fileName\)/, "through the app's one open-file path");
  assert.match(appShell, /const GitPanel = dynamic\(\(\) => import\("\.\/GitPanel"\)\.then\(\(m\) => m\.GitPanel\)/,
    "the view is loaded on the first tap, not on the panel's load");
});

test("the branch level is the app's branch list, not a new one", () => {
  for (const name of [
    "fetchProjectBranchMenu",
    "fetchRemoteBranches",
    "filterBranchRows",
    "currentCheckout",
  ]) {
    assert.match(panel, new RegExp(`import \\{[\\s\\S]*\\b${name}\\b[\\s\\S]*\\} from "\\./ProjectContextMenu"`),
      `${name} is imported from the branch menu, not re-implemented`);
  }
  for (const name of ["buildBranchRows", "buildBranchTree", "flattenBranchTree"]) {
    assert.match(panel, new RegExp(`import \\{[\\s\\S]*\\b${name}\\b[\\s\\S]*\\} from "@/lib/branch-tree"`),
      `${name} builds the tree — the sidebar's own tree`);
  }
  // The rows keep the menu's marks and tags, so the same list reads the same way.
  assert.match(panel, /sidebar-project-context-menu-branch-mark/, "the branch marks are the menu's class");
  assert.match(panel, /sidebar-project-context-menu-branch-name/, "the branch names are the menu's class");
  assert.match(panel, /t\("sidebar\.remoteBranchTag"\)/, "a remote-only branch is tagged, as in the menu");
  assert.match(panel, /sidebar-project-context-menu-branch-chevron/, "a group folds with the menu's chevron");
  assert.match(panel, /BranchIcon, ProjectFolderIcon, WorktreeIcon.*from "\.\/GitIcons"/s, "the same three glyphs");
  assert.match(panel, /data\?\.isGit && checkout && !checkout\.branch/, "a detached HEAD is named in words");
});

test("the commit and diff levels read git through the app's routes, never a new layer", () => {
  assert.match(panel, /fetch\(`\/api\/git\/commits\?\$\{query\}`/, "commits come from the app's route");
  assert.match(panel, /fetch\(`\/api\/git\/commit-diff\?\$\{query\}`/, "a commit's patch comes from the app's route");
  assert.match(panel, /from "\.\/FileViewer"/, "the diff is painted by the file viewer's view");
  assert.match(panel, /<DiffView patch=\{patch\} \/>/, "the same renderer, handed the commit's patch");
  assert.match(fileViewer, /export function DiffView\(/, "the file viewer exports its diff view — one renderer");
  assert.match(panel, /import \{ patchForFile \} from "@\/lib\/patch"/, "one file's section is cut by the shared patch parser");
  assert.match(panel, /import \{ joinFilePath \} from "@\/lib\/file-paths"/, "a file path is joined the app's way");
  assert.match(panel, /onOpenFile\(\s*joinFilePath\(diff\.data\?\.repositoryRoot \?\? cwd, file\.path\)/,
    "a file row opens the file at the repository root's path");
});

test("nothing reads git on a timer, and every read is the panel's own", () => {
  // A branch list on a poll is a git process every few seconds, on every open panel.
  assert.doesNotMatch(panel, /setInterval|setTimeout|requestAnimationFrame/, "no timers in the view");
  assert.match(panel, /useEffect\(\(\) => \{\s*setCollapsedGroups\(new Set\(\)\);\s*setBranchFilter\(""\);\s*void loadBranches\(\);/,
    "the first level reads when the view is shown");
  assert.match(panel, /const branchRequest = useRef\(0\)/, "a stale answer for another project is dropped");
  assert.match(panel, /if \(request !== commitRequest\.current\) return;/, "so are the commits' and the diff's");
  assert.match(panel, /onClick=\{\(\) => void fetchBranches\(\)\}/, "reading the remote is a button, not a timer");
});

test("loading, empty and error are named, in words", () => {
  for (const key of [
    "gitPanel.branchesLoading",
    "gitPanel.notGit",
    "gitPanel.noBranches",
    "gitPanel.detached",
    "gitPanel.commitsLoading",
    "gitPanel.commitsError",
    "gitPanel.noCommits",
    "gitPanel.loadingDiff",
    "gitPanel.diffError",
    "gitPanel.diffTooLarge",
    "gitPanel.noChanges",
  ]) {
    assert.ok(panel.includes(`"${key}"`), `${key} is the view's own words for a state`);
  }
  assert.match(panel, /role="status"/, "a state that finished is announced");
  assert.match(panel, /role="alert"/, "a read that failed is announced");
  assert.match(panel, /gitPanel\.commitsError", \{ message: commits\.error \}/, "and names what git said");
});

test("the view's CSS is the app's, in the fork stylesheet, with no invented sizes", () => {
  const sectionStart = css.indexOf("/* ═════ The right panel's Git view");
  const sectionEnd = css.indexOf(".git-panel-spin {\n    animation: none;", sectionStart);
  const section = css.slice(sectionStart, sectionEnd);
  assert.ok(section.length > 1500, "the Git view has its own commented section at the end of native-theme.css");
  assert.match(section, /\.right-panel-tab-strip > \.git-panel-toggle \{\s*order: -1;/,
    "the two view toggles stand together at the strip's leading edge");
  assert.match(section, /@media \(pointer: coarse\) \{[\s\S]*?\.git-panel-action,[\s\S]*?width: 36px;/,
    "a finger gets a 36px plate for the view's icon buttons");
  const body = section.replace(/\/\*[\s\S]*?\*\//g, "");
  // The app's rule for fork CSS: tokens, not literals.
  assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b/, "no hex colour in the section");
  assert.doesNotMatch(body, /rgba?\(/, "no raw rgb()");
  assert.doesNotMatch(body, /font-size: \d+px/, "no pixel font size — the app has --fs-* tokens");
  assert.match(body, /font-size: var\(--fs-small\)/, "fonts are tokens");
  assert.match(body, /\.git-panel-list,\s*\.git-panel-file-list \{[\s\S]*?overflow-y: auto;[\s\S]*?overflow-x: hidden;/,
    "a long list scrolls inside the view, never sideways on the page");
  assert.match(body, /\.git-panel-diff \{[\s\S]*?overflow: auto;/, "a long diff line scrolls inside the diff box");
});

test("the copy is in all three locale packs, with the same placeholders", () => {
  const locales = readFileSync(new URL("../lib/i18n/locale-plugins.ts", import.meta.url), "utf8");
  const keys = [...panel.matchAll(/t\("(gitPanel\.[A-Za-z]+)"/g)].map((m) => m[1]);
  keys.push("gitPanel.show", "gitPanel.hide");
  const unique = [...new Set(keys)];
  assert.ok(unique.length >= 24, `the view's copy is keyed (${unique.length} keys)`);
  for (const key of unique) {
    const quoted = `"${key}"`;
    const count = locales.split(quoted).length - 1;
    assert.equal(count, 3, `${key} is in English, Simplified Chinese and Traditional Chinese`);
  }
  // The placeholder sets have to match across the packs; lib/i18n/usage.test.mjs checks
  // the call sites, this checks the packs agree with each other.
  for (const key of unique) {
    const shapes = [...locales.matchAll(new RegExp(`"${key}": "([^"]*)"`, "g"))].map((m) =>
      [...m[1].matchAll(/\{(\w+)\}/g)].map((p) => p[1]).sort().join(","),
    );
    assert.equal(shapes.length, 3, `${key} has three entries`);
    assert.equal(new Set(shapes).size, 1, `${key} takes the same placeholders in every locale (${shapes.join(" | ")})`);
  }
});

test("the panel's pinned row structure is untouched", () => {
  // components/AppShell.right-panel-row.test.mjs owns that row; the Git button is a
  // sibling in the strip, which is what that test allows.
  assert.match(appShell, /className=\{`right-panel-tab-strip/, "the strip is still the strip");
  assert.doesNotMatch(appShell, /className="right-panel-tab-strip git-panel-strip/, "the row was not restructured for it");
});
