import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The header's project row, measured in a browser.
 *
 * `[folder] pi-desk  [branch] feat/branch-picker-header-worktrees  [clock] 11m5s
 *  [✓] 2` — four labels, ellipsized by CSS, so only a real layout says whether a
 * label was cut and whether the labels sit where they belong. Two things used to
 * be wrong: the row's column was capped (420px) and the branch grew (`flex: 1 1 0`),
 * so the branch ellipsized with most of a window empty while the clock and the
 * counts were pushed to the far edge, inches from the branch they describe.
 *
 * The last pass puts those old rules back and expects the row to break, so the
 * measurement cannot pass by being blind.
 */
const out = "test-results/topbar-project-row";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/topbar-project-row.fixture.jsx"],
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

function serve(styles) {
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    if (req.url === "/styles.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(styles);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/**
 * The row as a browser lays it out. `gapTextClock` is measured on the branch
 * *text's* box (a Range), not the label's, because a label that grows carries its
 * empty space with it: the box can touch the clock while the words are far away.
 */
const MEASURE = () => {
  const rect = (selector) => {
    const el = document.querySelector(selector);
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width };
  };
  const label = (selector) => {
    const el = document.querySelector(selector);
    return { text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  };
  const branchText = document.querySelector(".app-topbar-branch-hit > span");
  const range = document.createRange();
  range.selectNodeContents(branchText);
  const branchWords = range.getBoundingClientRect();
  const clock = rect(".app-topbar-elapsed");
  const counts = rect(".app-topbar-subagents");
  const project = rect(".app-topbar-project");
  const tip = document.querySelector(".app-topbar-branch-tip");
  return {
    viewport: window.innerWidth,
    project: label(".app-topbar-project > span"),
    branchText: label(".app-topbar-branch-hit > span"),
    onOneLine: Math.abs(project.top - clock.top) < 4 && Math.abs(clock.top - counts.top) < 4,
    title: rect(".app-topbar-title"),
    titleText: label(".app-topbar-title > span"),
    actions: rect(".app-topbar-actions"),
    countsRight: counts.right,
    actionsLeft: rect(".app-topbar-actions").left,
    gapTextClock: Math.round(clock.left - branchWords.right),
    gapClockCounts: Math.round(counts.left - clock.right),
    branchCut: branchText.scrollWidth - branchText.clientWidth,
    titleCut: document.querySelector(".app-topbar-title > span").scrollWidth
      - document.querySelector(".app-topbar-title > span").clientWidth,
    tip: tip ? {
      label: tip.querySelector(".app-topbar-branch-tip-label").textContent,
      name: tip.querySelector(".app-topbar-branch-tip-name").textContent,
      path: tip.querySelector(".app-topbar-branch-tip-path").textContent,
      top: Math.round(tip.getBoundingClientRect().top),
      left: Math.round(tip.getBoundingClientRect().left),
      right: Math.round(tip.getBoundingClientRect().right),
      visible: getComputedStyle(tip).visibility,
    } : null,
    overflow: document.documentElement.scrollWidth,
  };
};

const browser = await chromium.launch();
const server = await serve(css);
const url = `http://127.0.0.1:${server.address().port}/`;

const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
await page.goto(url);
await page.waitForSelector(".app-topbar-branch-hit");
let wide1920 = null;

for (const width of [1920, 1200, 960, 700]) {
  await page.setViewportSize({ width, height: 900 });
  const wide = await page.evaluate(MEASURE);
  for (const [name, item] of [["project", wide.project], ["branch", wide.branchText]]) {
    assert.ok(item.scrollWidth <= item.clientWidth + 1,
      `${name} is not cut at ${width}px (${item.scrollWidth} > ${item.clientWidth}: "${item.text}")`);
  }
  assert.ok(wide.gapTextClock > 0 && wide.gapTextClock <= 40,
    `the clock sits right behind the branch's words at ${width}px (gap ${wide.gapTextClock}px)`);
  assert.ok(wide.gapClockCounts > 0 && wide.gapClockCounts <= 40,
    `the counts sit right behind the clock at ${width}px (gap ${wide.gapClockCounts}px)`);
  assert.ok(wide.onOneLine, `the four labels stay on one line at ${width}px`);
  assert.ok(wide.countsRight <= wide.actionsLeft, `the counts stay left of the bar's buttons at ${width}px`);
  assert.ok(wide.actions.right <= width, "the buttons stay on screen");
  assert.ok(wide.overflow <= width, `the row does not widen the page at ${width}px (${wide.overflow})`);
  if (width === 1920) wide1920 = wide;
}

// The tip: hover on desktop, and a tap on a phone, where the native tooltip a
// phone never shows used to be the only way to see the name.
await page.hover(".app-topbar-branch-hit");
const hovered = await page.evaluate(MEASURE);
assert.ok(hovered.tip, "hover opens the tip");
assert.equal(hovered.tip.name, "feat/branch-picker-header-worktrees", "the tip carries the whole branch name");
assert.match(hovered.tip.path, /\/Users\/lynx\/Documents\/github\/pi-desk/);
assert.equal(hovered.tip.visible, "visible");
assert.ok(hovered.tip.top >= 36 - 1, "the tip sits below the header");
assert.ok(hovered.tip.left >= 0 && hovered.tip.right <= 1920, "the tip is inside the window");
await page.mouse.move(10, 700);
assert.equal((await page.evaluate(MEASURE)).tip, null, "leaving closes the tip");

const touch = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
const phone = await touch.newPage();
await phone.goto(url);
await phone.waitForSelector(".app-topbar-branch-hit");
const phoneRow = await phone.evaluate(MEASURE);
assert.ok(phoneRow.title.width <= phoneRow.viewport * 0.8 + 1,
  `the phone cap holds (${Math.round(phoneRow.title.width)}px of ${phoneRow.viewport}px)`);
assert.ok(phoneRow.overflow <= phoneRow.viewport, `the row does not widen the phone page (${phoneRow.overflow})`);
assert.ok(phoneRow.onOneLine, "a phone keeps the four labels on one line (the header does not stack)");
assert.ok(phoneRow.project.scrollWidth <= phoneRow.project.clientWidth + 1, "the project still reads on a phone");
assert.ok(phoneRow.branchCut > 0, "the branch is the label a phone's row cuts — the tip is the way to read it");
await phone.tap(".app-topbar-branch-hit");
const tapped = await phone.evaluate(MEASURE);
assert.ok(tapped.tip, "a tap opens the tip on a phone");
assert.equal(tapped.tip.name, "feat/branch-picker-header-worktrees", "the tap gives the whole name the row cut");
assert.ok(tapped.tip.right <= 390 && tapped.tip.left >= 0, "the tip fits the phone's width");
await phone.keyboard.press("Escape");
assert.equal((await phone.evaluate(MEASURE)).tip, null, "Escape closes the tip");
await touch.close();

// The controls: the two rules that produced the photographs.
// A — the 760px cap with a growing branch: the row filled its column, so the clock and
// the counts sat at the far edge, inches from the branch they describe (pic1).
const grew = await serve(`${css}\n.app-topbar-title { max-width: 760px !important; }\n.app-topbar-branch { flex: 1 1 0 !important; }\n`);
await page.setViewportSize({ width: 1920, height: 900 });
await page.goto(`http://127.0.0.1:${grew.address().port}/`);
await page.waitForSelector(".app-topbar-branch-hit");
const stranded = await page.evaluate(MEASURE);
grew.close();
assert.ok(stranded.branchCut <= 1, `the branch reads fully in that layout (${stranded.branchCut})`);
assert.ok(stranded.gapTextClock > 150, `the growing branch strands the clock (${stranded.gapTextClock}px away)`);

// B — the 240px cap a 1120px window used to get: `pi-desk  fe…` with most of the bar free (pic3).
const capped = await serve(`${css}\n.app-topbar-title { max-width: 200px !important; }\n`);
await page.setViewportSize({ width: 960, height: 900 });
await page.goto(`http://127.0.0.1:${capped.address().port}/`);
await page.waitForSelector(".app-topbar-branch-hit");
const cut = await page.evaluate(MEASURE);
capped.close();
assert.ok(cut.branchCut > 40, `a 200px column cuts the branch to a stub (${cut.branchCut}px lost)`);

await browser.close();
server.close();
console.log(`topbar row: project, branch, clock and counts read fully and sit together at 1920/1200/960/700px (clock ${wide1920.gapTextClock}px behind the branch's words); a tap on a 390px phone opens the tip with the whole name; the old 760px cap left the clock ${stranded.gapTextClock}px away and the old 200px cap cut ${cut.branchCut}px of the branch`);
