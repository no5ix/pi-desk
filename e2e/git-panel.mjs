import assert from "node:assert/strict";
import { build } from "esbuild";
import { stubMonaco } from "./support/esbuild-stub.mjs";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The right panel's Git view, measured.
 *
 * Two things are measured, at a desktop width and at a phone width:
 *
 *  - the control a thumb aims at has a thumb's plate (36px) when the device has
 *    a finger, at every level of the view — the branch row, the tab, the row's
 *    own menu button;
 *  - no level makes the *page* scroll sideways. A long commit subject, a long
 *    file path and a long diff line are all allowed to scroll inside their own
 *    box; that is what the box is for. The page is not.
 *
 * The repository is the fixture's (e2e/git-panel.fixture.jsx), which answers the
 * panel's own commands: eight branches so the list grows its filter box, one
 * checked out in a linked folder, two remote-only, three under a `chore/` prefix
 * the tree folds; four commits, the newest a merge with two lanes; a commit
 * touching two files; a working tree with a staged edit, an unstaged edit and an
 * untracked file.
 */
const out = "test-results/git-panel";
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  plugins: [stubMonaco],
  entryPoints: ["e2e/git-panel.fixture.jsx"],
  outfile: `${out}/fixture.js`,
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const bundle = await readFile(`${out}/fixture.js`);

const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url.startsWith("/styles.css")) {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const results = [];
const pageErrors = [];

const box = async (page, selector) => page.locator(selector).first().evaluate((el) => {
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
});

/** The page must not scroll sideways: a box may, the page may not. */
const pageOverflow = (page) => page.evaluate(() => {
  const root = document.scrollingElement ?? document.documentElement;
  return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
});

async function expectNoSidewaysScroll(page, label, level) {
  const { scrollWidth, clientWidth } = await pageOverflow(page);
  assert.ok(scrollWidth <= clientWidth + 1,
    `${label}: ${level} does not widen the page (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`);
}

async function touchPlates(page, label, selectors) {
  for (const selector of selectors) {
    const plate = await box(page, selector);
    assert.ok(plate.w >= 36 && plate.h >= 36,
      `${label}: a finger gets ${plate.w}×${plate.h} on ${selector} (36 required)`);
  }
}

async function panel(label, { width, height, touch, theme = "light" }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(`${label}: console: ${message.text()}`); });
  await page.goto(`${url}?theme=${theme}`);
  await page.waitForSelector("#git-panel .git-branch-row", { timeout: 15_000 }).catch(async () => {
    // A panel that renders nothing is a fixture problem, and the page's own
    // errors are the answer: report them here rather than as a timeout.
    const text = await page.evaluate(() => document.getElementById("git-panel")?.innerText ?? "(no panel)");
    assert.fail(`${label}: the branch tree never appeared. Panel says: ${text.slice(0, 400)}; page errors: ${pageErrors.join(" | ")}`);
  });

  // ─── the button that opens the view, in the panel's header row ───
  const git = await box(page, ".right-panel-tab-strip .git-panel-toggle");
  const tree = await box(page, ".right-panel-tab-strip .file-tree-toggle");
  const strip = await box(page, ".right-panel-tab-strip");
  const slot = await box(page, ".right-panel-tab-strip .file-tab-bar-slot");
  assert.ok(git.w > 0 && git.h > 0, `${label}: the Git button is on screen (${git.w}×${git.h})`);
  assert.ok(git.y >= strip.y - 1 && git.y + git.h <= strip.y + strip.h + 2, `${label}: the button is inside the panel's header row`);
  assert.ok(tree.x < git.x && git.x < slot.x,
    `${label}: the view toggles lead the row and the tabs follow (tree x=${tree.x}, git x=${git.x}, tabs x=${slot.x})`);
  if (touch) await touchPlates(page, label, [".right-panel-tab-strip .git-panel-toggle", ".right-panel-tab-strip .file-tree-toggle"]);

  // ─── level 1: the branch tree ───
  const rows = page.locator("#git-panel .git-branch-row");
  assert.ok(await rows.count() >= 5, `${label}: the branch list has rows (${await rows.count()})`);
  assert.equal(await page.locator("#git-panel .git-branch-row.is-current").count(), 1,
    `${label}: the branch this checkout is on is marked`);
  assert.equal(await page.locator('#git-panel .git-branch-row.is-group:has-text("chore")').count(), 1,
    `${label}: the chore/ prefix is a group the tree folds`);
  assert.ok(await page.locator("#git-panel .git-branch-row.is-group").count() >= 3,
    `${label}: three prefixes became groups (${await page.locator("#git-panel .git-branch-row.is-group").count()})`);
  const remoteRows = page.locator("#git-panel .git-branch-row .git-branch-tag");
  assert.ok(await remoteRows.count() >= 2, `${label}: the remote-only branches are tagged (${await remoteRows.count()})`);
  assert.ok((await page.locator("#git-panel .git-branch-row").allInnerTexts()).some((text) => text.includes("preview")),
    `${label}: a remote branch is listed under the remote section`);
  assert.ok(await page.locator("#git-panel .git-branch-current-mark").count() === 1, `${label}: the current branch is marked with the dot`);
  assert.ok(await page.locator("#git-panel .git-search-input").isVisible(), `${label}: a long branch list gets its filter box`);

  await expectNoSidewaysScroll(page, label, "the branch tree");
  if (touch) await touchPlates(page, label, ["#git-panel .git-branch-row"]);

  // The filter narrows the tree to the matches, and the match is reachable. The
  // rows are labelled with the name minus the prefix, as Branchshift's are.
  await page.locator("#git-panel .git-search-input").fill("docs");
  await page.waitForTimeout(60);
  const filtered = (await page.locator("#git-panel .sidebar-project-context-menu-branch-name").allInnerTexts()).map((t) => t.trim());
  assert.ok(filtered.includes("docs"), `${label}: a query keeps the group its match lives in (saw ${filtered.join(", ")})`);
  assert.ok(filtered.includes("panel-notes"), `${label}: and the match itself`);
  assert.ok(!filtered.includes("chore"), `${label}: and folds away what does not match`);
  assert.ok(!filtered.includes("flat-chat-blocks"), `${label}: the current branch's row is folded too`);
  await page.locator("#git-panel .git-search-input").fill("");
  await page.waitForTimeout(60);

  // ─── level 2: one branch's commits ───
  // The tree labels a row with the name minus its prefix, so the branch under
  // `feat/panel/` is the row named `git-view`.
  await page.locator('#git-panel .sidebar-project-context-menu-branch-name:text-is("git-view")').first().click();
  await page.waitForSelector("#git-panel .git-commit-row");
  const commits = page.locator("#git-panel .git-commit-row");
  assert.ok(await commits.count() >= 2, `${label}: the commit list has rows (${await commits.count()})`);
  assert.ok(await page.locator("#git-panel .git-commit-hash").first().innerText() !== "", `${label}: a row shows the short hash`);
  assert.ok(await page.locator("#git-panel .git-graph-layer").count() === 1, `${label}: the graph is drawn behind the list`);
  await expectNoSidewaysScroll(page, label, "the commit list");
  if (touch) {
    // The commit row is the graph's grid (28-32px), not a thumb's plate; the
    // control inside it is. Measured as what it is.
    const commitRow = await box(page, "#git-panel .git-commit-row");
    assert.ok(commitRow.h >= 32, `${label}: a commit row is at least the grid's 32 (${commitRow.h})`);
    await touchPlates(page, label, ["#git-panel .git-row-menu-button", "#git-panel .git-icon-button"]);
  }

  // ─── level 3: one commit, its files and its diff ───
  await page.locator('#git-panel .git-commit-row:has-text("draw the commit graph")').first().click();
  await page.waitForSelector("#git-panel .git-file-row");
  assert.equal(await page.locator("#git-panel .git-file-row").count(), 2, `${label}: the commit lists the files it touched`);
  await page.waitForSelector(".file-diff-view, .diff-view, .git-diff", { timeout: 5_000 }).catch(() => null);
  const detail = await page.locator("#git-panel").innerText();
  assert.match(detail, /LogPanel\.tsx/, `${label}: the commit detail names the file`);
  assert.ok(/@@/.test(detail) || /draw the commit graph/.test(detail), `${label}: the detail shows the patch or the message`);
  await expectNoSidewaysScroll(page, label, "the commit detail");

  // ─── the Commit tab: the working tree split, with the checkbox as the index ───
  await page.locator('#git-panel .git-tabs .git-tab:has-text("Commit")').first().click();
  await page.waitForSelector("#git-panel .git-change-row");
  const groups = await page.locator("#git-panel .git-change-group-label").allInnerTexts();
  assert.ok(groups.length >= 2, `${label}: the working tree is split into its groups (${groups.join(" / ")})`);
  assert.ok(await page.locator("#git-panel .git-change-row").count() >= 3, `${label}: every change is a row`);
  assert.ok(await page.locator("#git-panel .git-checkbox").count() >= 3, `${label}: each row carries the stage/unstage control`);
  await expectNoSidewaysScroll(page, label, "the commit panel");
  if (touch) await touchPlates(page, label, ["#git-panel .git-tabs .git-tab"]);

  results.push({
    label,
    branches: await rows.count(),
    commits: await commits.count(),
    groups: groups.length,
  });
  await page.screenshot({ path: `${out}/${label.replace(/[^a-z0-9]+/gi, "-")}.png`, fullPage: false });
  await context.close();
}

await panel("desktop", { width: 1440, height: 900, touch: false });
await panel("desktop-dark", { width: 1440, height: 900, touch: false, theme: "dark" });
await panel("phone", { width: 390, height: 844, touch: true });
await panel("phone-dark", { width: 390, height: 844, touch: true, theme: "dark" });
await panel("narrow-window", { width: 900, height: 700, touch: false });

await browser.close();
server.close();

assert.deepEqual(pageErrors, [], "the panel runs without page errors");
console.log(JSON.stringify(results, null, 2));
