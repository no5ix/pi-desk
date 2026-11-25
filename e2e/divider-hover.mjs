import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * Sliding the pointer over a panel divider must not light the divider up.
 *
 * The user's complaint: hovering the line between the sidebar (or the right panel)
 * and the conversation made that line brighter. The visible line is the panels' own
 * hairline; `.panel-resize-handle` is a 12px invisible hit target that only widens
 * the grab, and upstream (app/globals.css, byte-identical) tints its `::after` on
 * `:hover` — so the separator got a highlight on top of itself. The fork keeps the
 * tint for the two states that say "this target is live": keyboard focus (the
 * separator is tabbable and resizes with the arrows) and an active drag.
 *
 * Measured in a real browser, in both themes, from the computed `::after` of the
 * shell's own markup: rest, hover, keyboard focus, drag. The control pass injects
 * upstream's declaration verbatim and shows a tint, so the assertions below are not
 * blind — a source grep cannot tell a hover tint from a focus tint, and the cascade
 * (the right panel's pair above 960px carries `!important`) is what decides it.
 */
const out = "test-results/divider-hover";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/divider-hover.fixture.jsx"],
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

/**
 * A computed colour, however Chromium serialises it, → `{ red, green, blue, alpha }`.
 *
 * Chromium prints a `color-mix(in srgb, …)` as `oklab(0.27 0.0008 -0.0029 / 0.031)`,
 * so the alpha is the number after the `/` and the three before it are the channels.
 */
function parseColor(value) {
  const text = String(value).trim();
  const body = text.replace(/^[a-z-]+\(|\)$/g, "");
  const slash = body.lastIndexOf("/");
  if (slash > -1) {
    const nums = body.slice(0, slash).match(/[-\d.e+]+/g)?.map(Number) ?? [];
    const alpha = Number(body.slice(slash + 1).match(/[-\d.e+]+/)?.[0]);
    return { red: nums[0], green: nums[1], blue: nums[2], alpha };
  }
  const parts = body.split(/[\s,]+/).map(Number);
  return { red: parts[0], green: parts[1], blue: parts[2], alpha: parts.length > 3 ? parts[3] : 1 };
}

/** Every divider, as the compositor paints it, plus which one has keyboard focus. */
const HANDLES = [
  { selector: '[data-resize-handle="sidebar"]', label: "sidebar / conversation" },
  { selector: '[data-resize-handle="right-panel"]', label: "conversation / right panel" },
  { selector: '[data-resize-handle="file-tree"]', label: "file tree / file viewer" },
];

const measure = () => {
  const rows = {};
  for (const { selector, label } of window.__HANDLES) {
    const el = document.querySelector(selector);
    const after = getComputedStyle(el, "::after");
    rows[selector] = { label, background: after.backgroundColor, width: after.width, opacity: after.opacity };
  }
  return {
    rows,
    focused: document.activeElement?.getAttribute?.("data-resize-handle") ?? null,
    dark: document.documentElement.classList.contains("dark"),
  };
};

const browser = await chromium.launch();
// 1200px: the right panel's divider pair lives in `@media (min-width: 960px)`.
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
await page.addInitScript((handles) => { window.__HANDLES = handles; }, HANDLES);

const away = async () => { await page.mouse.move(4, 4); await page.waitForTimeout(220); };
/** The palette's own idle separator, for reference. */
const UPSTREAM_HOVER = ".panel-resize-handle:hover::after { background: color-mix(in srgb, var(--text-muted) 70%, var(--border)); }";

for (const theme of ["light", "dark"]) {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('[data-resize-handle="sidebar"]');
  if (theme === "dark") {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
  }
  await away();
  const rest = await page.evaluate(measure);
  assert.equal(rest.dark, theme === "dark", `${theme}: the theme is applied`);

  // 1. At rest the handle paints nothing and the line stays the fork's 1px.
  for (const { selector, label } of HANDLES) {
    const row = rest.rows[selector];
    assert.equal(parseColor(row.background).alpha, 0,
      `${theme}: the ${label} divider paints no overlay of its own (${row.background})`);
    assert.equal(row.width, "1px", `${theme}: the ${label} divider's line is the 1px hairline (${row.width})`);
  }

  // 2. Hover: byte for byte the rest state. This is the user's complaint.
  for (const { selector, label } of HANDLES) {
    await page.hover(selector);
    await page.waitForTimeout(220);
    const hovered = (await page.evaluate(measure)).rows[selector];
    assert.equal(hovered.background, rest.rows[selector].background,
      `${theme}: hovering the ${label} divider leaves the line exactly as it was (${hovered.background})`);
    assert.equal(parseColor(hovered.background).alpha, 0,
      `${theme}: the ${label} divider is not highlighted on hover (${hovered.background})`);
    const box = await page.locator(selector).boundingBox();
    await page.screenshot({ path: `${out}/${theme}-hover-${selector.replace(/[^a-z]/g, "")}.png`, clip: { x: box.x - 40, y: box.y, width: box.width + 80, height: Math.min(box.height, 320) } });
    await away();
  }

  // 3. The control pass: upstream's declaration, injected verbatim, does tint. Had
  //    the fork's override not landed, assertion 2 above would fail.
  const tag = await page.addStyleTag({ content: UPSTREAM_HOVER });
  await page.hover('[data-resize-handle="sidebar"]');
  await page.waitForTimeout(220);
  const upstream = parseColor((await page.evaluate(measure)).rows['[data-resize-handle="sidebar"]'].background);
  assert.ok(upstream.alpha > 0,
    `${theme}: the control pass — upstream's hover tint is visible to this harness (${upstream.alpha})`);
  await tag.evaluate((el) => el.remove());
  await away();

  // 4. The states that stay lit: keyboard focus (the separator is tabbable and the
  //    arrows resize it) and an active drag. The hover fix must not dim these.
  await page.evaluate(() => document.body.focus());
  for (const { selector, label } of HANDLES) {
    const focused = await page.keyboard.press("Tab").then(async () => {
      await page.waitForTimeout(240); // the ::after tint fades in over 120ms
      return page.evaluate(measure);
    });
    assert.equal(focused.focused, selector.match(/"(.+)"/)[1],
      `${theme}: Tab reaches the ${label} divider (${focused.focused})`);
    assert.ok(parseColor(focused.rows[selector].background).alpha > 0,
      `${theme}: a keyboard-focused ${label} divider still shows where the focus ring is (${focused.rows[selector].background})`);
  }
  for (const { selector, label } of HANDLES) {
    await page.evaluate((sel) => document.querySelector(sel).classList.add("is-resizing"), selector);
    await page.waitForTimeout(240);
    const dragging = (await page.evaluate(measure)).rows[selector];
    assert.ok(parseColor(dragging.background).alpha > 0,
      `${theme}: a dragged ${label} divider stays lit while the pointer owns it (${dragging.background})`);
    await page.evaluate((sel) => document.querySelector(sel).classList.remove("is-resizing"), selector);
    await page.waitForTimeout(160);
  }

  console.log(`ok: ${theme} — rest ${rest.rows['[data-resize-handle="sidebar"]'].background} / hover ${rest.rows['[data-resize-handle="sidebar"]'].background} on all three dividers; upstream's hover ${upstream.red},${upstream.green},${upstream.blue} / a${upstream.alpha}; focus and drag stay tinted`);
}

await browser.close();
server.close();
console.log("PASS: the panel dividers keep their hairline under the pointer, and stay lit for focus and drag");
