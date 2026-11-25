import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The branch page, in a real browser.
 *
 * A project can carry forty branches, and the list is a tree of the prefix each
 * branch name already carries: the branch this folder is on, the branches that own
 * a folder of their own, then the rest grouped, each group foldable by its arrow. A
 * filter box sits above it for the project that is too long to scan. Typing narrows
 * the list, Escape closes the menu, the arrow folds and unfolds, and the row's name
 * is the switch. All of that is behaviour only a browser can show.
 *
 * `?short=1` is the control pass: a three-branch project gets no box at all, so the
 * check cannot pass by always having one.
 */
const out = "test-results/branch-menu-filter";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/branch-menu-filter.fixture.jsx"],
  bundle: true,
  platform: "browser",
  outfile: `${out}/fixture.js`,
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    if (url.pathname === "/styles.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The rows of the tree, in the order the panel paints them. A leaf carries the
 *  full branch name (`data-branch`) and shows the part its group has not said; a
 *  group carries its prefix (`data-group`) and the arrow that folds it. */
const STATE = () => ({
  rows: Array.from(document.querySelectorAll(".sidebar-project-context-menu-row--branch .sidebar-project-context-menu-branch-name")).map(
    (el) => ({ label: el.textContent.trim(), branch: el.dataset.branch }),
  ),
  groups: Array.from(document.querySelectorAll(".sidebar-project-context-menu-branch-group")).map((el) => {
    const name = el.querySelector(".sidebar-project-context-menu-branch-name");
    return {
    prefix: name.dataset.group,
    label: name.textContent.trim(),
    expanded: el.getAttribute("aria-expanded"),
    badge: el.querySelector(".sidebar-project-context-menu-branch-tag")?.textContent.trim() ?? null,
    };
  }),
  box: (() => {
    const el = document.querySelector(".sidebar-project-context-menu-filter");
    return el ? { value: el.value, placeholder: el.placeholder, focused: el === document.activeElement } : null;
  })(),
  menuItems: document.querySelectorAll(".sidebar-project-context-menu button[role='menuitem']").length,
  hint: document.querySelector(".sidebar-project-context-menu-hint")?.textContent.trim() ?? null,
  calls: window.__calls,
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
const server = await serve();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector(".sidebar-project-context-menu");

const open = await page.evaluate(STATE);
assert.ok(open.box, "a twelve-branch list opens with the filter box above the tree");
assert.equal(open.box.value, "", "and it starts empty: the tree is the list");
// 9 local + 3 remote = 12 branches. The current one and the one the project's own
// folder holds stand on their own; the rest of the leaves hang in prefix groups,
// and every group is a row of its own.
assert.equal(open.rows.length, 12, "every branch is a row");
assert.deepEqual(
  open.groups.map((group) => `${group.prefix}:${group.expanded}`),
  ["bak:true", "claude:true", "fix:true", "origin:true", "origin/claude:true", "release:true"],
  "the prefixes are groups, remotes included, and a list this long opens unfolded",
);
assert.equal(open.menuItems, open.rows.length + open.groups.length + 1, "the fetch row, the groups and the branches are the menu's items");
assert.equal(open.rows[0].branch, "feat/x", "the branch this session's folder is on stands at the head of the list");
assert.equal(open.rows[1].branch, "main", "then the branch the project's own folder holds");
assert.ok(
  open.rows.slice(2).every((row) => !["feat/x", "main"].includes(row.branch)),
  "and the rest are below",
);
assert.deepEqual(
  open.rows.map((row) => row.branch),
  [
    "feat/x",
    "main",
    "probe",
    "bak/4old",
    "claude/settings-layout-review-8265af",
    "fix/a",
    "fix/b",
    "fix/c",
    "origin/HEAD",
    "origin/main",
    "origin/claude/settings-x",
    "release/1.0",
  ],
  "names that stand on their own, then the prefix groups in order; inside a group its own"
  + " branches come first and its sub-prefixes (`origin` holds `claude`) follow",
);
assert.deepEqual(
  open.rows.filter((row) => row.branch.startsWith("fix/")).map((row) => row.label),
  ["a", "b", "c"],
  "under the `fix` group a branch is named by what the group's row did not already say",
);
assert.equal(open.rows.find((row) => row.branch === "probe").label, "probe", "a branch with no prefix is named whole");

const branchRow = (branch) => `.sidebar-project-context-menu-row--branch:has([data-branch="${branch}"]) button[role="menuitem"]`;
const branchTitle = (branch) => page.getAttribute(branchRow(branch), "title");
const currentRow = page.locator(".sidebar-project-context-menu-row--branch:has([data-branch='feat/x']) button[role='menuitem']");
assert.equal(await currentRow.getAttribute("aria-current"), "true", "the current branch is marked in its own row");
assert.match(await currentRow.getAttribute("title"), /This worktree is on feat\/x/, "and says which worktree is on it");
// The glyph the user asked for: this checkout is a linked worktree (`/repo-worktrees/feat-x`),
// so the current row wears the checkout glyph. It used to wear the project folder — a row
// about the branch, on a rule that matched the folder's name against it — and a session in
// a worktree read its whole header as a plain folder.
const currentGlyph = await page.evaluate(() => {
  const name = document.querySelector('.sidebar-project-context-menu-row--branch [data-branch="feat/x"]');
  const first = name?.closest("button")?.querySelector(".sidebar-project-context-menu-branch-mark svg path");
  return first?.getAttribute("d") ?? null;
});
assert.ok(currentGlyph?.startsWith("M4 4h9a2 2"), "the current row's mark is the worktree's own drawing");
assert.equal(
  await branchTitle("main"),
  "main is checked out in the project's own folder — work there",
  "a branch checked out in the main checkout says so, and points at that folder",
);
assert.equal(await branchTitle("fix/b"), "Check out fix/b in the current checkout", "an ordinary row says the switch its name performs");
assert.equal(
  await branchTitle("origin/main"),
  "Remote branch — checking it out creates a local tracking branch",
  "a remote row says what checking it out does",
);
assert.equal(
  await page.locator('.sidebar-project-context-menu-row--branch:has([data-branch="fix/b"]) .sidebar-project-context-menu-branch-action').count(),
  1,
  "one action per switchable row: the worktree this branch can start",
);
assert.equal(
  await page.locator('.sidebar-project-context-menu-row--branch:has([data-branch="feat/x"]) .sidebar-project-context-menu-branch-action').count(),
  0,
  "the branch this folder is on offers no worktree of its own: git would refuse it",
);
// No "Worktrees…" page any more, and no step back to "Project actions": the branches
// that own a folder are rows here, and the panel opened on this page.
assert.equal(await page.locator(".sidebar-project-context-menu-back").count(), 0, "no back row to Project actions");
assert.equal(await page.getByText("Worktrees…").count(), 0, "no Worktrees… item: the branches that own a folder are rows here");
assert.equal(await page.getByText("More actions").count(), 0, "the panel does not open on a Project actions step, so there is nothing to come back from");
assert.equal(await page.locator(".sidebar-project-context-menu-heading").count(), 1, "one title, naming this page");
assert.equal((await page.locator(".sidebar-project-context-menu-heading").textContent())?.trim(), "Switch branch", "and the title is the panel's own, not a step it came from");
assert.equal(await page.locator(".sidebar-project-context-menu-row:not(.sidebar-project-context-menu-row--branch):not(.sidebar-project-context-menu-row--fetch)").count(), 0,
  "the fetch row and the tree are the whole menu");

// Typing narrows the list, in any case.
await page.click(".sidebar-project-context-menu-fetch");
await page.fill(".sidebar-project-context-menu-filter", "fix/");
let state = await page.evaluate(STATE);
assert.deepEqual(state.rows.map((row) => row.branch), ["fix/a", "fix/b", "fix/c"], "the query narrows the list to the matches");
assert.deepEqual(state.groups.map((group) => `${group.prefix}:${group.expanded}`), ["fix:true"],
  "a query keeps the group's row over its matches, and a search that answered from inside a folded group would be a dead end, so it unfolds");
assert.deepEqual(state.rows.map((row) => row.label), ["a", "b", "c"], "a leaf's label is the name git takes, the row keeps the branch");
assert.ok(state.box.focused, "the box keeps focus while typing");
await page.screenshot({ path: `${out}/filtered.png` });

// A substring in the middle, in a different case, narrows across the whole list.
await page.fill(".sidebar-project-context-menu-filter", "Settings");
state = await page.evaluate(STATE);
assert.deepEqual(
  state.rows.map((row) => row.branch),
  ["claude/settings-layout-review-8265af", "origin/claude/settings-x"],
  "the substring matches local and remote branches in the middle of the name",
);
assert.equal(state.box.value, "Settings", "the box keeps what was typed");
assert.ok(state.menuItems >= state.rows.length, "the list follows the box, the menu does not rebuild under the finger");

// A query that matches nothing says so: an empty list that looks like a bug is worse
// than a sentence.
await page.fill(".sidebar-project-context-menu-filter", "zzz");
state = await page.evaluate(STATE);
assert.equal(state.rows.length, 0, "a query with no match leaves no row");
assert.match(state.hint, /No branch matches/, "and the panel says why");
await page.screenshot({ path: `${out}/no-match.png` });

// Escape closes the menu, as it closes every other menu in the app.
await page.locator(".sidebar-project-context-menu-filter").press("Escape");
state = await page.evaluate(STATE);
assert.deepEqual(state.calls.at(-1), ["close"], "Escape closes the menu");

// The arrow folds a group. The leaves go away, the group's row says how many are
// hidden, and unfolding puts the list back exactly as it was.
await page.fill(".sidebar-project-context-menu-filter", "");
const full = (await page.evaluate(STATE)).rows.map((row) => row.branch);
assert.equal(full.length, 12, "an emptied box is the full list again");
await page.click('.sidebar-project-context-menu-branch-group:has([data-group="fix"])');
const folded = await page.evaluate(STATE);
assert.deepEqual(
  folded.groups.find((group) => group.prefix === "fix"),
  { prefix: "fix", label: "fix", expanded: "false", badge: "3 branches" },
  "the folded group is marked closed and counts what it hides",
);
assert.deepEqual(folded.rows.map((row) => row.branch), full.filter((branch) => !branch.startsWith("fix/")),
  "the folded group's branches are gone from the list, and only they");
await page.screenshot({ path: `${out}/folded.png` });
await page.click('.sidebar-project-context-menu-branch-group:has([data-group="fix"])');
const unfolded = await page.evaluate(STATE);
assert.equal(unfolded.groups.find((group) => group.prefix === "fix").expanded, "true", "the arrow opens it again");
assert.deepEqual(unfolded.rows.map((row) => row.branch), full, "and the list is the list it was");

// The name is the switch; the icon is the worktree, and it is named as such.
await page.click(branchRow("main"));
await page.click('.sidebar-project-context-menu-row--branch:has([data-branch="fix/b"]) .sidebar-project-context-menu-branch-action[title*="New worktree from"]');
state = await page.evaluate(STATE);
assert.deepEqual(
  state.calls.filter((call) => call[0] === "switch" || call[0] === "worktree"),
  [["switch", "main"], ["worktree", "fix/b"]],
  "one click switches to a branch, one opens the new-worktree form for it",
);
server.close();

// The short project: three branches is a list you read. No box.
const short = await browser.newPage({ viewport: { width: 900, height: 800 } });
const shortServer = await serve();
await short.goto(`http://127.0.0.1:${shortServer.address().port}/?short=1`);
await short.waitForSelector(".sidebar-project-context-menu");
const shortState = await short.evaluate(STATE);
assert.equal(shortState.box, null, "a three-branch project gets no filter box");
assert.equal(shortState.rows.length, 3, "all three branches show");
assert.ok(shortState.rows.some((row) => row.branch === "main"), "including the one the project's folder holds");
await short.screenshot({ path: `${out}/short.png` });
shortServer.close();
await browser.close();

console.log(
  `branch tree: ${open.rows.length} branches open as ${open.groups.length} prefix groups with their arrows, `
    + `the checkout's branch at the head, a fold hides 3 and puts them back, `
    + `the filter box appears for the long project only (typed `
    + `"fix/" -> 3, "Settings" -> 2, "zzz" -> the no-match sentence), Escape closes the menu, and the short project keeps none`,
);
