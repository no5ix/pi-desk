// The ten reported fixes, asserted where they are cheap to assert: the source of
// the panel, the strings in the three locale packs, and the sheet's tokens. The
// layout of the commit detail is measured in the browser (`e2e/git-panel.mjs`).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (rel) => readFile(new URL(`../../${rel}`, import.meta.url), "utf8");

const logPanel = await read("components/git/log/LogPanel.tsx");
const detail = await read("components/git/log/CommitDetail.tsx");
const sidebar = await read("components/git/branch/BranchSidebar.tsx");
const commitPanel = await read("components/git/commit/CommitPanel.tsx");
const gitPanel = await read("components/GitPanel.tsx");
const gitApi = await read("components/git/git-api.ts");
const route = await read("app/api/git/repos/route.ts");
const workspace = await read("lib/git/workspace.ts");
const css = await read("app/native-theme.css");
const localeSource = await read("lib/i18n/locale-plugins.ts");
/** The value of a message key in one locale pack, read from the source. */
function message(key, locale) {
  const packStart = localeSource.indexOf(`"${locale}": {`);
  assert.ok(packStart >= 0, `the ${locale} pack`);
  const rest = localeSource.slice(packStart);
  const match = rest.match(new RegExp(String.raw`"${key}": "([^"]*)"`, "s"));
  assert.ok(match, `${key} in ${locale}`);
  return match[1];
}
const messages = { git: { tabShelf: message("git.tabShelf", "en"), repoProjects: message("git.repoProjects", "en") } };

await test("1. a long commit message scrolls in its own box", () => {
  // The message is a column of its own, `min-height: 0` in the grid and
  // `overflow-y: auto`, so it cannot run out under the window's status bar.
  assert.match(css, /\.git-commit-detail \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);[\s\S]*?min-height: 0;/);
  assert.match(css, /\.git-commit-detail-message \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/);
  assert.match(detail, /className="git-commit-detail-message"/);
});

await test("2. the detail does not say “Pick a file to read its diff”", () => {
  assert.ok(!detail.includes("git.detailFileEmpty"), "the phrase is not used by the panel");
});

await test("3. the commit message and its FILES are columns, with a divider", () => {
  assert.match(detail, /className="git-commit-detail-message"[\s\S]*className="git-commit-files"/, "the two are siblings of the grid");
  assert.match(css, /\.git-commit-files \{[\s\S]*?border-left: 1px solid var\(--separator, var\(--border\)\);/, "the divider is the app's separator token");
});

await test("4. the tab is Stash, in all three languages", () => {
  assert.deepEqual(
    ["en", "zh-CN", "zh-TW"].map((locale) => message("git.tabShelf", locale)),
    ["Stash", "贮藏", "貯藏"],
    "the tab reads Stash / 贮藏 / 貯藏",
  );
  assert.deepEqual(
    ["en", "zh-CN", "zh-TW"].map((locale) => message("git.shelfEmpty", locale)),
    ["The stash is empty.", "贮藏是空的。", "貯藏是空的。"],
    "and the shelf's own words follow the tab",
  );
  assert.match(commitPanel, /\{ id: "shelf", label: t\("git\.tabShelf"\) \}/, "the tab is labelled from i18n");
});

await test("6. a row's right click belongs to the browser", () => {
  // No `preventDefault` in a row's context menu: the browser's menu (Back,
  // Reload, Inspect…) is the user's, and the row's ⋮ is the git menu.
  for (const [file, source] of [["LogPanel.tsx", logPanel], ["BranchSidebar.tsx", sidebar]]) {
    const handlers = source.match(/onContextMenu=\{[\s\S]*?\}\}/g) ?? [];
    assert.ok(handlers.length > 0, `${file} answers right click`);
    for (const handler of handlers) {
      assert.ok(!handler.includes("preventDefault"), `${file}: a row's right click does not take the browser's menu away`);
    }
  }
  assert.match(sidebar, /onOpen=\{\(anchor\) => onMenu\(anchor\)\}/, "the branch row's ⋮ still opens the git menu");
  assert.match(logPanel, /GitRowMenuButton/, "the commit row's ⋮ still opens the git menu");
});

await test("7 and 8. a branch is the log's filter, and × is the way back", () => {
  assert.match(logPanel, /if \(selectedRef\.type === "local" \|\| selectedRef\.type === "remote"\) base\.branch = selectedRef\.name;/,
    "the log is asked for that ref's commits, local or remote");
  assert.match(logPanel, /onClearRef\?\.\(\);/, "the chip's × hands the ref filter back to the panel");
  assert.equal((gitPanel.match(/onClearRef=\{\(\) => setSelectedRef\(null\)\}/g) ?? []).length, 2, "both LogPanel mounts get the way back");
});

await test("9. the search box answers Enter, and sends the word to git", async () => {
  assert.match(logPanel, /if \(event\.key === "Enter"\) \{[\s\S]*?const value = event\.currentTarget\.value\.trim\(\);[\s\S]*?search: value \}/,
    "Enter applies the trimmed word");
  // React runs a state updater when it renders, and the event's target is null by
  // then. An updater that reads `event.target.value` crashed the whole panel.
  const updaters = logPanel.match(/setFilters\(\(current\) =>[\s\S]*?\}\)\)/g) ?? [];
  assert.ok(updaters.length >= 4, `the filter fields update state (${updaters.length})`);
  for (const updater of updaters) {
    assert.ok(!/event\.(target|currentTarget)\./.test(updater), `no updater touches the event (${updater.slice(0, 60)})`);
  }
  assert.match(logPanel, /if \(filters\.search\.trim\(\)\) base\.search = filters\.search\.trim\(\);/, "the word goes into the log query");
  const server = await read("lib/git/git-service.ts");
  assert.match(server, /args\.push\("-i",\s*`--grep=\$\{options\.search\}`\)/, "git filters on the message (--grep), case-insensitively");
  // A word of hex digits is a hash the reader just read in the row, and git's
  // --grep says nothing about hashes: the rows are picked here.
  assert.match(server, /const hashQuery = \/\^\[0-9a-f\]\{3,40\}\$\/i\.test\(searchWord\)/,
    "a hex word of three or more digits is read as a hash query: a hand stops typing when the list narrows to one");
  assert.match(server, /commit\.hash\.startsWith\(word\) \|\| commit\.shortHash\.startsWith\(word\)/,
    "and it matches the hash, not the prose: 8ab2 must not turn into a full-text search");
  assert.match(server, /this\.resolveHashPrefix\(word\)/,
    "a prefix deeper than the page is resolved by git, so the row is found wherever it lies");
  assert.match(server, /--disambiguate=\$\{prefix\}/, "by git's own prefix lookup");
  assert.match(server, /commit\.hash\.startsWith\(word\)/, "and the hash itself matches the word");
});

await test("10. the switcher lists the app's projects, not just this folder's checkouts", async () => {
  assert.match(workspace, /export async function listProjectRepos\(/, "the app's project list is read as git repositories");
  assert.match(workspace, /listSessionsIncremental\(\{ deferDetails: true \}\)/, "from the sessions' folders — the sidebar's own list");
  assert.match(workspace, /if \(!\(await isCwdAllowed\(root\)\)\) return null;/, "and only inside the app's authorized roots");
  assert.match(route, /url\.searchParams\.get\("projects"\) === "1" \? await listProjectRepos\(\) : \[\]/, "the route answers ?projects=1");
  assert.match(gitApi, /projects = true/, "the client asks for them");
  assert.match(gitPanel, /\{t\("git\.repoProjects"\)\}/, "the switcher has the Projects section");
  assert.equal(messages.git.repoProjects, "Projects");
  assert.deepEqual(["en", "zh-CN", "zh-TW"].map((locale) => message("git.repoProjects", locale)), ["Projects", "项目", "專案"]);
});
