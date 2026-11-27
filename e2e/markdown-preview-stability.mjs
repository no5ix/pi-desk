import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The Markdown preview is patched, not rebuilt.
 *
 * A reader's complaint: images in a Markdown file kept flashing, and the panel
 * scrolled up and down by itself. The cause is not the network — it is React.
 * ReactMarkdown renders through the *types* in its `components` map, and a map
 * built inside the render is a new set of types on every render, so the whole
 * document is unmounted and mounted again each time the panel's state ticks: a
 * save, a watcher event, the save-status chip, opening the outline. A mounted
 * `<img>` fetches; a document replaced mid-read moves.
 *
 * So this measures node identity across a re-render: the same `<img>` node, the
 * same heading node, the same `src`, and a scroll position that stayed where the
 * reader left it. A harness that only screenshots cannot see a replace — the
 * pixels of the new tree are the same pixels.
 *
 * The fixture is the theme harness's (e2e/ayu-theme.fixture.jsx): the real
 * `FileViewer` over the real stylesheets, with the file API mocked.
 */
const out = "test-results/markdown-preview-stability";
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "text", ".svg": "dataurl", ".ttf": "base64", ".woff2": "base64", ".woff": "base64" },
  entryPoints: ["e2e/ayu-theme.fixture.jsx"],
  outfile: `${out}/fixture.js`,
  logLevel: "warning",
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const MIME = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/styles.css") {
    res.writeHead(200, { "content-type": "text/css" });
    res.end(css);
    return;
  }
  if (url.pathname.startsWith("/api/files/")) {
    const body = JSON.stringify({ content: "", size: 0, truncated: false });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
    return;
  }
  if (url.pathname === "/" || url.pathname.startsWith("/index")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
    return;
  }
  try {
    const body = await readFile(out + url.pathname);
    res.writeHead(200, { "content-type": MIME[url.pathname.slice(url.pathname.lastIndexOf("."))] ?? "text/javascript" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/?file=notes.md&mode=preview&theme=dark`;

const browser = await chromium.launch({ headless: true });
const failures = [];
const note = (text) => failures.push(text);
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on("pageerror", (error) => {
  const message = error?.stack ?? error?.message ?? String(error);
  if (message === "Event" || /Failed to load (online|font)/.test(message)) return;
  note(`page error: ${message.split("\n")[0]}`);
});

await page.goto(base, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".markdown-file-preview img", { timeout: 15_000 });
await page.waitForTimeout(300);

// Tag the nodes, then scroll the document the way a reader does.
const tagged = await page.evaluate(() => {
  const image = document.querySelector(".markdown-file-preview img");
  const heading = document.querySelector(".markdown-file-preview h2");
  const scroller = document.querySelector(".file-viewer-content")
    ?? document.querySelector(".markdown-file-preview")?.closest("[class*=content]")
    ?? document.scrollingElement;
  if (!image || !heading || !scroller) return null;
  image.dataset.probe = "kept";
  heading.dataset.probe = "kept";
  scroller.scrollTop = 140;
  return { src: image.getAttribute("src"), scrollTop: scroller.scrollTop, scroller: scroller.className || scroller.tagName };
});
assert.ok(tagged, "the preview has an image, a heading and a scrollable document");

// A state change in the panel that renders the document: the outline's own
// toggle. It re-renders the file panel; it must not replace the document.
await page.locator(".file-viewer-toc-toggle").click();
await page.waitForTimeout(250);
await page.locator(".file-viewer-toc-toggle").click();
await page.waitForTimeout(250);

const after = await page.evaluate(() => {
  const image = document.querySelector(".markdown-file-preview img");
  const heading = document.querySelector(".markdown-file-preview h2");
  const scroller = document.querySelector(".file-viewer-content")
    ?? document.querySelector(".markdown-file-preview")?.closest("[class*=content]")
    ?? document.scrollingElement;
  return {
    imageKept: image?.dataset.probe === "kept",
    headingKept: heading?.dataset.probe === "kept",
    src: image?.getAttribute("src"),
    scrollTop: scroller?.scrollTop,
  };
});

assert.ok(after.imageKept, "the same <img> node is on the page after the panel re-rendered — a replaced node fetches again, and a reader sees a flash");
assert.ok(after.headingKept, "the same heading node is on the page: the document is patched, not remounted");
assert.equal(after.src, tagged.src, "the image still asks for the same bytes");
assert.ok(Math.abs(after.scrollTop - tagged.scrollTop) <= 1,
  `the document stayed at the reader's place (${tagged.scrollTop} → ${after.scrollTop} in .${tagged.scroller})`);

// The outline is a column, not a sheet: its box and the document's box do not
// overlap, and the document kept the width the panel gave it before the outline
// opened. This is the shape the reader asked for — an outline that covers the
// Markdown, or squeezes it, is a bad way to read one.
const geometry = await page.evaluate(() => {
  const toc = document.querySelector(".file-toc");
  const content = document.querySelector(".file-viewer-content");
  if (!toc || !content) return null;
  const a = toc.getBoundingClientRect();
  const b = content.getBoundingClientRect();
  return { toc: { x: a.x, right: a.right, w: a.width }, content: { x: b.x, right: b.right, w: b.width } };
});
if (geometry) {
  assert.ok(geometry.content.right <= geometry.toc.x + 0.5,
    `the outline sits beside the document, not over it (${JSON.stringify(geometry)})`);
  assert.ok(geometry.toc.w >= 200, `the outline has a column's width (${geometry.toc.w})`);
}

// The renderers are module-level and the scope is memoised, which is what keeps
// the types stable; a map rebuilt in the render is the regression.
const viewer = await readFile("components/FileViewer.tsx", "utf8");
assert.doesNotMatch(viewer, /components=\{\{/, "the preview's renderer map is not built in the render");
assert.match(viewer, /components=\{MARKDOWN_PREVIEW_COMPONENTS\}/, "the preview renders with one map, built once");
assert.match(viewer, /const markdownPreviewScope = useMemo/, "the values the renderers ask for are memoised");

console.log("Markdown preview: the document is patched across a panel re-render — the image node, its bytes and the reader's scroll all held their place.");
await browser.close();
server.close();
