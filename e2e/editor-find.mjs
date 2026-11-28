import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * Monaco's find widget, measured in the app's panel.
 *
 * The widget is a 33px box that Monaco lays out by hand: the row (`.find-part`,
 * 25px) with a 3px top margin, the collapse toggle full height, and the close
 * `x` absolutely placed 5px down. Measured in a 520px panel, that put the
 * widget's middle at 64.5, the input row's at 63.5 and the `x` at 61 — three
 * centre lines in one 33px strip, so the `x` read as sitting above the field it
 * belongs to.
 *
 * The harness is part of the check. Monaco's own stylesheet is what positions
 * those parts, and esbuild emits it beside the bundle; a page that links only
 * the app's sheets shows buttons as unstyled 337px blocks, one per row, and no
 * measurement of that says anything about the design. Both sheets are served,
 * in the app's order (the app's, then Monaco's, which the app injects last).
 *
 * The last pass serves the app's sheet with the centring rules removed and
 * expects to measure the split again: a check that cannot see the bug it was
 * written for is not a check.
 */
const out = "test-results/editor-find";
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
  entryPoints: ["e2e/editor-find.fixture.jsx"],
  outdir: out,
  entryNames: "fixture",
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
});
// Monaco's CSS: the rules that put the find widget's parts where they go.
const monacoCss = await readFile(`${out}/fixture.css`, "utf8");
const appCss = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

/** The fork's centring rules, as one block, so the second pass can remove them. */
const FORK_RULES = /\/\* The row's centre line[\s\S]*?top: 8\.5px;\n\}/;
if (!FORK_RULES.test(appCss)) {
  throw new Error("e2e/editor-find.mjs: the find widget centring rules are not in app/native-theme.css — the probe would measure the bug and pass");
}
const cssWithoutFix = appCss.replace(FORK_RULES, "/* centring rules removed by e2e/editor-find.mjs */");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
function serve(styles) {
  const server = createServer(async (req, res) => {
    const wanted = req.url?.split("?")[0] ?? "";
    if (wanted.startsWith("/styles.css")) {
      res.setHeader("Content-Type", "text/css");
      res.end(styles);
      return;
    }
    if (wanted.startsWith("/monaco.css")) {
      res.setHeader("Content-Type", "text/css");
      res.end(monacoCss);
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
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/monaco.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const MEASURE = () => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { top: +r.top.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cy: +(r.top + r.height / 2).toFixed(1) };
  };
  const editor = document.querySelector(".monaco-editor");
  const widget = document.querySelector(".find-widget");
  if (!editor || !widget) return { error: "no find widget", hasEditor: Boolean(editor), hasWidget: Boolean(widget) };
  const visible = (b) => b.w > 0 && b.h > 0;
  const buttons = Array.from(widget.querySelectorAll(".button")).map((b) => ({
    name: (b.className.match(/codicon-[\w-]+/g) ?? []).join(" "),
    box: box(b),
  })).filter((b) => visible(b.box));
  const row = widget.querySelector(".find-part");
  return {
    editor: box(editor),
    widget: box(widget),
    row: row ? box(row) : null,
    input: box(widget.querySelector(".monaco-findInput") ?? widget),
    buttons,
    // Every part on one line: the spread of centre lines across the widget's parts.
    spread: +(() => {
      const lines = [box(widget), ...(row ? [box(row)] : []), ...buttons.map((b) => b.box)];
      const cys = lines.map((b) => b.cy);
      return (Math.max(...cys) - Math.min(...cys)).toFixed(1);
    })(),
    insideRight: +(widget.getBoundingClientRect().right - editor.getBoundingClientRect().right).toFixed(1),
    insideLeft: +(editor.getBoundingClientRect().left - widget.getBoundingClientRect().left).toFixed(1),
    insideTop: +(editor.getBoundingClientRect().top - widget.getBoundingClientRect().top).toFixed(1),
  };
};

async function measure(styles, widths) {
  const server = await serve(styles);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const results = [];
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}?width=${width}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".monaco-editor .view-lines", { timeout: 40000 });
    await page.evaluate(() => window.openFindInEditor());
    await page.waitForSelector(".find-widget.visible", { timeout: 10000 });
    await page.waitForTimeout(300);
    const measured = await page.evaluate(MEASURE);
    results.push({ width, measured });
    await page.screenshot({ path: `${out}/find-${width}.png`, clip: { x: 0, y: 0, width: width + 16, height: 200 } });
    await page.close();
  }
  await browser.close();
  await server.close();
  return results;
}

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const widths = [380, 520, 900];
const fixed = await measure(appCss, widths);
const broken = await measure(cssWithoutFix, [520]);

for (const { width, measured } of fixed) {
  if (measured.error) { check(false, `${width}px: ${measured.error}`); continue; }
  const close = measured.buttons.find((b) => b.name.includes("widget-close"));
  const prev = measured.buttons.find((b) => b.name.includes("find-previous-match"));
  check(measured.widget.h > 25 && measured.widget.h < 45, `${width}px: the widget is one 33px row, measured ${measured.widget.h}`);
  check(measured.insideRight <= 0.5 && measured.insideLeft <= 0.5 && measured.insideTop <= 0.5,
    `${width}px: the widget stays inside the editor's box (right +${measured.insideRight}, left +${measured.insideLeft}, top +${measured.insideTop})`);
  check(measured.spread <= 1, `${width}px: every part of the find row shares one centre line (spread ${measured.spread}px across widget, field and buttons)`);
  check(Boolean(close) && Boolean(prev), `${width}px: the row has its buttons (${measured.buttons.map((b) => b.name).join(", ")})`);
  check(Math.abs(close.box.cy - measured.widget.cy) <= 1,
    `${width}px: the close 'x' rides the widget's centre line (${close?.box.cy} vs ${measured.widget.cy})`);
  check(Math.abs(prev.box.cy - measured.input.cy) <= 1,
    `${width}px: the prev/next buttons ride the field's centre line (${prev?.box.cy} vs ${measured.input.cy})`);
}

// The same probe with the centring rules taken out must see the split it warns about.
const old = broken[0].measured;
const oldClose = old.buttons.find((b) => b.name.includes("widget-close"));
const oldRow = old.row;
check(old.spread > 1, `without the centring rules the parts are on ${old.spread}px apart (the bug the fix is for)`);
check(oldClose && oldRow && oldRow.cy - oldClose.box.cy > 1,
  `without them the close 'x' sits above the row it belongs to (${oldClose?.box.cy} vs the row's ${oldRow?.cy})`);

await writeFile(`${out}/report.json`, JSON.stringify({ fixed, broken }, null, 1));

if (failures.length) throw new Error(`the find widget is off its line:\n  ${failures.join("\n  ")}`);
console.log("e2e/editor-find.mjs: the find row's field, buttons and close glyph measure on one centre line, and the probe sees the old split");
