import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * Cmd+Z after a save.
 *
 * The reader's loop is short: type, the file saves itself, then Cmd+Z to take the
 * last words back. It stopped working, and the reason is a flush. A save refetches
 * the file, and clearing the draft left one render in which the editor's `value`
 * was the older read-view text while the model carried the typed words. The value
 * sync replaced the model — and `model.setValue` goes through
 * `_setValueFromTextBuffer`, which drops every undo item the buffer had collected.
 * Cmd+Z then had nothing to undo, twice over (the echo and the read each flushed).
 *
 * The instrument is the editor's own change report: `onChange` fires when the
 * buffer changes, so an undo that works is a report whose text no longer carries
 * the probe. The DOM cannot measure this — Monaco renders the visible window of
 * the model, not all of it — and the file-editor harness has no view of the model
 * at all.
 */
const out = "test-results/editor-undo";
await mkdir(out, { recursive: true });

const fixture = `
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { CodeEditor } from "@/components/CodeEditor";

const INITIAL = "export function keep(x: number) {\\n  return x + 1;\\n}\\n";

window.__values = [];

function App() {
  // The parent as FileViewer plays it: the buffer is the draft, a save states the
  // disk's content and clears the draft in the same pass, and the read that
  // follows reports the same text the disk now holds.
  const [content, setContent] = useState(INITIAL);
  const [draft, setDraft] = useState(null);
  window.__writes = [];
  window.__save = () => {
    const buffer = draft ?? content;
    window.__writes.push(buffer);
    // The parent as it ran when the bug was reported: the draft is cleared first,
    // so for a beat the editor's value is the older read-view text, and the read
    // that carries the saved bytes lands afterwards. The order is fixed in
    // FileViewer; what the editor must survive either way is the undo stack.
    setDraft(null);
    setTimeout(() => setContent(buffer), 60);
    return true;
  };
  return (
    <div style={{ height: "600px", width: "900px" }}>
      <CodeEditor
        filePath="/repo/probe.ts"
        value={draft ?? content}
        onChange={(next) => {
          setDraft(next === content ? null : next);
          window.__values.push(next);
        }}
        onSave={() => window.__save()}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
`;
await mkdir(`${out}/src`, { recursive: true });
await writeFileSafe(`${out}/src/fixture.jsx`, fixture);
await build({
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".css": "text", ".svg": "dataurl", ".ttf": "base64", ".woff2": "base64", ".woff": "base64" },
  entryPoints: [`${out}/src/fixture.jsx`],
  outfile: `${out}/fixture.js`,
  logLevel: "warning",
});

const css = (await readFile("app/native-theme.css", "utf8")).replace(/^@import[^;]*;/gm, "");
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/styles.css") {
    res.writeHead(200, { "content-type": "text/css" });
    res.end(css);
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
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
page.on("pageerror", (error) => {
  // Monaco's worker stub in a bare harness throws an Event with no message; the
  // app's own web worker is not part of what this measures.
  if (!(error instanceof Error)) return;
  const message = error.stack ?? error.message ?? "";
  if (!message.trim() || /Failed to load (online|font)/.test(message)) return;
  throw error;
});

await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".monaco-editor", { timeout: 15_000 });
await page.waitForTimeout(800);
const host = await page.locator(".code-editor-host").first().boundingBox();
assert.ok(host, "the editor box is measurable");
await page.mouse.click(host.x + 120, host.y + 30);
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await page.keyboard.type("// undo probe");
await page.waitForFunction(() => (window.__values ?? []).some((text) => text.includes("// undo probe")), null, { timeout: 5_000 });

// The save, exactly as the viewer runs it: the disk's content becomes the base and
// the draft is cleared in one pass, then the read reports the same bytes.
await page.evaluate(() => window.__save());
await page.waitForTimeout(300);

// Cmd+Z. The buffer had the probe a moment ago; the undo stack is what takes it
// back, and a flushed model has no stack to take.
const reportsBefore = await page.evaluate(() => window.__values.length);
await page.keyboard.press("Meta+Z");
await page.waitForTimeout(300);
const reports = await page.evaluate((n) => (window.__values ?? []).slice(n), reportsBefore);
assert.ok(reports.length > 0, "Cmd+Z changed the buffer, and the editor reported it");
assert.doesNotMatch(reports.at(-1), /\/\/ undo probe/, "the undo took the probe's words back");
assert.match(reports.at(-1), /return x \+ 1;/, "and left the file's own words alone");

// Enter is a newline, never an acceptance: the suggestion list that a typed prefix
// opens must not steal the return key.
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await page.keyboard.type("format");
await page.waitForTimeout(400);
const linesBeforeEnter = await page.evaluate(() => document.querySelectorAll(".view-line").length);
await page.keyboard.press("Enter");
await page.waitForTimeout(200);
const linesAfterEnter = await page.evaluate(() => document.querySelectorAll(".view-line").length);
assert.ok(linesAfterEnter > linesBeforeEnter, `Enter broke the line (${linesBeforeEnter} → ${linesAfterEnter} rendered lines) — it did not accept a completion`);

console.log("Editor: Cmd+Z undoes after a save, and Enter stays a newline while the word list is open.");
await browser.close();
server.close();

async function writeFileSafe(path, text) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, text);
}
