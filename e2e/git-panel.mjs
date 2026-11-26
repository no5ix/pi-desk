import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The right panel's Git view, measured: the button that opens it, and its three levels
 * — the branch tree, one branch's commits, one commit's diff.
 *
 * The view lives in the panel's content area, which on a phone is the whole 390px page
 * and on a desktop is a column beside the chat. So both widths are measured, and the two
 * questions asked of each: does the control a thumb aims at have a thumb's plate, and
 * does any of the three levels make the page scroll sideways. A long diff line is
 * allowed to scroll inside its own box — that is what the box is for — and the page is
 * not allowed to scroll at all.
 *
 * The repository is the fixture's (e2e/git-panel.fixture.jsx): eight branches so the
 * list grows its filter box, one checked out in a linked folder, two remote-only, three
 * under a `chore/` prefix the tree folds; two commits, the second a merge; one commit
 * touching two files.
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

async function levels(label, { width, height, touch }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(`${label}: console: ${message.text()}`); });
  await page.goto(url);
  await page.waitForSelector("#git-panel .git-panel-row");

  // ─── the button in the panel's header row ───
  const git = await box(page, ".right-panel-tab-strip .git-panel-toggle");
  const tree = await box(page, ".right-panel-tab-strip .file-tree-toggle");
  const strip = await box(page, ".right-panel-tab-strip");
  assert.ok(git.w > 0 && git.h > 0, `${label}: the Git button is on screen (${git.w}×${git.h})`);
  assert.ok(git.y >= strip.y - 1 && git.y + git.h <= strip.y + strip.h + 2, `${label}: the button is inside the panel's header row`);
  const slot = await box(page, ".right-panel-tab-strip .file-tab-bar-slot");
  // Both view toggles are `order: -1`, so they lead the row in DOM order: the file
  // list's, then the Git view's, and the tabs after them.
  assert.ok(tree.x < git.x && git.x < slot.x,
    `${label}: the two view toggles lead the row, the Git button after the file list's (tree x=${tree.x}, git x=${git.x}, tabs x=${slot.x})`);
  if (touch) {
    assert.ok(git.w >= 36 && git.h >= 36, `${label}: a finger gets ${git.w}×${git.h} on the Git button (36 required)`);
    assert.ok(tree.w >= 36 && tree.h >= 36, `${label}: the file list's toggle is the same size (${tree.w}×${tree.h})`);
  }

  // ─── level 1: the branch tree ───
  const rows = page.locator("#git-panel .git-panel-row");
  assert.ok(await rows.count() >= 5, `${label}: the branch list has rows (${await rows.count()})`);
  const current = page.locator('.git-panel-row .sidebar-project-context-menu-branch-name[data-branch="fix/flat-chat-blocks"]');
  assert.equal(await current.count(), 1, `${label}: the branch this checkout is on is listed`);
  assert.equal(await page.locator('.git-panel-row[aria-current="true"]').count(), 1, `${label}: and marked as this folder's`);
  assert.equal(await page.locator('.git-panel-row .sidebar-project-context-menu-branch-name[data-branch="feat/panel/git-view"]').count(), 1,
    `${label}: the branch with a folder of its own is listed`);
  const group = page.locator('.git-panel-row .sidebar-project-context-menu-branch-name[data-group="chore"]');
  assert.equal(await group.count(), 1, `${label}: the chore/ prefix is a group`);
  assert.equal(await group.evaluate((el) => el.parentElement.getAttribute("aria-expanded")), "true", `${label}: a group starts open`);
  const remoteRow = page.locator('#git-panel .git-panel-row .sidebar-project-context-menu-branch-tag').filter({ hasText: "remote" });
  assert.equal(await remoteRow.count(), 1, `${label}: a remote-only branch is tagged`);
  // The row shows the name without the remote's prefix and carries the name git takes.
  assert.equal(await remoteRow.evaluate((el) => el.parentElement.querySelector(".sidebar-project-context-menu-branch-name").innerText), "preview",
    `${label}: the label is the menu's stripped name`);
  assert.equal(await remoteRow.evaluate((el) => el.parentElement.querySelector(".sidebar-project-context-menu-branch-name").getAttribute("data-branch")), "origin/preview",
    `${label}: and the row resolves the full remote ref`);
  assert.ok(await page.locator("#git-panel .git-panel-filter").isVisible(), `${label}: a long branch list gets its filter box`);
  await page.locator("#git-panel .git-panel-filter").fill("docs");
  await page.waitForTimeout(30);
  assert.equal(await page.locator('#git-panel .git-panel-row .sidebar-project-context-menu-branch-name[data-group="chore"]').count(), 0,
    `${label}: a query narrows the tree to the matches`);
  assert.equal(await page.locator('#git-panel .sidebar-project-context-menu-branch-name[data-branch="docs/panel-notes"]').count(), 1,
    `${label}: and the match is reachable`);
  await page.locator("#git-panel .git-panel-filter").fill("");
  await page.waitForTimeout(30);
  await group.click();
  await page.waitForTimeout(30);
  assert.equal(await group.evaluate((el) => el.parentElement.getAttribute("aria-expanded")), "false", `${label}: a group folds`);
  assert.equal(await page.locator('#git-panel .sidebar-project-context-menu-branch-name[data-branch="chore/trim-the-strip"]').count(), 0,
    `${label}: and its children leave the list`);
  await group.click();
  await page.waitForTimeout(30);

  const pageScroll = () => page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    panelScrollWidth: document.querySelector("#git-panel").scrollWidth,
    panelClientWidth: document.querySelector("#git-panel").clientWidth,
  }));
  let scroll = await pageScroll();
  assert.ok(scroll.scrollWidth <= scroll.innerWidth, `${label}: the branch level does not scroll the page (${scroll.scrollWidth} <= ${scroll.innerWidth})`);
  assert.ok(scroll.panelScrollWidth <= scroll.panelClientWidth, `${label}: and not the view (${scroll.panelScrollWidth} <= ${scroll.panelClientWidth})`);
  const listOverflow = await page.locator("#git-panel .git-panel-list").evaluate((el) => {
    const style = getComputedStyle(el);
    return { x: style.overflowX, y: style.overflowY };
  });
  assert.equal(listOverflow.x, "hidden", `${label}: a long branch list scrolls inside the list, never sideways`);

  // ─── level 2: the branch's commits ───
  await page.locator('.git-panel-row .sidebar-project-context-menu-branch-name[data-branch="feat/panel/git-view"]').click();
  await page.waitForSelector("#git-panel .git-commit-row");
  const commits = page.locator("#git-panel .git-commit-row");
  assert.equal(await commits.count(), 2, `${label}: the branch's commits are listed (${await commits.count()})`);
  const subjects = await page.locator("#git-panel .git-commit-subject").allInnerTexts();
  assert.match(subjects[0], /the right panel grows a Git view/, `${label}: a commit is named by its subject`);
  const shas = await page.locator("#git-panel .git-commit-sha").allInnerTexts();
  assert.deepEqual(shas, ["0a1b2c3", "1111111"], `${label}: and by the short sha`);
  const commitBox = await commits.first().evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
  assert.ok(commitBox.h >= 30, `${label}: a commit row is a row a thumb can hit (${commitBox.h}px)`);
  assert.ok(commitBox.w <= width, `${label}: and fits the column (${commitBox.w} <= ${width})`);
  scroll = await pageScroll();
  assert.ok(scroll.scrollWidth <= scroll.innerWidth, `${label}: the commit level does not scroll the page (${scroll.scrollWidth} <= ${scroll.innerWidth})`);

  // ─── level 3: one commit's diff ───
  await commits.first().click();
  await page.waitForSelector("#git-panel .file-diff-view");
  const files = page.locator("#git-panel .git-file-row");
  assert.equal(await files.count(), 2, `${label}: the commit's files are listed (${await files.count()})`);
  const statuses = await page.locator("#git-panel .git-file-status").allInnerTexts();
  assert.deepEqual(statuses, ["A", "M"], `${label}: each carries git's letter`);
  const counts = await page.locator("#git-panel .git-file-counts").allInnerTexts();
  assert.match(counts[0], /\+604\s*−0/, `${label}: with its counts (${JSON.stringify(counts[0])})`);
  const diffBox = await box(page, "#git-panel .git-panel-diff");
  assert.ok(diffBox.w > 0 && diffBox.h > 40, `${label}: the diff has a box of its own (${diffBox.w}×${diffBox.h})`);
  const diffLines = await page.locator("#git-panel .file-diff-line").count();
  assert.ok(diffLines >= 6, `${label}: the patch is painted by the app's diff view (${diffLines} lines)`);
  // The diff view paints the patch's lines, not the `diff --git` headers — naming the
  // files is the list above it's job — so the sections are read by their content.
  const diffText = await page.locator("#git-panel .git-panel-diff").evaluate((el) => el.innerText);
  assert.match(diffText, /export function GitPanel\(\) \{/, `${label}: the added file's section is painted`);
  assert.match(diffText, /order: -1;/, `${label}: and the modified file's`);
  scroll = await pageScroll();
  assert.ok(scroll.scrollWidth <= scroll.innerWidth, `${label}: a two-file diff does not scroll the page (${scroll.scrollWidth} <= ${scroll.innerWidth})`);
  const diffOverflow = await page.locator("#git-panel .git-panel-diff").evaluate((el) => getComputedStyle(el).overflowX);
  assert.equal(diffOverflow, "auto", `${label}: a long line scrolls inside the diff box`);

  // A file row narrows the patch to that file — the row is a filter, not a link.
  await page.locator('#git-panel .git-file-row-main .git-file-path:text-is("components/GitPanel.tsx")').click();
  await page.waitForTimeout(30);
  assert.equal(await page.locator('#git-panel .git-file-row-main[aria-pressed="true"] .git-file-path:text-is("components/GitPanel.tsx")').count(), 1,
    `${label}: the file row says it is the one shown`);
  const narrowed = await page.locator("#git-panel .git-panel-diff").evaluate((el) => el.innerText);
  assert.match(narrowed, /export function GitPanel\(\) \{/, `${label}: the narrowed patch holds that file's lines`);
  assert.ok(!narrowed.includes("order: -1;"), `${label}: and not the other file's`);

  // A file row's own button hands the file to the panel's tab, the app's one open path.
  await page.locator('#git-panel .git-file-row .git-file-path:text-is("app/native-theme.css")').locator("xpath=../..").locator(".git-file-open").click();
  await page.waitForTimeout(30);
  assert.deepEqual(await page.evaluate(() => window.__opened), ["/repo/app/native-theme.css", "native-theme.css"],
    `${label}: opening a file joins the repository root and the file's path`);

  // Back out of the levels, in words and by name.
  await page.locator("#git-panel .git-panel-back").click();
  await page.waitForSelector("#git-panel .git-commit-row");
  assert.equal(await page.locator("#git-panel .file-diff-view").count(), 0, `${label}: back from the diff goes to the commits`);
  await page.locator("#git-panel .git-panel-back").click();
  await page.waitForSelector('.git-panel-row .sidebar-project-context-menu-branch-name[data-branch="fix/flat-chat-blocks"]');
  assert.equal(await page.locator("#git-panel .git-commit-row").count(), 0, `${label}: back from the commits goes to the branches`);

  // The states, in words: a branch with nothing on it says so.
  await page.locator('.git-panel-row .sidebar-project-context-menu-branch-name[data-branch="origin/preview"]').click();
  const empty = page.getByText(/has no commits to show/i);
  await empty.waitFor();
  assert.match(await empty.innerText(), /origin\/preview|preview/, `${label}: an empty branch is named in words`);

  // A merge names the parent its diff is against.
  await page.locator("#git-panel .git-panel-back").click();
  await page.locator('.git-panel-row .sidebar-project-context-menu-branch-name[data-branch="feat/panel/git-view"]').click();
  await page.waitForSelector("#git-panel .git-commit-row");
  await commits.nth(1).click();
  await page.waitForSelector("#git-panel .file-diff-view");
  assert.match(await page.locator("#git-panel .git-panel-commit-line").innerText(), /merge of 2 branches/i,
    `${label}: a merge commit says its diff is against a parent`);

  await page.screenshot({ path: `${out}/${label}.png`, fullPage: false });
  results.push({ label, git, tree, strip, scroll: await pageScroll() });
  await context.close();
}

await levels("phone-390", { width: 390, height: 844, touch: true });
await levels("desktop-1280", { width: 1280, height: 900, touch: false });

assert.deepEqual(pageErrors, [], "the view runs without a page or console error");

await browser.close();
server.close();

// A detached HEAD, a folder that is not a repository: the states the routes answer with.
console.log(JSON.stringify(results, null, 2));
console.log("git-panel fixture: branch tree, commits and diff measured at 390 and 1280");
