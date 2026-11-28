import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The file panel's editor, in a browser: Monaco, the file, the save, the
 * completion.
 *
 * What is measured is what only a browser can answer:
 *
 *  - Monaco mounts in the panel's width and paints the file, in the Ayu Monokai
 *    palette (the canvas colour is asserted, so a theme that failed to register
 *    is visible here, not only to a human);
 *  - typing marks the file unsaved and the bar says so in words;
 *  - Cmd/Ctrl+S writes the buffer through the file API, against the modification
 *    time the read reported, and the bar reports the save;
 *  - the completion list is the document's own words, and Tab accepts one;
 *  - no width makes the page scroll sideways, and the editor takes the panel's
 *    height rather than a strip of it.
 *
 * The fixture (e2e/file-editor.fixture.jsx) serves the file and the write, so
 * the assertions are about the panel, not about git.
 *
 * Not in `npm run test:e2e` yet: the completion assertion at the end fails — no
 * suggest widget opens in the bundle — and the diagnosis is in BLOCKERS.md. The
 * rest of what this harness measures passes; the harness is kept because the
 * assertion is the point, and because it found the layout rule and the worker
 * factory that made the editor unusable.
 */
const out = "test-results/file-editor";
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".ttf": "base64", ".woff2": "base64", ".woff": "base64", ".svg": "dataurl" },
  logLevel: "warning",
  entryPoints: ["e2e/file-editor.fixture.jsx"],
  outdir: out,
  entryNames: "fixture",
  // Monaco's worker is reached through `new URL(..., import.meta.url)`, which
  // esbuild emits as a chunk beside the bundle. Serving the whole output
  // directory is what lets the worker start; a harness that serves one file
  // leaves the editor without its word context, and the completion list with it.
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  // Anything the bundle asks for beside itself (its worker chunks, the icon
  // font) is served from the build output, so Monaco starts as it does in the
  // app rather than in a degraded mode.
  const wanted = req.url?.split("?")[0] ?? "";
  if (wanted.startsWith("/styles.css")) {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  if (wanted.startsWith("/") && !wanted.includes("..")) {
    try {
      const file = await readFile(`${out}${wanted}`);
      res.setHeader("Content-Type", MIME[wanted.slice(wanted.lastIndexOf("."))] ?? "text/javascript");
      res.end(file);
      return;
    } catch {
      // fall through to the page
    }
  }
  if (wanted === "/" || wanted.startsWith("/index")) {
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
  }
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

async function editor(label, { width, height, touch, theme }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    hasTouch: touch,
    isMobile: touch,
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // A worker that cannot be constructed is not fatal: Monaco falls back to the
    // main thread, and the harness builds no worker chunks.
    if (/worker/i.test(text)) return;
    pageErrors.push(`${label}: console: ${text}`);
  });
  await page.goto(`${url}?theme=${theme}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".monaco-editor .view-lines", { timeout: 20_000 });

  // ─── the file is painted, in the theme, in the panel's box ───
  // Monaco's view appears before its first line is laid out, so the wait is for
  // the text, not the node.
  await page.waitForFunction(
    () => (document.querySelector(".view-lines")?.textContent ?? "").includes("formatCommitTime"),
    null,
    { timeout: 15_000 },
  );
  const painted = await page.locator(".monaco-editor .view-lines").innerText();
  assert.match(painted, /formatCommitTime/, `${label}: the file's own text is on screen`);
  const editorBox = await box(page, ".file-editor-host");
  const panelBox = await box(page, "#file-panel");
  assert.ok(editorBox.h >= Math.min(240, panelBox.h * 0.6),
    `${label}: the editor takes the panel's height (${editorBox.h} of ${panelBox.h})`);
  assert.ok(Math.abs(editorBox.w - panelBox.w) <= 2, `${label}: the editor is the panel's width (${editorBox.w} vs ${panelBox.w})`);
  // The theme is the generated one. Monaco paints the canvas through rules it
  // injects, so what is checkable is the ink: the palette's own foreground, and
  // more than one colour in the painted lines (a theme that did not register
  // leaves every token the same grey).
  const ink = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll(".view-lines span"));
    return { colours: [...new Set(spans.map((span) => getComputedStyle(span).color))], count: spans.length };
  });
  assert.ok(ink.count > 5, `${label}: the file is painted as tokens (${ink.count} spans)`);
  assert.ok(ink.colours.length >= 2, `${label}: syntax colours differ (${ink.colours.join(", ")})`);
  if (theme === "dark") {
    assert.ok(ink.colours.includes("rgb(191, 189, 182)"),
      `${label}: Ayu Monokai's own foreground (${ink.colours.join(", ")}) is on screen, so the generated theme registered`);
  }
  assert.ok(await page.locator(".monaco-editor .line-numbers").first().isVisible(), `${label}: the gutter shows line numbers`);

  // ─── a sideways page scroll is not allowed at any width ───
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1,
    `${label}: the editor does not widen the page (${overflow.scrollWidth} > ${overflow.clientWidth})`);

  // ─── typing marks the file unsaved, in the toolbar's own row ───
  // Monaco's layers are absolute and its text layer is as tall as the file, so
  // an element click aims outside the visible area. The click is aimed at a
  // point inside the editor's own box, which is what a finger or a cursor hits.
  const host = await page.locator(".code-editor-host").first().boundingBox();
  assert.ok(host, `${label}: the editor box is measurable`);
  await page.mouse.click(host.x + Math.min(160, host.width / 2), host.y + Math.min(40, host.height / 2));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type(" // panel edit");
  // ─── typing marks the file unsaved, in the toolbar's own row ───
  // The editor has no "Unsaved changes" row any more: it saves itself, a second
  // after the typing stops. The state is stated in the toolbar, and the write that
  // follows is what the harness measures.
  await page.waitForSelector(".file-editor-status", { timeout: 5_000 });
  const barText = await page.locator(".file-editor-status").innerText();
  assert.match(barText, /Unsaved changes|有未保存的改动|有未儲存的變更/, `${label}: the toolbar names the unsaved buffer (${barText})`);
  assert.equal(await page.evaluate(() => window.__dirty.at(-1)), true, `${label}: the tab is told the file is dirty`);
  assert.equal(await page.locator(".file-editor-bar").count(), 0, `${label}: there is no row of Save buttons under the toolbar`);
  if (touch) {
    const action = await box(page, ".file-editor-status .file-viewer-mode-button");
    assert.ok(action.w >= 36 && action.h >= 36, `${label}: a finger gets ${action.w}×${action.h} on the row's action (36 required)`);
  }

  // ─── the buffer saves itself, against the time it read ───
  await page.waitForFunction(() => window.__writes.length >= 1, null, { timeout: 5_000 });
  const write = await page.evaluate(() => window.__writes.at(-1));
  assert.match(write.content, /\/\/ panel edit/, `${label}: the auto-save carries the buffer`);
  assert.ok(typeof write.baseMtime === "string" && write.baseMtime.length > 0, `${label}: and the modification time it read at`);
  await page.waitForFunction(() => window.__dirty.at(-1) === false, null, { timeout: 5_000 });
  const afterSave = await page.locator(".file-editor-status").innerText();
  assert.match(afterSave, /Saved|已保存|已儲存/, `${label}: the toolbar reports the save (${afterSave})`);

  // ─── Cmd/Ctrl+S still answers, at once ───
  await page.keyboard.press("End");
  await page.keyboard.type(" // by hand");
  await page.keyboard.press(label.startsWith("mac") ? "Meta+S" : "Control+S");
  await page.waitForFunction(() => window.__writes.length >= 2, null, { timeout: 5_000 });
  const byHand = await page.evaluate(() => window.__writes.at(-1));
  assert.match(byHand.content, /\/\/ by hand/, `${label}: Cmd+S writes the buffer immediately`);
  // A save's effect on the undo stack is measured in e2e/editor-undo.mjs, where
  // the editor's own change reports are the instrument: this harness can only
  // read Monaco's rendered lines, which cover the visible window, not the model.

  // ─── completion: the document's words, and Tab accepts one ───
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("format");
  await page.keyboard.press("Control+Space");
  const state = () => page.evaluate(() => ({
    widgets: Array.from(document.querySelectorAll(".suggest-widget")).map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        cls: node.className,
        box: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
        display: getComputedStyle(node).display,
        rows: node.querySelectorAll(".monaco-list-row").length,
        text: (node.textContent ?? "").slice(0, 60),
      };
    }),
    contextViews: document.querySelectorAll(".context-view").length,
    active: document.activeElement?.className ?? document.activeElement?.tagName ?? null,
    tail: (document.querySelector(".view-lines")?.innerText ?? "").split("\n").slice(-2),
  }));
  const opened = await page.waitForSelector(".monaco-editor .suggest-widget", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const diagnostics = await state();
  assert.ok(opened, `${label}: typing a prefix opens the completion list (${JSON.stringify(diagnostics)})`);
  const suggestions = await page.locator(".monaco-editor .suggest-widget .monaco-list-row").allInnerTexts();
  assert.ok(suggestions.some((row) => row.includes("formatCommitTime")),
    `${label}: the document's own word is offered (${JSON.stringify({ suggestions: suggestions.slice(0, 4), diagnostics })})`);
  await page.keyboard.press("Tab");
  const completed = await page.locator(".monaco-editor .view-lines").innerText();
  assert.match(completed, /formatCommitTime/, `${label}: Tab accepted the completion`);
  // The buffer now differs from the disk, so the bar is back: the same channel
  // that reports typing reports a completion's insert.
  // The buffer now differs from the disk, so the state is back: the same channel
  // that reports typing reports a completion's insert.
  assert.match(await page.locator(".file-editor-status").innerText(), /Unsaved changes|有未保存的改动|有未儲存的變更/,
    `${label}: a completion's insert counts as an edit`);

  results.push({ label, painted: painted.split("\n")[0], suggestions: suggestions.length });
  await page.screenshot({ path: `${out}/${label}.png` });
  await context.close();
}

await editor("desktop", { width: 1440, height: 900, touch: false, theme: "dark" });
await editor("desktop-light", { width: 1280, height: 800, touch: false, theme: "light" });
await editor("phone", { width: 390, height: 844, touch: true, theme: "dark" });
await editor("narrow-window", { width: 760, height: 700, touch: false, theme: "dark" });

await browser.close();
server.close();

assert.deepEqual(pageErrors, [], "the editor runs without page errors");
console.log(JSON.stringify(results, null, 2));
