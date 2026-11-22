import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The sidebar project fold, measured in a browser.
 *
 * The user's complaint was specific and geometric: the sessions vanished at once, and
 * the projects below jumped up half a second later. Only the element's own **height**
 * moves the siblings continuously, so this test samples the position of the group below a
 * folding project on every animation frame and asserts:
 *
 *   · the movement starts in the first frames after the click (no waiting),
 *   · it is continuous — no single frame carries a third of the distance,
 *   · the distance equals the content height, and
 *   · the rows go away only when the height has arrived (and come back as it grows).
 *
 * It bundles the real module (lib/sidebar-fold-motion.ts) and the real CSS, over the
 * sidebar's DOM contract.
 */
const out = "test-results/sidebar-fold";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/sidebar-fold.fixture.jsx"],
  bundle: true,
  platform: "browser",
  outfile: `${out}/fixture.js`,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@": process.cwd() },
  logLevel: "warning",
});
const js = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
    html,body,#root{margin:0;width:100%;height:100%}button{font:inherit}
    </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 1000 } });
page.on("pageerror", (error) => { throw error; });
await page.goto(base);
await page.waitForSelector(".sidebar-project-tree-group");

const FIRST = ".sidebar-project-tree-group:nth-of-type(1)";
const SECOND = ".sidebar-project-tree-group:nth-of-type(2)";
const TRIGGER = `${FIRST} .sidebar-project-tree-row`;

/**
 * Click and sample the group below on every frame.
 * @returns {{series: {t:number, top:number}[], clickIndex: number, height: number}}
 */
async function foldSample(trigger, target) {
  return page.evaluate(async ({ trigger, target }) => {
    const below = document.querySelector(target);
    const children = document.querySelector(`${trigger.split(" .")[0]} .sidebar-project-tree-children`);
    const height = children ? children.getBoundingClientRect().height : 0;
    const series = [];
    let stop = false;
    const tick = (now) => {
      series.push({ t: now, top: below.getBoundingClientRect().top });
      if (!stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const clickIndex = series.length;
    document.querySelector(trigger).click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    stop = true;
    return { series, clickIndex, height, startTop: series[0]?.top ?? 0 };
  }, { trigger, target });
}

/** The frames of movement that follow the click. */
function movement({ series, clickIndex }) {
  const after = series.slice(clickIndex);
  const steps = [];
  for (let index = 1; index < after.length; index += 1) {
    const delta = after[index].top - after[index - 1].top;
    if (Math.abs(delta) > 0.25) steps.push({ index, delta });
  }
  const total = Math.abs(after[after.length - 1].top - after[0].top);
  const largest = steps.reduce((max, step) => Math.max(max, Math.abs(step.delta)), 0);
  return {
    frames: after.length,
    movingFrames: steps.length,
    total,
    largest,
    firstMoveIndex: steps[0]?.index ?? -1,
    monotonic: steps.every((step) => Math.sign(step.delta) === Math.sign(after[after.length - 1].top - after[0].top)),
  };
}

const token = await page.evaluate((selector) => getComputedStyle(document.querySelector(selector))
  .getPropertyValue("--dur-fold").trim(), ".sidebar-project-tree-children");
assert.equal(token, "240ms", "the fold duration reaches the element");

// --- collapsing ---------------------------------------------------------------------

const collapse = await foldSample(TRIGGER, SECOND);
const collapseMoves = movement(collapse);
assert.ok(collapseMoves.total > collapse.height - 6,
  `the group below travels the content height (${collapseMoves.total.toFixed(1)} of ${collapse.height.toFixed(1)}px)`);
assert.ok(collapseMoves.firstMoveIndex >= 0 && collapseMoves.firstMoveIndex <= 3,
  `the movement starts in the first frames after the click (frame ${collapseMoves.firstMoveIndex})`);
assert.ok(collapseMoves.movingFrames >= 8,
  `the movement is spread over frames, not one jump (${collapseMoves.movingFrames} moving frames of ${collapseMoves.frames})`);
assert.ok(collapseMoves.largest < collapseMoves.total * 0.35,
  `no single frame carries a third of the distance (largest ${collapseMoves.largest.toFixed(1)}px of ${collapseMoves.total.toFixed(1)}px)`);
assert.ok(collapseMoves.monotonic, "the group below moves in one continuous direction");

const collapsedDom = await page.evaluate((first) => ({
  children: document.querySelectorAll(`${first} .sidebar-project-tree-children`).length,
  rows: document.querySelectorAll(`${first} .session-item`).length,
  footerTop: document.querySelector("[data-footer]").getBoundingClientRect().top,
  secondTop: document.querySelector(`${first} + .sidebar-project-tree-group`).getBoundingClientRect().top,
}), FIRST);
assert.equal(collapsedDom.children, 0, "the rows unmount once the height has arrived, not before");
assert.equal(collapsedDom.rows, 0);

// --- expanding ----------------------------------------------------------------------

const expand = await foldSample(TRIGGER, SECOND);
const expandMoves = movement(expand);
assert.ok(expandMoves.total > expand.height - 6,
  `opening carries the group below the same distance (${expandMoves.total.toFixed(1)} of ${expand.height.toFixed(1)}px)`);
assert.ok(expandMoves.firstMoveIndex >= 0 && expandMoves.firstMoveIndex <= 3,
  `opening starts at once (frame ${expandMoves.firstMoveIndex})`);
assert.ok(expandMoves.movingFrames >= 8, `opening is continuous too (${expandMoves.movingFrames} moving frames)`);
assert.ok(expandMoves.largest < expandMoves.total * 0.35,
  `no jump at the start of opening (largest ${expandMoves.largest.toFixed(1)}px)`);
assert.ok(expandMoves.monotonic, "opening grows in one continuous direction");

const expandedDom = await page.evaluate((first) => {
  const children = document.querySelector(`${first} .sidebar-project-tree-children`);
  return {
    rows: document.querySelectorAll(`${first} .session-item`).length,
    inlineHeight: children.style.height,
    dataFold: children.getAttribute("data-fold"),
    overflow: getComputedStyle(children).overflow,
  };
}, FIRST);
assert.ok(expandedDom.rows > 0, "the sessions are back");
assert.equal(expandedDom.inlineHeight, "", "the height goes back to the layout when opening settles");
assert.equal(expandedDom.dataFold, null, "no animation state lingers on the element");
assert.equal(expandedDom.overflow, "visible", "and the box stops clipping");

// --- rapid clicking -----------------------------------------------------------------
// The state here is open. Clicking twice inside one animation length is the case the
// height-of-the-moment must survive: the transition is replaced, not finished in the old
// direction, and the element ends in the state the user last asked for.

await page.evaluate((trigger) => document.querySelector(trigger).click(), TRIGGER);
await page.waitForTimeout(90);
await page.evaluate((trigger) => document.querySelector(trigger).click(), TRIGGER);
await page.waitForTimeout(600);
const reopened = await page.evaluate((first) => {
  const children = document.querySelector(`${first} .sidebar-project-tree-children`);
  return {
    children: children ? 1 : 0,
    rows: document.querySelectorAll(`${first} .session-item`).length,
    inlineHeight: children ? children.style.height : null,
    dataFold: children ? children.getAttribute("data-fold") : null,
    secondTop: document.querySelector(`${first} + .sidebar-project-tree-group`).getBoundingClientRect().top,
  };
}, FIRST);
assert.equal(reopened.children, 1, "close then open inside the animation ends open");
assert.ok(reopened.rows > 0, "with the sessions visible");
assert.equal(reopened.inlineHeight, "", "and the height handed back to the layout, not left at a pixel value");
assert.equal(reopened.dataFold, null, "no animation state lingers");
assert.ok(Math.abs(reopened.secondTop - expand.series[expand.series.length - 1].top) < 8,
  "the list below ends where the open layout puts it");

// Close, let it settle, then a rapid open→close: it must end closed with nothing mounted.
await page.evaluate((trigger) => document.querySelector(trigger).click(), TRIGGER);
await page.waitForTimeout(500);
await page.evaluate((trigger) => document.querySelector(trigger).click(), TRIGGER);
await page.waitForTimeout(60);
await page.evaluate((trigger) => document.querySelector(trigger).click(), TRIGGER);
await page.waitForTimeout(600);
const rapid = await page.evaluate((first) => ({
  children: document.querySelectorAll(`${first} .sidebar-project-tree-children`).length,
  rows: document.querySelectorAll(`${first} .session-item`).length,
  secondTop: document.querySelector(`${first} + .sidebar-project-tree-group`).getBoundingClientRect().top,
}), FIRST);
assert.equal(rapid.children, 0, "the last click was a collapse: the fold ends closed with nothing mounted");
assert.equal(rapid.rows, 0);
assert.ok(Math.abs(rapid.secondTop - collapsedDom.secondTop) < 8,
  "and the list below sits where the closed layout puts it");

const report = (label, moves, height) => console.log(
  `  ${label}: ${moves.total.toFixed(1)}px over ${moves.movingFrames}/${moves.frames} frames, `
  + `first movement at frame ${moves.firstMoveIndex}, largest frame ${moves.largest.toFixed(1)}px `
  + `(content ${height.toFixed(1)}px)`,
);
report("collapse", collapseMoves, collapse.height);
report("expand", expandMoves, expand.height);

await browser.close();
server.close();
console.log("sidebar fold: collapsing and expanding both move the list below continuously");
