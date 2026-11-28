// The second batch of panel reports, from the running app and its screenshots.
// The layout of the Log is measured in the browser (`e2e/git-panel.mjs`); what is
// cheap to pin at the source — a media query, a phone affordance, the words in
// three packs, the shape of a date — is pinned here.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (rel) => readFile(new URL(`../../${rel}`, import.meta.url), "utf8");

const css = await read("app/native-theme.css");
const logPanel = await read("components/git/log/LogPanel.tsx");
const appShell = await read("components/AppShell.tsx");
const chip = await read("components/TopbarProjectChip.tsx");
const tip = await read("components/TopbarTip.tsx");
const gitUi = await read("components/git/git-ui.tsx");
const logQueries = await read("lib/git/log-queries.ts");
const locale = await read("lib/i18n/messages/en.ts");
const localeSource = await read("lib/i18n/messages/zh-CN.ts");
const localeTw = await read("lib/i18n/messages/zh-TW.ts");
const plugins = await read("lib/i18n/locale-plugins.ts");

/** The rules of one `@media (max-width: 640px)` block that mentions `selector`. */
function phoneRule(selector) {
  const blocks = css.split("@media (max-width: 640px) {").slice(1);
  const hits = blocks.filter((block) => block.includes(selector));
  assert.ok(hits.length > 0, `the phone has a rule for ${selector}`);
  return hits.join("\n");
}

await test("1. the phone keeps the panel's expand button, in the corner it has on the desktop", () => {
  // Upstream hides it on a phone (the panel already spans the width). The Git
  // panel is the view that wants the whole screen, and the top-right corner of
  // the mobile panel was empty.
  const block = phoneRule(".file-panel-expand-button");
  assert.match(block, /\.file-panel-expand-button \{\s*\n\s*display: inline-flex;/, "the button is shown on a phone");
  assert.match(block, /\.right-panel-container\.right-panel-open\.right-panel-full-width \{[\s\S]*?top: 0;[\s\S]*?height: var\(--app-viewport-height, 100dvh\);/,
    "expanded is the whole viewport; not expanded leaves the chat's topbar above it");
  // The unexpanded state carries `!important`: the panel's phone block pins the
  // card with `top: 0 !important; height: 100dvh !important`, so the state that
  // leaves the topbar above it has to beat that weight.
  assert.match(block, /\.right-panel-container\.right-panel-open:not\(\.right-panel-full-width\) \{[\s\S]*?top: 52px !important;[\s\S]*?height: auto !important;/,
    "and the two states differ, so the button does something");
});

await test("2. the phone's header names the project and opens the app's projects", () => {
  // The branch is the first thing cut on a phone and the least useful thing there;
  // the project is what a reader taps, and the branch is one tap away in the Git panel.
  assert.match(phoneRule(".app-topbar-branch"), /\.app-topbar-branch \{\s*\n\s*display: none;/, "the branch chip stays on the desktop");

  assert.match(chip, /projects\?: \{ name: string; path: string \}\[\]/, "the chip can be given the project list");
  assert.match(chip, /t\("chat\.projectListTitle"\)/, "the tip is titled, in the app's words");
  assert.match(chip, /className=\{`app-topbar-project-row\$\{project\.path === currentPath \? " is-current" : ""\}\`\}/,
    "the project this session works in is marked");
  assert.match(chip, /onSelectProject\?\.\(project\.path\);\s*\n\s*close\(\);/, "picking a row switches, and closes the tip");
  assert.match(tip, /const close = useCallback\(/, "the shared tip knows how to close, for a tip that became a list");

  assert.match(appShell, /const appProjectList = useMemo\(/, "the shell builds the app's project list — the sidebar's own project roots");
  assert.match(appShell, /const topbarProjects = isMobile && appProjectList\.length \? appProjectList : null;/,
    "the phone's header is the surface that takes it; the desktop has its sidebar");
  assert.match(appShell, /getProjectDisplayName\(root, availableProjectRoots\)/, "with the sidebar's names");
  assert.match(appShell, /onSelectProject=\{topbarProjects \? handleTopbarProjectSelect : undefined\}/, "and it is wired, only when there is a list");
  assert.match(appShell, /handleNewSession\(`project-\$\{Date\.now\(\)\}`, projectRoot, "project"\)/, "picking one opens a session in that project");

  for (const [name, source] of [["en", locale], ["zh-CN", localeSource], ["zh-TW", localeTw]]) {
    assert.match(source, /"chat\.projectListTitle":/, `${name} names the list`);
  }
});

await test("4. the filter chip is on the row that names the view", () => {
  const header = logPanel.slice(logPanel.indexOf('className="git-panel-section-header"'));
  const chips = header.indexOf('className="git-filter-chips"');
  const filterRow = header.indexOf('className="git-filter-row"');
  assert.ok(chips > 0, "the chips are in the header's subtree");
  assert.ok(chips < filterRow, "the chip comes with the title, before the filter fields");
  assert.match(logPanel, /<span className="git-chip-label">\{selectedRef\.name\}<\/span>/, "the name is a label that truncates, the × does not");
  assert.match(css, /\.git-panel-section-header \.git-filter-chips \{\s*\n\s*padding: 0;/, "the row is not padded a second time");
});

await test("5. the row states the date and the time, not “14h”", () => {
  assert.match(gitUi, /export function formatLogDate\(iso: string\): string/, "the panel has its own formatter");
  // Zero padded, so the column sorts as it reads, and empty for a value that is
  // not a time. The rendered form is asserted in the browser (`e2e/git-panel.mjs`).
  assert.match(gitUi, /`\$\{date\.getFullYear\(\)\}-\$\{pad\(date\.getMonth\(\) \+ 1\)\}-\$\{pad\(date\.getDate\(\)\)\} \$\{pad\(date\.getHours\(\)\)\}:\$\{pad\(date\.getMinutes\(\)\)\}`/,
    "YYYY-MM-DD HH:MM, built from local time");
  assert.match(logPanel, /\{formatLogDate\(commit\.authorDate\)\}/, "the row's date column uses it");
  assert.match(logPanel, /<span className="git-log-date" title=\{formatFullTime\(commit\.authorDate\)\}>/, "with the full time as its title");
});

await test("6. the search box says what it searches, and the server reads a hash", async () => {
  assert.match(plugins, /"git\.filterSearch": "Search the message or the hash"/, "the field names both halves");
  assert.match(logPanel, /placeholder=\{t\("git\.filterSearch"\)\}/, "and the field shows it");
  const server = await read("lib/git/git-service.ts");
  assert.match(server, /hashQuery \? Math\.min\(pageMax \* 4, 2000\) : pageMax/, "a hash search reads a wider page, then cuts it back");
});

await test("7. a branch row's name reaches git, with a slash in it or without one", () => {
  // The panel sends the branch the way git takes it; the service resolves the
  // namespaces in git's own order, so `bak/4pi-desk-main` is a branch and not a
  // remote-tracking ref.
  assert.match(logPanel, /base\.branch = selectedRef\.name;/, "the panel sends the name git is asked for");
  assert.match(logQueries, /refIdentityFromFullRef\(params\.branch\)[\s\S]{0,40}probePlainBranch\(gitService, params\.branch\)/,
    "a plain name is probed, not refused");
  assert.match(logQueries, /\[\["local", "refs\/heads\/"\], \["remote", "refs\/remotes\/"\]\]/, "in git's order of preference");
  assert.match(logQueries, /if \(!isPlainRefName\(name\)\) return null;/, "and a name that is not a ref name is refused");
});

await test("8. the filter row keeps its own band of space", () => {
  assert.match(css, /\.git-filter-row \{[\s\S]*?padding: 7px 8px 6px;/, "the row has padding above its fields");
  assert.match(css, /\.git-log-panel \.git-filter-row \{\s*\n\s*border-top: 1px solid var\(--separator, var\(--border\)\);/,
    "and a rule, so it does not merge into the row above");
});
