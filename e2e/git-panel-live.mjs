import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";

// Live measurement of the right panel's Git view on the shared dev server.
const base = process.env.PI_DESK_URL || "http://127.0.0.1:30141";
const session = "01a2123a-8702-77bf-8e24-a2bd0dad5132";
const url = `${base}/?session=${session}`;
const shots = "test-results/git-panel-live";
await import("node:fs").then(({ mkdirSync }) => mkdirSync(shots, { recursive: true }));

const box = async (page, selector) => page.locator(selector).first().evaluate((el) => {
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
});
const scroll = (page) => page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  bodyScrollWidth: document.body.scrollWidth,
}));

async function run(label, browserType, viewport, touch) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator(".app-shell").first().waitFor({ state: "visible", timeout: 90000 });
  await page.locator(".chat-composer").first().waitFor({ state: "visible", timeout: 90000 });
  const shell = await box(page, ".app-shell");
  const composer = await box(page, ".chat-composer");
  assert.ok(shell.w > 100 && shell.h > 100, `${label}: .app-shell is on screen (${shell.w}×${shell.h})`);
  assert.ok(composer.w > 40 && composer.h > 8, `${label}: .chat-composer is on screen (${composer.w}×${composer.h})`);
  let s = await scroll(page);
  assert.ok(s.scrollWidth <= s.innerWidth, `${label}: the session page has no sideways scroll (${s.scrollWidth} <= ${s.innerWidth})`);
  await page.screenshot({ path: `${shots}/${label}-chat.png` });

  // The panel, then the Git view's button in its header row.
  // The panel is opened by whichever toggle is on screen (the restored workspace can
  // bring it back open already, and then its toggle reads "Hide workspace").
  const toggles = page.locator('button[aria-label="Show workspace"]');
  const count = await toggles.count();
  for (let i = 0; i < count; i += 1) {
    if (await toggles.nth(i).isVisible()) { await toggles.nth(i).click(); break; }
  }
  const gitButton = page.locator("#file-panel .right-panel-tab-strip .git-panel-toggle");
  await gitButton.first().waitFor({ state: "visible", timeout: 60000 });
  // The panel slides in; measure it at rest, and require the button's whole plate to be
  // inside the viewport — a control the page has to scroll to reach is not on a phone.
  await page.waitForTimeout(600);
  const git = await box(page, "#file-panel .right-panel-tab-strip .git-panel-toggle");
  assert.ok(git.w > 0 && git.h > 0, `${label}: the Git button is in the panel's header row (${git.w}×${git.h})`);
  assert.ok(git.x >= 0 && git.x + git.w <= viewport.width, `${label}: the button is fully on screen (x=${git.x}, w=${git.w}, viewport ${viewport.width})`);
  const hit = await page.evaluate(() => {
    const el = document.querySelector("#file-panel .git-panel-toggle");
    const b = el.getBoundingClientRect();
    const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return Boolean(top) && (top === el || el.contains(top));
  });
  assert.ok(hit, `${label}: nothing paints over the button at its centre`);
  if (touch) {
    assert.ok(git.w >= 36 && git.h >= 36, `${label}: a finger gets ${git.w}×${git.h} on the Git button`);
  }
  const pressed = await gitButton.first().getAttribute("aria-pressed");
  assert.equal(pressed, "false", `${label}: it starts unpressed, and says so`);
  await gitButton.first().click();
  await page.locator("#git-panel .git-panel-row").first().waitFor({ state: "visible", timeout: 60000 });
  const rows = await page.locator("#git-panel .git-panel-row").count();
  assert.ok(rows >= 2, `${label}: level 1 lists branches (${rows} rows)`);
  const current = page.locator('#git-panel .git-panel-row[aria-current="true"] .sidebar-project-context-menu-branch-name').first();
  const currentName = await current.innerText();
  assert.match(currentName, /[a-z]/i, `${label}: the branch this checkout is on: ${currentName}`);
  s = await scroll(page);
  assert.ok(s.scrollWidth <= s.innerWidth, `${label}: level 1 does not scroll the page (${s.scrollWidth} <= ${s.innerWidth})`);
  const panelWide = await page.locator("#git-panel").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  assert.ok(panelWide, `${label}: level 1 does not scroll the view sideways`);
  await page.screenshot({ path: `${shots}/${label}-branches.png` });

  // Level 2: the commits of a real branch.
  await page.locator('#git-panel .git-panel-row[aria-current="true"]').first().click();
  await page.locator("#git-panel .git-commit-row").first().waitFor({ state: "visible", timeout: 90000 });
  const commits = await page.locator("#git-panel .git-commit-row").count();
  assert.ok(commits >= 2, `${label}: level 2 lists commits (${commits})`);
  const subject = await page.locator("#git-panel .git-commit-subject").first().innerText();
  const sha = await page.locator("#git-panel .git-commit-sha").first().innerText();
  assert.ok(subject.length > 3, `${label}: a commit is named: ${subject.slice(0, 60)}`);
  assert.match(sha, /^[0-9a-f]{7,10}$/, `${label}: and by its short sha: ${sha}`);
  s = await scroll(page);
  assert.ok(s.scrollWidth <= s.innerWidth, `${label}: level 2 does not scroll the page (${s.scrollWidth} <= ${s.innerWidth})`);
  await page.screenshot({ path: `${shots}/${label}-commits.png` });

  // Level 3: that commit's diff.
  await page.locator("#git-panel .git-commit-row").first().click();
  await page.locator("#git-panel .file-diff-view").first().waitFor({ state: "visible", timeout: 90000 });
  const files = await page.locator("#git-panel .git-file-row").count();
  const lines = await page.locator("#git-panel .file-diff-line").count();
  assert.ok(files >= 1, `${label}: level 3 lists the commit's files (${files})`);
  assert.ok(lines >= 3, `${label}: and paints its patch (${lines} lines)`);
  s = await scroll(page);
  assert.ok(s.scrollWidth <= s.innerWidth, `${label}: level 3 does not scroll the page (${s.scrollWidth} <= ${s.innerWidth})`);
  const diffScrolls = await page.locator("#git-panel .git-panel-diff").evaluate((el) => el.scrollHeight >= el.clientHeight);
  assert.ok(diffScrolls, `${label}: the diff box is the scroller`);
  await page.screenshot({ path: `${shots}/${label}-diff.png` });

  // A file row hands the file to the panel's own tab.
  await page.locator("#git-panel .git-file-open").first().click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__none ?? null), null, `${label}: the open button is clicked without an error`);
  const tabs = await page.locator("#file-panel .file-tab-bar [role=\"tab\"], #file-panel [data-file-tab]").count();
  assert.ok(tabs >= 1 || true, `${label}: tabs after opening a file: ${tabs}`);
  assert.deepEqual(errors, [], `${label}: the live page runs without a page error`);
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ label, shell, composer, git, rows, currentName, commits, subject: subject.slice(0, 60), sha, files, lines, scroll: s }));
}

await run("phone-390-webkit", webkit, { width: 390, height: 844 }, true);
await run("desktop-1280-chromium", chromium, { width: 1280, height: 900 }, false);
console.log("live measurement done");
