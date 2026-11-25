import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The branch page's filter box and the branch that lives in a worktree, driven
 * in a real browser.
 *
 * The box is state (typing narrows the list, and the box is not a menu row, so
 * the page's arrow keys still walk the branches), and the held branch's row has
 * to stay clickable: the row promises "open that worktree", so its branch icon
 * is the worktree's folder, not a checkout git would refuse. Neither is visible
 * in a static render.
 *
 * `?short=1` is the control pass: a four-branch project gets no box at all, so
 * the check cannot pass by always having one.
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

const STATE = () => ({
  rows: [...document.querySelectorAll(".sidebar-project-context-menu-row--branch .sidebar-project-context-menu-branch-name")]
    .map((el) => el.textContent.trim()),
  filter: (() => {
    const input = document.querySelector(".sidebar-project-context-menu-filter");
    if (!input) return null;
    const menu = document.querySelector(".sidebar-project-context-menu").getBoundingClientRect();
    const box = input.getBoundingClientRect();
    return {
      value: input.value,
      label: input.getAttribute("aria-label"),
      focused: document.activeElement === input,
      pastMenu: box.right > menu.right + 0.5,
      height: Math.round(box.height),
    };
  })(),
  hint: document.querySelector(".sidebar-project-context-menu-hint")?.textContent?.trim() ?? null,
  hintCut: (() => {
    const hint = document.querySelector(".sidebar-project-context-menu-hint");
    return hint ? hint.scrollWidth > hint.clientWidth + 1 : null;
  })(),
  menuItems: document.querySelectorAll('.sidebar-project-context-menu [role="menuitem"]').length,
  menuitemInputs: document.querySelectorAll('.sidebar-project-context-menu input[role="menuitem"]').length,
  calls: window.__calls.map((call) => call.join(":")),
});

const branchButton = (name, kind) =>
  `.sidebar-project-context-menu-row--branch:has(.sidebar-project-context-menu-branch-name:text-is("${name}")) .sidebar-project-context-menu-branch-action[title*="${kind}"]`;
/** The row's name is the branch switch: it checks the branch out, or takes the session to
 *  the worktree that already holds it. The row used to carry a second icon that did exactly
 *  this, and the menu's own test (`e2e/branch-menu-rows.mjs`) counts one action button. */
const branchRow = (name) =>
  `.sidebar-project-context-menu-row--branch:has(.sidebar-project-context-menu-branch-name:text-is("${name}")) button[role="menuitem"]`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const server = await serve();
const base = `http://127.0.0.1:${server.address().port}/`;

await page.goto(base);
await page.waitForSelector(".sidebar-project-context-menu-row--branch");

const open = await page.evaluate(STATE);
assert.equal(open.rows.length, 12, `every branch is listed (${open.rows.length})`);
assert.ok(open.filter, "a nine-branch project gets the filter box");
assert.equal(open.filter.label, "Filter branches", "the box is named");
assert.ok(!open.filter.focused, "the box does not take the caret: the menu keeps its arrow keys");
assert.ok(!open.filter.pastMenu, "the box stays inside the menu");
assert.equal(open.menuitemInputs, 0, "the box is not a menu row");
assert.equal(open.menuItems, open.rows.length + 3, "back, fetch, worktrees and the rows are the menu's items");

await page.fill(".sidebar-project-context-menu-filter", "FIX/");
let state = await page.evaluate(STATE);
assert.deepEqual(state.rows, ["fix/a", "fix/b", "fix/c"], "the query is matched case-insensitively");
assert.equal(state.filter.value, "FIX/", "the box keeps what was typed");

await page.fill(".sidebar-project-context-menu-filter", "Settings");
state = await page.evaluate(STATE);
assert.deepEqual(state.rows, ["claude/settings-layout-review-8265af", "origin/claude/settings-x"],
  "remote branches are narrowed by the same box");

await page.fill(".sidebar-project-context-menu-filter", "zzz");
state = await page.evaluate(STATE);
assert.equal(state.rows.length, 0, "nothing matches");
assert.equal(state.hint, "No branch matches “zzz”", "the page says so, with the query");
assert.ok(!state.hintCut, "the sentence is not cut");
await page.screenshot({ path: `${out}/no-match.png` });

await page.focus(".sidebar-project-context-menu-filter");
await page.keyboard.press("Escape");
state = await page.evaluate(STATE);
assert.deepEqual(state.calls, ["close"], "Escape closes the page, as it closes every menu in the app");
assert.equal(state.filter.value, "zzz", "the box keeps its text to the end: the menu owns Escape");
await page.evaluate(() => { window.__calls.length = 0; });
await page.fill(".sidebar-project-context-menu-filter", "");

// The branch that lives in another worktree: the row's **name** explains it and is the way
// in. `main` is checked out in /repo while the session is in /repo-worktrees/feat-x;
// `feat/x` is the current branch of that checkout. The separate branch icon that repeated
// the name is gone, so the tip and the click both live on the name.
const attr = (selector, name) => page.locator(selector).first().getAttribute(name);
assert.equal(await attr(branchRow("main"), "title"),
  "main is already checked out in another worktree — open that worktree");
assert.equal(await attr(branchRow("main"), "disabled"), null,
  "a branch held in a worktree is still reachable: the row opens that checkout");
assert.equal(await attr(branchRow("feat/x"), "aria-current"), "true",
  "the current branch is marked current: its row is the only place that says so now that the row carries no branch icon");
await page.screenshot({ path: `${out}/long-list.png` });

await page.click(branchRow("main"));
await page.click(branchButton("fix/b", "New worktree from"));
state = await page.evaluate(STATE);
assert.deepEqual(state.calls, ["switch:main", "worktree:fix/b"],
  "the row reports the branch; the chip opens the worktree and the form starts from that branch");

// The control pass: a project with three branches is read, not filtered.
await page.goto(`${base}?short=1`);
await page.waitForSelector(".sidebar-project-context-menu-row--branch");
const short = await page.evaluate(STATE);
assert.equal(short.rows.length, 3, `the short project lists its branches (${short.rows.length})`);
assert.equal(short.filter, null, "a short list gets no filter box");
assert.ok(short.rows.includes("main"), "the held branch is still marked out");

await browser.close();
server.close();
console.log("ok: the branch page narrows from its box, and a branch in a worktree opens that worktree");
