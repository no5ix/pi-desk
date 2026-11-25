import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
/**
 * The composer's project menu, measured in a browser.
 *
 * The list is the composer's longest menu (every recent project, and on a phone one 44px
 * row per project), and it hangs above the chip. Capped only by its own `min(60vh, 420px)`,
 * it grew past the top of the chat window — `.chat-window` is `overflow: hidden` and its box
 * starts under the app topbar — and the topbar, which is drawn above the chat column,
 * covered the leading rows: the filter, the current project, and the first projects of the
 * list were unreachable (#63 is the same rule for the slash and file-mention menus).
 *
 * A unit render cannot see this: the covering is layout and paint order. So the real chip
 * is mounted in the app's real chrome with the app's real stylesheet, on a phone and on a
 * desktop, and every row is asked whether its box is below the header and inside the window.
 * The last pass serves the fixture with the markup that shipped before the fix and expects
 * to measure the covered rows: a check that cannot see its own bug is not a check.
 *
 * Run: `node e2e/project-chip-menu.mjs` (it starts its own static server and browser).
 */
const out = "test-results/project-chip-menu";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/project-chip-menu.fixture.jsx"],
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
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    if (req.url === "/styles.css") {
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

/** Every row of the open menu, asked where it landed. */
const MEASURE = () => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const panel = document.querySelector(".composer-project-menu");
  const chip = document.querySelector(".chat-project-context");
  const topbar = document.querySelector(".app-topbar");
  const column = document.querySelector(".chat-window");
  const list = panel.querySelector(".app-menu-list") ?? panel;
  const topbarBox = box(topbar);
  const columnBox = box(column);
  // A row is reachable when it is painted: inside the window, inside the chat window's
  // box (the clipper that cuts an over-tall menu), and below the topbar that paints over it.
  const visible = (b) => b.top >= topbarBox.bottom - 0.5
    && b.bottom <= window.innerHeight + 0.5
    && b.top >= columnBox.top - 0.5;
  const rows = Array.from(panel.querySelectorAll('[role="menuitem"]')).map((row) => {
    const b = box(row);
    return { label: row.textContent.trim(), ...b, visible: visible(b) };
  });
  return {
    panel: box(panel),
    chip: box(chip),
    topbar: topbarBox,
    column: columnBox,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    list: { scrollHeight: list.scrollHeight, clientHeight: list.clientHeight },
    rows,
  };
};

async function openMenu(page, query) {
  const server = await serve();
  await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
  await page.click(".chat-project-context");
  await page.waitForSelector(".composer-project-menu [role=\"menuitem\"]");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return server;
}

const browser = await chromium.launch();

/** The fixed menu on one viewport: every row painted, below the header, inside the window. */
async function checkFixed(label, viewport, query) {
  const page = await browser.newPage({ viewport });
  const server = await openMenu(page, query);
  const measured = await page.evaluate(MEASURE);
  const panel = measured.panel;
  const { topbar, column, chip, rows, list } = measured;

  assert.ok(rows.length >= 12, `${label}: the whole project list renders (${rows.length})`);
  assert.ok(panel.bottom <= chip.top + 0.5,
    `${label}: the menu hangs above the chip that opened it (${panel.bottom.toFixed(1)} over ${chip.top.toFixed(1)})`);
  assert.ok(panel.top >= topbar.bottom - 0.5,
    `${label}: the menu stops at the header (${panel.top.toFixed(1)} >= ${topbar.bottom.toFixed(1)})`);
  assert.ok(panel.top >= column.top - 0.5,
    `${label}: nothing is cut by the chat window's own box (${panel.top.toFixed(1)} >= ${column.top.toFixed(1)})`);
  assert.ok(panel.left >= column.left - 0.5 && panel.right <= column.right + 0.5,
    `${label}: the menu stays inside the conversation column (${panel.left.toFixed(1)}…${panel.right.toFixed(1)} of ${column.left.toFixed(1)}…${column.right.toFixed(1)})`);
  // The leading rows are the ones the report was about: the current project and the
  // projects ahead of it, which the old panel grew up behind the header.
  assert.ok(rows[0].visible, `${label}: the current project's row is painted (${rows[0].label}, top ${rows[0].top.toFixed(1)})`);
  assert.ok(rows[1].visible, `${label}: the row after it is painted (${rows[1].label})`);
  // The list is longer than the space, so it scrolls internally — and scrolling reaches
  // the projects at its far end.
  assert.ok(list.scrollHeight > list.clientHeight,
    `${label}: the long list scrolls inside the panel (${list.scrollHeight} of ${list.clientHeight})`);
  const covered = rows.filter((row) => !row.visible);
  assert.ok(covered.length <= rows.length - 6,
    `${label}: most of the list is on screen (${rows.length - covered.length} of ${rows.length})`);
  await page.evaluate(() => {
    const panelEl = document.querySelector(".composer-project-menu");
    const listEl = panelEl.querySelector(".app-menu-list") ?? panelEl;
    listEl.scrollTop = listEl.scrollHeight;
  });
  const scrolled = await page.evaluate(MEASURE);
  const last = scrolled.rows[scrolled.rows.length - 1];
  assert.ok(last.visible, `${label}: scrolling reaches the last project (${last.label}, top ${last.top.toFixed(1)})`);
  await page.screenshot({ path: `${out}/${label}.png` });
  await page.close();
  server.close();
  return { panel, topbar, column, rows, list };
}

const phone = await checkFixed("phone", { width: 440, height: 956 }, "shell=480");
const desktop = await checkFixed("desktop", { width: 1280, height: 800 }, "shell=800");

/** The same fixture on the pre-fix markup: the check must see the covered rows. */
const brokenPage = await browser.newPage({ viewport: { width: 440, height: 956 } });
const brokenServer = await openMenu(brokenPage, "shell=480&broken=1");
const broken = await brokenPage.evaluate(MEASURE);
await brokenPage.screenshot({ path: `${out}/broken.png` });
await brokenPage.close();
brokenServer.close();

assert.ok(broken.panel.top < broken.topbar.bottom - 0.5,
  "the control pass must open into the header — the check has to see the bug it was written for");
const brokenCovered = broken.rows.filter((row) => !row.visible);
assert.ok(brokenCovered.length >= 1,
  `the control pass covers a row (${brokenCovered.length} of ${broken.rows.length})`);
assert.ok(broken.rows[0].top < broken.column.top - 0.5,
  `the control pass cuts the leading row at the chat window's edge (${broken.rows[0].top.toFixed(1)} above ${broken.column.top.toFixed(1)})`);

await browser.close();
console.log(
  `project chip menu: ${phone.rows.length} projects hang above the composer's chip; on a 440x956 phone the panel `
  + `starts at ${phone.panel.top.toFixed(0)}px, at or below the ${phone.topbar.bottom.toFixed(0)}px header, with `
  + `${phone.rows.filter((row) => row.visible).length} rows painted and the list scrolling to the last one; on a `
  + `1280x800 desktop it starts at ${desktop.panel.top.toFixed(0)}px inside the column; the pre-fix panel opened at `
  + `${broken.panel.top.toFixed(0)}px, under the ${broken.topbar.bottom.toFixed(0)}px header, with `
  + `${brokenCovered.length} rows covered`,
);
