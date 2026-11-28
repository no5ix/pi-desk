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
  // The server answers per remote (`{ remote, branches: ["main"] }`), so the row
  // is named by the short branch, and a `feat/…` remote is a folder like a local
  // one. Asserted here because the fixture and the component once agreed with
  // each other instead of with the server, and the panel crashed on the first
  // click of the Git button.
  const remoteSection = page.locator('.git-tree-section:has(.git-tree-section-title:text-is("Remote"))');
  const remoteText = (await remoteSection.allInnerTexts()).join("\n");
  assert.ok(remoteText.includes("preview"), `${label}: the remote rows are named by the branch, not by origin/preview`);
  assert.ok(remoteText.includes("remote-only"), `${label}: a feat/… remote branch is a leaf inside the feat folder`);
  assert.ok(remoteText.includes("feat"), `${label}: the remote tree has the feat folder`);
  assert.ok(!remoteText.includes("origin/"), `${label}: the remote prefix is not painted into the row`);
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
  await page.waitForSelector("#git-panel .git-log-row");
  const commits = page.locator("#git-panel .git-log-row");
  assert.ok(await commits.count() >= 2, `${label}: the commit list has rows (${await commits.count()})`);
  assert.ok(await page.locator("#git-panel .git-log-hash").first().innerText() !== "", `${label}: a row shows the short hash`);
  assert.ok(await page.locator("#git-panel .git-graph-layer").count() === 1, `${label}: the graph is drawn behind the list`);
  await expectNoSidewaysScroll(page, label, "the commit list");
  if (touch) {
    // The commit row is the graph's grid (28-32px), not a thumb's plate; the
    // control inside it is. Measured as what it is.
    const commitRow = await box(page, "#git-panel .git-log-row");
    assert.ok(commitRow.h >= 32, `${label}: a commit row is at least the grid's 32 (${commitRow.h})`);
    await touchPlates(page, label, ["#git-panel .git-row-menu-button", "#git-panel .git-icon-button"]);
  }

  // ─── level 3: one commit, its files and its diff ───
  await page.locator('#git-panel .git-log-row:has-text("memory sampler")').first().click();
  await page.waitForSelector("#git-panel .git-file-row");
  assert.equal(await page.locator("#git-panel .git-file-row").count(), 2, `${label}: the commit lists the files it touched`);
  // Picking a file is how its diff arrives. The stacked phone keeps the detail
  // below the fold, so the patch is asserted where the columns sit side by side.
  const detail = await page.locator("#git-panel").innerText();
  assert.match(detail, /LogPanel\.tsx/, `${label}: the commit detail names the file`);
  if (!touch) {
    await page.locator("#git-panel .git-file-row").first().click();
    await page.waitForSelector("#git-panel .file-diff-line", { timeout: 5_000 }).catch(() => null);
    const withPatch = await page.locator("#git-panel").innerText();
    // The view is built from hunks (the `@@` header is consumed as the hunk's
    // marker), so the assertion reads the lines it drew.
    assert.ok(await page.locator("#git-panel .file-diff-line").count() >= 2, `${label}: the picked file shows its diff`);
    assert.match(withPatch, /--git-lane-1: var\(--ansi-blue\)/, `${label}: the diff shows the added line`);
  }
  await expectNoSidewaysScroll(page, label, "the commit detail");

  // ─── the detail reads in two columns, and a long message stays in its box ───
  const message = await box(page, "#git-panel .git-commit-detail-message");
  const files = await box(page, "#git-panel .git-commit-files");
  const panelBox = await box(page, "#git-panel");
  assert.ok(files.x >= message.x + message.w - 1,
    `${label}: the message and its FILES are columns beside each other (message ${message.x}+${message.w}, files x=${files.x})`);
  const divider = await page.locator("#git-panel .git-commit-files")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).borderLeftWidth));
  assert.ok(divider >= 1, `${label}: a divider separates the message from the files (${divider}px)`);
  const detailBox = await page.locator("#git-panel .git-commit-detail-message").evaluate((el) => ({
    scrolls: el.scrollHeight > el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
    bottom: el.getBoundingClientRect().bottom,
  }));
  assert.ok(detailBox.scrolls && detailBox.overflowY === "auto",
    `${label}: a long commit message scrolls in its own box (scrolls ${detailBox.scrolls}, ${detailBox.overflowY})`);
  assert.ok(detailBox.bottom <= panelBox.y + panelBox.h + 1,
    `${label}: the message does not run out under the window's bar (bottom ${detailBox.bottom}, panel ${Math.round(panelBox.y + panelBox.h)})`);
  const panelText = await page.locator("#git-panel").innerText();
  assert.ok(!/Pick a file to read its diff/.test(panelText), `${label}: the empty diff area says nothing`);

  // ─── a branch and its remote, at the same checkpoint, are one chip ───
  const syncedRow = page.locator("#git-panel .git-log-row:has(.git-ref-chip.is-synced)").first();
  assert.equal(await syncedRow.locator(".git-ref-chip").count(), 2,
    `${label}: the branch and its remote are one chip, not two (${await syncedRow.locator(".git-ref-chip").count()} chips on that row)`);
  const synced = syncedRow.locator(".git-ref-chip.is-synced");
  assert.equal(await synced.count(), 1, `${label}: one chip carries the pair`);
  assert.equal((await synced.first().innerText()).trim(), "origin & feat/synced-branch",
    `${label}: the chip says origin & the branch`);
  const syncedBorder = await synced.first().evaluate((el) => getComputedStyle(el).borderTopColor);
  assert.equal(syncedBorder, "rgb(205, 193, 45)", `${label}: the synced chip's border is the asked-for colour (${syncedBorder})`);

  // ─── right click is the browser's, not the panel's ───
  // (The phone shows one Git view at a time, so a branch row is only reachable
  // where the branch tree is up; `panel-reports.test.mjs` 6 checks both sources.)
  if (!touch) {
    for (const [what, selector] of [["a commit row", "#git-panel .git-log-row"], ["a branch row", "#git-panel .git-branch-row:not(.is-group)"]]) {
      await page.locator(selector).first().click({ button: "right" });
      await page.waitForTimeout(150);
      const menus = await page.locator(".native-popover.app-menu, #git-panel .git-menu").count();
      assert.equal(menus, 0, `${label}: right click on ${what} opens no git menu (the browser's own menu belongs to the user)`);
    }
  }

  // The phone layout shows one Git view at a time, so the branch list is off screen
  // once a branch was picked; the filter is exercised where both views are up.
  if (!touch) {
    // ─── picking a branch is `git log <branch>`; × puts every branch back ───
    // The level-2 branch click already set a filter; clear it first, and read the
    // query the panel sends — that is where "show this branch's commits" lives.
    if (await page.locator("#git-panel .git-chip-clear").count()) {
        await page.evaluate(() => { window.__logQueries = []; });
        await page.locator("#git-panel .git-chip-clear").first().click();
        await page.waitForTimeout(300);
        assert.equal((await page.evaluate(() => window.__logQueries.at(-1)))?.branch, undefined,
            `${label}: × asks for every branch again`);
        assert.equal(await page.locator("#git-panel .git-filter-chips .git-chip").count(), 0, `${label}: × takes the branch chip away`);
    }
    const allRows = await page.locator("#git-panel .git-log-row").count();
    await page.evaluate(() => { window.__logQueries = []; });
    await page.locator('#git-panel .sidebar-project-context-menu-branch-name:text-is("git-view")').first().click();
    await page.waitForTimeout(300);
    const asked = await page.evaluate(() => window.__logQueries.map((query) => ({ branch: query.branch, search: query.search })));
    assert.equal(asked.at(-1)?.branch, "feat/panel/git-view", `${label}: the log is asked for that branch's commits (asked: ${JSON.stringify(asked.at(-1))})`);
    const chip = page.locator("#git-panel .git-filter-chips .git-chip");
    assert.ok((await chip.first().innerText()).includes("git-view"), `${label}: the picked branch shows as the filter`);
    // The chip belongs to the row that names the view (`Commits 200`), not to a row
    // of its own: a row under the title cost the log a line of commits.
    const chipRow = await page.evaluate(() => {
      const header = document.querySelector("#git-panel .git-panel-section-header");
      const chipEl = document.querySelector("#git-panel .git-filter-chips .git-chip");
      const h = header?.getBoundingClientRect();
      const c = chipEl?.getBoundingClientRect();
      return h && c ? { sameRow: c.top >= h.top - 1 && c.bottom <= h.bottom + 1, headerHeight: Math.round(h.height) } : null;
    });
    assert.ok(chipRow?.sameRow, `${label}: the branch chip is on the Commits row (${JSON.stringify(chipRow)})`);

    // ─── the filter row, and the date a commit is read by ───
    await page.locator("#git-panel .git-log-panel .git-panel-section-header .git-icon-button").first().click();
    await page.waitForSelector("#git-panel .git-filter-row", { timeout: 5_000 });
    const filterGap = await page.evaluate(() => {
      const row = document.querySelector("#git-panel .git-filter-row");
      const above = row?.previousElementSibling?.getBoundingClientRect();
      // The reading gap: the field's own edge under the rule, not the row box,
      // whose padding is the space.
      const field = row?.querySelector(".git-search-input")?.getBoundingClientRect();
      return field && above ? Math.round(field.top - above.bottom) : null;
    });
    assert.ok(filterGap !== null && filterGap >= 6, `${label}: the search row is not flush against the row above (${filterGap}px)`);
    // The column says when, not “14h”: a commit list is read across a week.
    const dateText = (await page.locator("#git-panel .git-log-date").first().innerText()).trim();
    assert.match(dateText, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, `${label}: the row states the date and the time (${dateText})`);
    const filteredRows = await page.locator("#git-panel .git-log-row").count();
    assert.ok(filteredRows < allRows, `${label}: the list is that branch's history, not every branch's (${filteredRows} of ${allRows})`);
    const firstSubject = (await page.locator("#git-panel .git-log-subject").first().innerText()).trim();
    assert.match(firstSubject, /memory sampler/, `${label}: the branch's own tip is the first row (${firstSubject})`);

    await page.locator("#git-panel .git-chip-clear").first().click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#git-panel .git-filter-chips .git-chip").count(), 0, `${label}: × takes the branch chip away`);
    assert.equal((await page.evaluate(() => window.__logQueries.at(-1)))?.branch, undefined, `${label}: × asks for every branch again`);
    assert.equal(await page.locator("#git-panel .git-log-row").count(), allRows, `${label}: × puts the whole history back (${allRows} rows)`);

  }

  // The search box and the project list are asserted in
  // `components/git/panel-reports.test.mjs` (9, 10): the search's contract is the
  // `search` it puts on the log query, and the switcher's is the list it renders.
  // Here, opening the filter row above an open commit detail leaves the virtualised
  // list too short to paint a row — that measures the layout, not the filter, and
  // the `?wide=1` pass below is where the rendered list is measured.


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

/**
 * A repository the size of a real one: eighteen lanes, two hundred commits.
 *
 * The four-commit fixture cannot show this layout, and that is how the commit
 * rows shipped broken: the row class was shared with the project panel's
 * two-line commit list, so the log row was a column — the subject at zero
 * height, the sha on top of the author, no message on screen. A wide page also
 * makes the graph's fixed width a lie: eighteen lanes need 192px, not 76.
 */
async function wideLog(label, { width, height, theme, touch }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => { pageErrors.push(`${label} (wide): ${error.message}`); if (process.env.GIT_PANEL_DEBUG) console.log("PAGEERROR", label, error.message.slice(0, 200)); });
  await page.goto(`${url}?theme=${theme}&wide=1&commits=200&lanes=18`);
  await page.waitForSelector("#git-panel", { timeout: 15_000 });
  if (touch) {
    // On a phone the panel is one column at a time, and it opens on the branches:
    // picking one switches to the log and filters it in the same act.
    await page.locator("#git-panel .git-branch-row:not(.is-group)").first().click();
  }
  await page.waitForSelector("#git-panel .git-log-row", { timeout: 15_000 });
  await page.waitForTimeout(400);
  if (!touch) {
    // The reported action, on a desktop panel: pick a branch, read its commits.
    await page.locator("#git-panel .git-branch-row:not(.is-group)").first().click();
    await page.waitForTimeout(400);
  }

  const rows = await page.evaluate(() => {
    const row = document.querySelector(".git-log-row");
    const graph = document.querySelector(".git-graph-layer");
    const scroll = document.querySelector(".git-log-scroll");
    const children = [...row.children].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { cls: el.className.toString(), display: cs.display, position: cs.position, top: el.offsetTop, left: el.offsetLeft, x: r.x, right: r.right, w: r.width, h: r.height, text: (el.textContent ?? "").trim().slice(0, 24) };
    });
    const indent = Number.parseFloat(getComputedStyle(row).paddingLeft);
    return {
      painted: document.querySelectorAll(".git-log-row").length,
      rowWidth: Math.round(row.getBoundingClientRect().width),
      indent,
      graphWidth: graph ? Math.round(graph.getBoundingClientRect().width) : 0,
      scrollWidth: Math.round(scroll.getBoundingClientRect().width),
      subjectText: (document.querySelector(".git-log-subject")?.textContent ?? "").trim(),
      children,
    };
  });

  assert.ok(rows.painted >= 10, `${label} (wide): a long list is virtualised, ${rows.painted} rows painted of 200`);
  assert.ok(rows.subjectText.startsWith("commit 0"), `${label} (wide): the subject is on screen — "${rows.subjectText.slice(0, 30)}"`);

  // One line, no overlap: the columns of a commit row are one line of reading.
  // A phone drops the author and the date on purpose (the subject is the row's
  // reason); anything else that vanishes is a layout that lost a column.
  const line = rows.children.filter((child) => child.cls.includes("git-log") || child.cls.includes("git-row-menu"));
  const hidden = line.filter((child) => child.display === "none").map((child) => child.cls);
  for (const cls of hidden) {
    assert.ok(cls === "git-log-author" || cls === "git-log-date", `${label} (wide): ${cls} is hidden, and only the author and the date may be`);
  }
  const shown = line.filter((child) => child.display !== "none");
  for (const child of shown) {
    assert.ok(child.h >= 14, `${label} (wide): ${child.cls} has a height (${child.h}) — a column collapsed to nothing`);
  }
  // The row's menu button is pinned to the row's right edge (it is absolutely
  // placed, so a row of thirty pixels can carry a control of thirty-six). It is
  // not one of the reading columns.
  const flow = shown.filter((child) => child.position !== "absolute");
  // They share a line: the centres align. A touch control is 36 in a 28-pixel
  // row (the plate rule), so `offsetTop` alone would call that a second line.
  const subject = flow.find((child) => child.cls.includes("git-log-subject"));
  const middle = subject.top + subject.h / 2;
  for (const child of flow) {
    const centre = child.top + child.h / 2;
    assert.ok(Math.abs(centre - middle) <= 4,
      `${label} (wide): ${child.cls} is on the subject's line (centre ${centre.toFixed(1)} against ${middle.toFixed(1)})`);
  }
  const ordered = [...flow].sort((a, b) => a.left - b.left);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    assert.ok(current.x >= previous.right - 1,
      `${label} (wide): ${previous.cls} and ${current.cls} do not overlap (${previous.right} > ${current.x})`);
  }

  // The graph is as wide as the lanes, and the row is indented by the same number.
  assert.ok(Math.abs(rows.indent - rows.graphWidth) < 1.5,
    `${label} (wide): the row's indent (${rows.indent}) is the graph's width (${rows.graphWidth})`);
  const budget = Math.max(36, Math.floor(rows.scrollWidth * 0.42));
  assert.ok(rows.graphWidth <= Math.min(206, budget) + 1,
    `${label} (wide): the graph takes at most its cap and 42% of the panel (${rows.graphWidth} of ${rows.scrollWidth})`);
  const lanes = 18;
  assert.ok(rows.graphWidth >= Math.min(lanes * 10 + 12, Math.min(206, budget)) - 1,
    `${label} (wide): eighteen lanes are given their width, up to the budget (${rows.graphWidth})`);
  assert.ok(subject.w >= 60, `${label} (wide): the subject keeps room beside the graph (${subject.w})`);

  // The reported action: pick a branch, read its commits. The filter goes on the
  // log, the graph is re-laid from that ref, and the rows must stay what they
  // are — one line each, with the subject.
  const afterBranch = await page.evaluate(() => {
    const row = document.querySelector(".git-log-row");
    if (!row) return null;
    const chips = [...document.querySelectorAll(".git-filter-chips .git-chip")].map((el) => el.textContent.trim());
    const children = [...row.children]
      .map((el) => ({ cls: el.className.toString(), display: getComputedStyle(el).display, x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right }))
      .filter((child) => child.display !== "none")
      .sort((a, b) => a.x - b.x);
    return {
      chips,
      rows: document.querySelectorAll(".git-log-row").length,
      subject: (document.querySelector(".git-log-subject")?.textContent ?? "").trim(),
      overlap: children.some((child, index) => index > 0 && child.x < children[index - 1].right - 1),
    };
  });
  assert.ok(afterBranch, `${label} (wide): a branch's log still has rows after the branch is picked`);
  assert.ok(afterBranch.chips.length >= 1, `${label} (wide): the picked branch shows as the log's filter (${afterBranch.chips.join(",")})`);
  assert.ok(afterBranch.subject.startsWith("commit"), `${label} (wide): the subject is readable after the branch is picked ("${afterBranch.subject.slice(0, 24)}")`);
  assert.ok(!afterBranch.overlap, `${label} (wide): the columns do not overlap after the branch is picked`);

  await expectNoSidewaysScroll(page, `${label} (wide)`, "a wide repository");
  await page.screenshot({ path: `${out}/${label.replace(/[^a-z0-9]+/gi, "-")}-wide.png`, fullPage: false });
  await context.close();
}

await wideLog("desktop", { width: 1440, height: 900, touch: false, theme: "light" });
await wideLog("desktop-dark", { width: 1440, height: 900, touch: false, theme: "dark" });
await wideLog("phone", { width: 390, height: 844, touch: true, theme: "light" });
await wideLog("narrow-window", { width: 900, height: 700, touch: false, theme: "light" });

await browser.close();
server.close();

assert.deepEqual(pageErrors, [], "the panel runs without page errors");
console.log(JSON.stringify(results, null, 2));
