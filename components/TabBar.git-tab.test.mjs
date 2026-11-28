import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/**
 * The Git view is a tab of the right panel's bar.
 *
 * The panel had two ways to show a viewer (the tab bar) and one that was not a
 * tab (the strip's Git glyph, which hid the tabs' content). A view that is not a
 * tab cannot be picked from the bar, so it was not part of the panel's mutual
 * exclusion: the bar kept showing a file as selected while the Git view covered
 * it, and the count that decides opening the view hung off a glyph in a strip of
 * icons. The assertions below pin the tab: it is pinned to the repository, it
 * carries the changed-file count, selecting it is the panel's own exclusion, and
 * switching tabs never unmounts the view — a look away is not a reason to read
 * the repository again.
 */

test("the Git tab is a tab of the bar, with the glyph and the count it is about", async () => {
  const bar = await read("./TabBar.tsx");
  assert.match(bar, /kind\?: "terminal" \| "artifact" \| "side" \| "git"/,
    "the bar knows the Git view as a tab kind");
  assert.match(bar, /badge\?: number \| null;/,
    "a tab can carry a count beside its label");
  assert.match(bar, /tab\.kind === "git" \? \(\s*<svg[\s\S]{0,200}<line x1="6" y1="4" x2="6" y2="15" \/>/,
    "the Git tab wears the branch glyph, the same one the strip's toggle uses");
  assert.match(bar, /className="file-tab-badge"\s*aria-hidden="true"\s*data-count=\{tab\.badge\}/,
    "the count is drawn, and the label already speaks it (the badge is decorative)");
  assert.match(bar, /aria-controls=\{tab\.kind === "git" \? "git-panel" : undefined\}/,
    "the tab points at the view it shows");
  assert.match(bar, /t\("gitPanel\.tabLabel"\)/,
    "the tab is named in words, not by the glyph alone");
  assert.match(bar, /tab\.kind === "git" \? "gitPanel\.hide" : "i18n\.close"/,
    "closing the tab says what it does: it hides the view");
});

test("the Git tab is a tab of the repository, not a file the user can lose", async () => {
  const shell = await read("./AppShell.tsx");
  assert.match(shell, /const GIT_PANEL_TAB_ID = "git:panel";/,
    "one id for the view's tab, so no code path treats it as a file tab");
  assert.match(shell, /visibleProjectCwd && !isChatWorkspaceActive\s*\?\s*\{\s*id: GIT_PANEL_TAB_ID,/,
    "a project's bar has the tab; a chat's has no repository and never gets it");
  assert.match(shell, /badge: changesCount,/,
    "the tab carries the working tree's changed-file count");
  assert.match(shell, /\.\.\.\(gitPanelTab \? \[gitPanelTab\] : \[\]\)\], panelTabOrder\)/,
    "the tab goes through the same order the user dragged, appended like any new tab");
});

test("picking a tab is the panel's mutual exclusion, in both directions", async () => {
  const shell = await read("./AppShell.tsx");
  assert.match(shell, /activeTabId=\{gitPanelOpen \? GIT_PANEL_TAB_ID : activeFileTabId \?\? ""\}/,
    "while the view is shown the bar says so; the file tabs do not pretend to be active");
  assert.match(shell, /onSelectTab=\{handleSelectPanelTab\}/);
  assert.match(shell, /onCloseTab=\{handleClosePanelTab\}/);
  const select = shell.match(/const handleSelectPanelTab = useCallback\(\(tabId: string\) => \{[\s\S]*?\}, \[isMobile\]\);/);
  assert.ok(select, "the panel's tab picker is one named handler");
  assert.match(select[0], /if \(tabId === GIT_PANEL_TAB_ID\) \{[\s\S]*setGitPanelOpen\(true\);[\s\S]*return;/,
    "picking the Git tab opens the view (and the panel that hosts it)");
  assert.match(select[0], /setGitPanelOpen\(false\);\s*setActiveFileTabId\(tabId\);/,
    "picking any other tab hands the content area back — the exclusion is not one-way");
  const close = shell.match(/const handleClosePanelTab = useCallback\(\(tabId: string\) => \{[\s\S]*?\}, \[handleCloseFileTab\]\);/);
  assert.ok(close, "the panel's tab closer is one named handler");
  assert.match(close[0], /if \(tabId === GIT_PANEL_TAB_ID\) \{\s*setGitPanelOpen\(false\);\s*return;/,
    "closing the Git tab hides the view; it does not remove a tab the repository owns");
  assert.match(close[0], /handleCloseFileTab\(tabId\);/,
    "every other tab closes the way it always did");
});

test("switching to the Git tab and back does not read the repository again", async () => {
  const shell = await read("./AppShell.tsx");
  assert.match(shell, /className="git-panel-keepalive" hidden=\{!gitPanelOpen\}/,
    "the view is hidden, not unmounted, while another tab is shown");
  assert.match(shell, /<GitPanel\s*key=\{visibleProjectCwd\}/,
    "it is remounted only when the repository changes");
});

test("the tab's badge is the app's ink, in the fork stylesheet", async () => {
  const css = await read("../app/native-theme.css");
  const rule = css.match(/\.file-tab-badge \{[\s\S]*?\}/);
  assert.ok(rule, "the tab badge is a class, not an inline style");
  assert.match(rule[0], /background: var\(--accent\);/);
  assert.match(rule[0], /color: var\(--bg-panel\);/);
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}/, "no invented palette in a component rule");
});

test("the tab is named in every language pack", async () => {
  // The fork's Git panel strings live in lib/i18n/locale-plugins.ts, which
  // carries all three locales; messages/*.ts is upstream's pack and never sees
  // a fork key.
  const packs = await read("../lib/i18n/locale-plugins.ts");
  const locales = packs.match(/"gitPanel\.tabLabel": "[^"]+"/g) ?? [];
  assert.equal(locales.length, 3, "en, zh-CN and zh-TW each name the Git tab");
});
