import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The header's project row, measured in a browser.
 *
 * `[folder] pi-desk  [branch] feat/branch-picker-header-worktrees  [clock]  [✓] 2`
 * is ellipsized by CSS, so only a real layout says whether a label was cut. The
 * row sits inside `.app-topbar-title`, whose `max-width` used to be 420px: a
 * window of 1440px showed `feat/branch-picker-header-…` with most of the bar
 * empty. This mounts the header's markup with the app's real CSS at desktop and
 * phone widths, and its last pass puts the 420px cap back to prove the
 * measurement sees the truncation it was written for.
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
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const MEASURE = () => {
  const label = (selector) => {
    const el = document.querySelector(selector);
    return { text: el.textContent, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, width: el.getBoundingClientRect().width };
  };
  const rect = (selector) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  };
  return {
    project: label(".app-topbar-project > span"),
    branch: label(".app-topbar-branch > span"),
    title: rect(".app-topbar-title"),
    actions: rect(".app-topbar-actions"),
    subagents: rect(".app-topbar-subagents"),
    overflow: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const server = await serve(css);
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector(".app-topbar-branch");
const wide = await page.evaluate(MEASURE);

for (const [name, label] of [["project", wide.project], ["branch", wide.branch]]) {
  assert.ok(label.scrollWidth <= label.clientWidth + 1,
    `${name} is not cut at ${wide.viewport}px (${label.scrollWidth} > ${label.clientWidth}: "${label.text}")`);
  assert.ok(label.width > 0, `${name} has a box`);
}
assert.ok(wide.title.width <= 761, `the title column stays inside its cap (${Math.round(wide.title.width)}px)`) ;
assert.ok(wide.actions.right <= wide.viewport, `the bar's buttons stay on screen (${Math.round(wide.actions.right)})`);
assert.ok(wide.subagents.right <= wide.viewport, "the subagent chip stays on screen");

// A phone keeps the small caps: the row must not widen the page.
await page.setViewportSize({ width: 390, height: 780 });
const phone = await page.evaluate(MEASURE);
assert.ok(phone.title.width <= phone.viewport * 0.64 + 1,
  `the phone cap holds (${Math.round(phone.title.width)}px of ${phone.viewport}px)`);
assert.ok(phone.overflow <= phone.viewport, `the row does not widen the page (${phone.overflow})`);

// The control: the 420px cap that used to be there cuts the branch at desktop.
const capped = await serve(`${css}\n.app-topbar-title { max-width: 420px; }\n`);
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`http://127.0.0.1:${capped.address().port}/`);
await page.waitForSelector(".app-topbar-branch");
const old = await page.evaluate(MEASURE);
capped.close();
assert.ok(old.branch.scrollWidth > old.branch.clientWidth + 1,
  "the check can see the bug: a 420px column truncates the same branch name");

await browser.close();
server.close();
console.log(`topbar row: ${wide.project.text} + ${wide.branch.text} fit at ${wide.viewport}px (title ${Math.round(wide.title.width)}px); phone ${Math.round(phone.title.width)}px; the 420px cap cut ${Math.round(old.branch.scrollWidth - old.branch.clientWidth)}px of the branch`);
