import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The right panel's Git tab, measured in a browser.
 *
 * The Git view became a tab of the panel's bar: a pinned tab that carries the
 * count of files the working tree changed, sitting beside a dirty file tab (its
 * dot), a terminal tab and the strip's own buttons. Every one of those tabs is a
 * shrink-to-fit box in a scrollable row, and a tab now carries five parts —
 * glyph, label, count, dirty dot, close `x`. Two of them are the size of a
 * glyph, so whether they ride on the row's centre line or sit on its text
 * baseline is a CSS fact, not a markup fact: a unit render cannot see it.
 *
 * So this mounts the real strip with the real stylesheets and measures, per tab,
 * that the parts share one line, that each part's vertical centre is the tab's
 * vertical centre, and that no part overlaps its neighbour. The count is also
 * asked for as 120, where it must read `99+` and not widen the tab past the cap.
 */
const out = "test-results/git-tab";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/git-tab.fixture.jsx"],
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

const MEASURE = () => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height, centerY: r.top + r.height / 2, centerX: r.left + r.width / 2 };
  };
  const textRange = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, centerY: r.top + r.height / 2 };
  };
  const intersects = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const tabs = Array.from(document.querySelectorAll(".file-tab")).map((tab) => {
    const parts = {};
    for (const key of ["file-tab-icon", "file-tab-label", "file-tab-dirty", "file-tab-badge", "file-tab-close"]) {
      const el = tab.querySelector(`.${key}`);
      if (el) parts[key] = box(el);
    }
    const label = tab.querySelector(".file-tab-label");
    const tabBox = box(tab);
    const names = Object.keys(parts);
    const offCentre = names.map((key) => ({ key, dy: Math.round((parts[key].centerY - tabBox.centerY) * 10) / 10 }));
    const boxes = names.map((key) => ({ key, ...parts[key] }));
    const overlaps = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (intersects(boxes[i], boxes[j])) overlaps.push(`${boxes[i].key} ∩ ${boxes[j].key}`);
      }
    }
    return {
      id: tab.dataset.tabId,
      label: label ? label.textContent : null,
      ariaLabel: tab.getAttribute("aria-label"),
      ariaSelected: tab.getAttribute("aria-selected"),
      isGit: tab.classList.contains("file-tab--git"),
      tab: tabBox,
      height: Math.round(tabBox.height),
      badgeText: tab.querySelector(".file-tab-badge")?.textContent ?? null,
      parts,
      labelRange: label ? textRange(label) : null,
      offCentre,
      overlaps,
      // The label is the row's text: its own box must not be taller than the tab.
      labelOverflow: label ? Math.round(box(label).height) > Math.round(tabBox.height) : null,
      badgeInsideTab: tab.querySelector(".file-tab-badge") ? parts["file-tab-badge"].right <= tabBox.right + 0.5 : null,
      badgeVsLabel: tab.querySelector(".file-tab-badge") && label
        ? intersects(parts["file-tab-badge"], textRange(label)) : null,
    };
  });
  const strip = document.querySelector(".right-panel-tab-strip");
  return {
    tabs,
    stripHeight: Math.round(strip.getBoundingClientRect().height),
    stripScrollsVertically: strip.scrollHeight > strip.clientHeight + 1,
    barHeight: Math.round(document.querySelector(".file-tab-bar").getBoundingClientRect().height),
  };
};

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 980, height: 400 } });
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

await page.goto(`http://127.0.0.1:${port}/?badge=3`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".file-tab--git");
const measured = await page.evaluate(MEASURE);
const git = measured.tabs.find((tab) => tab.isGit);

check(Boolean(git), "the Git tab is in the panel's bar");
check(git?.label === "Git", `the Git tab is named: ${git?.label}`);
check(git?.badgeText === "3", `the Git tab carries the changed-file count: ${git?.badgeText}`);
check(git?.ariaLabel === "Git view — 3 changed files", `the count is spoken: ${git?.ariaLabel}`);
check(measured.tabs.length === 4, `four tabs are mounted: ${measured.tabs.length}`);
check(measured.tabs.every((tab) => tab.height === measured.tabs[0].height),
  `the tabs share one row height: ${measured.tabs.map((tab) => tab.height).join(", ")}`);
check(!measured.stripScrollsVertically, "the strip does not grow a second row");
check(measured.tabs.every((tab) => tab.overlaps.length === 0),
  `no tab's parts overlap: ${measured.tabs.map((tab) => `${tab.id}:${tab.overlaps.join("+")}`).join(" ")}`);
check(measured.tabs.every((tab) => tab.badgeInsideTab !== false), "a count never leaves its tab");
check(measured.tabs.every((tab) => tab.badgeVsLabel !== true), "a count never paints over the label");
check(measured.tabs.every((tab) => tab.labelOverflow === false), "no label is taller than its tab");

// The centring, per part, in words that name the failure the fix is for.
for (const tab of measured.tabs) {
  for (const { key, dy } of tab.offCentre) {
    check(Math.abs(dy) <= 1, `${tab.id}: .${key} is ${dy}px off the tab's centre line (the close 'x' and the count ride the row's middle)`);
  }
}

// The tab's controls answer: picking the Git tab is the panel's exclusion, and
// its close button is the view's way out.
await page.click(".file-tab--git");
check(await page.evaluate(() => window.pickedTab) === "git:panel", "picking the Git tab selects it");
await page.click(".file-tab--git .file-tab-close");
check(await page.evaluate(() => window.closedTab) === "git:panel", "the Git tab's x closes the view");

// The cap: a three-digit count reads 99+ and the tab does not grow for it.
await page.goto(`http://127.0.0.1:${port}/?badge=120`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".file-tab--git");
const capped = await page.evaluate(MEASURE);
const gitCapped = capped.tabs.find((tab) => tab.isGit);
check(gitCapped?.badgeText === "99+", `a three-digit count caps: ${gitCapped?.badgeText}`);
check(Math.round(gitCapped.tab.width) <= Math.round(git.tab.width) + 1,
  `a bigger count does not widen the tab: ${Math.round(git.tab.width)} → ${Math.round(gitCapped.tab.width)}`);
check(gitCapped.overlaps.length === 0, `the capped count still shares the row: ${gitCapped.overlaps.join("+")}`);

await page.screenshot({ path: `${out}/tabs.png`, clip: { x: 0, y: 0, width: 980, height: 90 } });
await browser.close();
server.close();

const report = { measured, capped: capped.tabs, failures };
await writeFileReport(report);
async function writeFileReport(data) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(`${out}/report.json`, JSON.stringify(data, null, 2));
}

if (failures.length) {
  console.log(JSON.stringify(measured.tabs.map((tab) => ({ id: tab.id, height: tab.height, offCentre: tab.offCentre, overlaps: tab.overlaps })), null, 2));
  throw new Error(`the Git tab row is wrong:\n  ${failures.join("\n  ")}`);
}
console.log("e2e/git-tab.mjs: the Git tab, its count and the row's centring measure clean");
