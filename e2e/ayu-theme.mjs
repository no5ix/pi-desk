import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The Ayu Monokai theme, measured in a browser.
 *
 * The palette reaches the screen through three mechanisms: CSS custom
 * properties for the app chrome and the Markdown preview, a Prism stylesheet
 * object for the source view and a fenced block in a reply, and a Monaco theme
 * generated from `vendor/ayu-monokai/Ayu Monokai-color-theme.json` for editing.
 * A unit test can prove the declarations name the palette; only a browser says
 * what ink a construct ends up in. So this harness mounts the real file panel
 * (e2e/ayu-theme.fixture.jsx) over the real stylesheets and reads
 * `getComputedStyle`.
 *
 * Prism's token spans in the file panel carry no token class — react-syntax-
 * highlighter applies the stylesheet inline and removes the class names it has
 * styles for — so a token is found by the text it paints, and its ink is read
 * from the page. That is the mapping under test: the word `bold` in Markdown,
 * `const` in TypeScript, a key in JSON, `<section>` in HTML, the same words a
 * person reads.
 *
 * What is measured:
 *  - Markdown element by element in preview: every heading level on the heading
 *    ink with the hierarchy in weight and a rule under the levels that open a
 *    section, **bold** on the keyword, *italic* in the default ink, links on the
 *    type colour, `code` on the string, quotations on the comment tone, list
 *    markers, table heads and nested rails on the palette's own marks, a checked
 *    task on the string, raw HTML on the document ink;
 *  - the same document in the source view, where Prism's markdown grammar paints
 *    the markup through the same roles, and a bare URL on the muted ink;
 *  - fenced code in the Markdown and the same languages as their own files
 *    (TypeScript, JSON, CSS, HTML) on the same role colours, on the editor's
 *    page, not a panel of their own;
 *  - Monaco: the generated theme's ink on canvas, the page behind it the
 *    palette's page, the gutter the palette's gutter;
 *  - the light theme's derived ink, so the palette is a set of tokens and not a
 *    dark-only stylesheet.
 *
 * Screenshots of every case go to test-results/e2e-theme for the human pass.
 */
const out = "test-results/ayu-theme";
const shots = "test-results/e2e-theme";
await mkdir(out, { recursive: true });
await mkdir(shots, { recursive: true });

await build({
  bundle: true,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".ttf": "base64", ".woff2": "base64", ".woff": "base64", ".svg": "dataurl" },
  logLevel: "warning",
  entryPoints: ["e2e/ayu-theme.fixture.jsx"],
  outdir: out,
  entryNames: "fixture",
  // Monaco's worker is reached through `new URL(..., import.meta.url)`, which
  // esbuild emits as a chunk beside the bundle; serving the whole output
  // directory is what lets the editor start with its language services.
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
});

const css = (await Promise.all(
  ["app/globals.css", "app/settings.css", "app/native-theme.css"].map((path) => readFile(path, "utf8")),
)).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

const MIME = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
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
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

/* The palette, as a browser reports the hex values. */
const FG = "rgb(191, 189, 182)";
const KEYWORD = "rgb(255, 143, 64)";
const STRING = "rgb(170, 217, 76)";
const CONSTANT = "rgb(210, 166, 255)";
const FUNCTION = "rgb(255, 180, 84)";
const TYPE = "rgb(89, 194, 255)";
const PROPERTY = "rgb(240, 113, 120)";
/* The operator's warm tone and punctuation's faded ink, as the palette names them. */
const OPERATOR = "rgb(242, 150, 104)";
const PUNCTUATION = "rgba(191, 189, 182, 0.7)";
/* #ACB6BF8C, as a browser reports it. */
const COMMENT = "rgba(172, 182, 191, 0.55)";
const PAGE = "rgb(11, 14, 20)";
const GUIDE = "rgba(108, 115, 128, 0.2)";
const LIGHT_PAGE = "rgb(255, 255, 255)";
const LIGHT_HEADING = "rgb(154, 103, 0)";
const LIGHT_KEYWORD = "rgb(164, 98, 42)";
const LIGHT_STRING = "rgb(107, 139, 35)";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 1500 } });
const failures = [];
const pageErrors = [];
// A script error carries a message; a failed resource load reaches `pageerror`
// as a bare "Event". The harness strips `@import` lines out of the stylesheets
// (the icon font they point at is not served here), so those load events are
// expected; a real one names itself and is kept.
page.on("pageerror", (error) => {
  const text = String(error?.stack ?? error?.message ?? error ?? "");
  if (text && text !== "Event") pageErrors.push(text);
});

async function visit(file, mode, theme, ready) {
  await page.goto(`${base}?file=${file}&mode=${mode}&theme=${theme}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(ready, { timeout: 20000 });
  await page.evaluate(async () => {
    await Promise.allSettled([document.fonts?.ready ?? Promise.resolve()]);
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

function note(failure) {
  failures.push(failure);
}

/** The computed style of the first element matching `selector`. A property
 *  starting with `::` reads that pseudo-element's colour. */
async function check(label, selector, expected) {
  const properties = Object.keys(expected);
  const got = await page.evaluate(({ selector, properties }) => {
    const el = document.querySelector(selector);
    if (!el) return { missing: selector };
    const style = getComputedStyle(el);
    const out = {};
    for (const property of properties) {
      out[property] = property.startsWith("::") ? getComputedStyle(el, property).color : style[property];
    }
    return out;
  }, { selector, properties });
  if (got.missing) {
    note(`${label}: ${selector} is not in the document`);
    return;
  }
  for (const property of properties) {
    const want = expected[property];
    const have = got[property];
    const ok = want instanceof RegExp ? want.test(String(have)) : have === want;
    if (!ok) note(`${label}: ${selector} ${property} = ${JSON.stringify(have)}, expected ${String(want)}`);
  }
}

/** The ink of a highlighted word: the deepest span in `region` whose text is
 *  exactly `text`. Prism gives no class to key on, so the word is the handle. */
async function checkWord(label, region, text, expected) {
  const properties = Object.keys(expected);
  const got = await page.evaluate(({ region, text, properties }) => {
    const host = document.querySelector(region);
    if (!host) return { missing: region };
    const nodes = [...host.querySelectorAll("span")]
      .filter((el) => !el.querySelector("span") && (el.textContent ?? "").trim() === text);
    if (!nodes.length) return { missing: `${text} (in ${region})` };
    const style = getComputedStyle(nodes[0]);
    const out = {};
    for (const property of properties) out[property] = style[property];
    return out;
  }, { region, text, properties });
  if (got.missing) {
    note(`${label}: no painted word ${JSON.stringify(got.missing)}`);
    return;
  }
  for (const property of properties) {
    const want = expected[property];
    const have = got[property];
    const ok = want instanceof RegExp ? want.test(String(have)) : have === want;
    if (!ok) note(`${label}: word ${JSON.stringify(text)} ${property} = ${JSON.stringify(have)}, expected ${String(want)}`);
  }
}

const SOURCE = ".file-source-view";
const PREVIEW = ".markdown-file-preview";
const FENCE = ".markdown-file-preview .markdown-code-block";

/* Chromium spells the palette's 8-bit alphas rounded: #6c73805c is 0.36,
   #6c738033 is 0.2, #ACB6BF8C is 0.55, #6c738099 is 0.6. The rules name the
   tokens; these are the same colours as the browser reports them. */
const RULE = "rgba(108, 115, 128, 0.36)";
const GUTTER = "rgba(108, 115, 128, 0.6)";

// ---------------------------------------------------------------- Markdown, preview
await visit("notes.md", "preview", "dark", `${PREVIEW} h1`);
await page.screenshot({ path: `${shots}/markdown-preview-dark.png`, fullPage: true });

await check("preview page", ".file-viewer-content", { backgroundColor: PAGE });
for (const level of [1, 2, 3, 4, 5, 6]) {
  await check(`preview h${level}`, `${PREVIEW} h${level}`, { color: FUNCTION });
}
await check("preview heading hierarchy", `${PREVIEW} h1`, { fontWeight: "700", borderBottomWidth: "1px", borderBottomColor: RULE });
await check("preview h4 weight", `${PREVIEW} h4`, { fontWeight: "600" });
await check("preview bold", `${PREVIEW} strong`, { color: KEYWORD, fontWeight: "700" });
await check("preview italic", `${PREVIEW} em`, { color: FG, fontStyle: "italic" });
await check("preview strike", `${PREVIEW} del`, { textDecorationLine: /line-through/ });
await check("preview link", `${PREVIEW} a`, { color: TYPE, textDecorationLine: /underline/ });
await check("preview inline code", `${PREVIEW} code`, { color: STRING });
await check("preview quote", `${PREVIEW} blockquote`, { color: COMMENT, borderLeftColor: KEYWORD });
await check("preview list marker", `${PREVIEW} li`, { "::marker": FUNCTION });
await check("preview ordered marker", `${PREVIEW} ol li`, { "::marker": FUNCTION });
await check("preview nested rail", `${PREVIEW} li > ul`, { borderLeftColor: GUIDE });
await check("preview table head", `${PREVIEW} th`, { color: FUNCTION, borderBottomColor: RULE });
await check("preview table cell", `${PREVIEW} td`, { color: FG });
await check("preview rule", `${PREVIEW} hr`, { backgroundColor: RULE });
await check("preview task checked", `${PREVIEW} input[type="checkbox"]:checked`, { backgroundColor: STRING });
await checkWord("preview raw html", PREVIEW, "HTML", { color: FG });
await check("preview fence surface", FENCE, { backgroundColor: PAGE });
// The fenced TypeScript inside the Markdown is the palette's code roles, on the
// editor's page — the same ink the `.ts` file gets in the source view.
await checkWord("preview fence keyword", FENCE, "const", { color: KEYWORD });
await checkWord("preview fence string", FENCE, '"./parser"', { color: STRING });
await checkWord("preview fence number", FENCE, "42", { color: CONSTANT });
await checkWord("preview fence class", FENCE, "Palette", { color: TYPE });
await checkWord("preview fence function", FENCE, "matches", { color: FUNCTION });
await checkWord("preview fence comment", FENCE, "// The comment tone.", { color: COMMENT });
// The second fence, in JSON: a key is the property rose, a value the string, a
// number and a boolean the constant.
await checkWord("preview fence json key", PREVIEW, '"enabled"', { color: PROPERTY });
await checkWord("preview fence json boolean", PREVIEW, "true", { color: CONSTANT });

// ------------------------------------------------- A fenced block, as chat paints it
// The real `CodeBlock`, the component a reply and the preview both use: the
// palette's own code surface, and the same roles the read view paints.
const CHAT_FENCE = "#fences .markdown-code-block:nth-child(1)";
const CHAT_TS_FENCE = "#fences .markdown-code-block:nth-child(2)";
await check("chat fence surface", `${CHAT_FENCE} pre`, { backgroundColor: "rgb(25, 25, 26)" });
// Prism aliases a Markdown heading to `bold`/`important`, so in a fence a heading
// lands in the palette's warm family (heading amber, keyword orange); the source
// view's heading line carries heading amber, as the preview's does.
await checkWord("chat fence md heading", CHAT_FENCE, "Heading", { color: /rgb\(255, 180, 84\)|rgb\(255, 143, 64\)/ });
await checkWord("chat fence md emphasis", CHAT_FENCE, "strong", { color: KEYWORD });
await checkWord("chat fence md link", CHAT_FENCE, "https://example.com", { color: TYPE });
await checkWord("chat fence md inline code", CHAT_FENCE, "`code`", { color: KEYWORD });
await checkWord("chat fence ts comment", CHAT_TS_FENCE, "// A comment in the comment tone.", { color: COMMENT });
await checkWord("chat fence ts keyword", CHAT_TS_FENCE, "import", { color: KEYWORD });
await checkWord("chat fence ts string", CHAT_TS_FENCE, '"node:fs/promises"', { color: STRING });
await checkWord("chat fence ts type", CHAT_TS_FENCE, "Palette", { color: TYPE });
await checkWord("chat fence ts function", CHAT_TS_FENCE, "load", { color: FUNCTION });
await checkWord("chat fence ts number", CHAT_TS_FENCE, "42", { color: CONSTANT });
await checkWord("chat fence ts operator", CHAT_TS_FENCE, "=", { color: OPERATOR });
await checkWord("chat fence md marker", CHAT_FENCE, "#", { color: PUNCTUATION });
await checkWord("chat fence line numbers", CHAT_FENCE, "1", { color: GUTTER });

// ---------------------------------------------------------------- Markdown, source
await visit("notes.md", "source", "dark", `${SOURCE} .file-source-line`);
await page.screenshot({ path: `${shots}/markdown-source-dark.png`, fullPage: true });

await check("source md page", ".file-viewer-content", { backgroundColor: PAGE });
await checkWord("source md heading", SOURCE, "Ayu Monokai", { color: FUNCTION, fontWeight: "700" });
await checkWord("source md heading rule", SOURCE, "Second level", { color: FUNCTION });
await checkWord("source md bold", SOURCE, "bold", { color: FUNCTION, fontWeight: "700" });
await checkWord("source md italic", SOURCE, "italic", { color: FG, fontStyle: "italic" });
await checkWord("source md strike", SOURCE, "struck", { textDecorationLine: /line-through/ });
await checkWord("source md link label", SOURCE, "guide", { color: TYPE });
await checkWord("source md inline code", SOURCE, "`inline_code`", { color: STRING });
await checkWord("source md list marker", SOURCE, "-", { color: FUNCTION });
await checkWord("source md quote marker", SOURCE, ">", { color: FUNCTION });
// A fenced block inside Markdown is highlighted as its own language in the
// source view too: the palette's code roles, in the sheet Markdown reads with.
await checkWord("source md code block", SOURCE, "LIMIT", { color: CONSTANT });
await checkWord("source md fence string", SOURCE, '"./parser"', { color: STRING });
await check("source md line numbers", `${SOURCE} .linenumber`, { color: GUTTER });

// ---------------------------------------------------------------- Source languages
await visit("theme.ts", "source", "dark", `${SOURCE} .token`);
await page.screenshot({ path: `${shots}/typescript-source-dark.png`, fullPage: true });
await checkWord("ts comment", SOURCE, "// A comment in the comment tone.", { color: COMMENT });
await checkWord("ts keyword", SOURCE, "import", { color: KEYWORD });
await checkWord("ts string", SOURCE, '"node:fs/promises"', { color: STRING });
await checkWord("ts number", SOURCE, "42", { color: CONSTANT });
await checkWord("ts type", SOURCE, "Palette", { color: TYPE });
await checkWord("ts function", SOURCE, "load", { color: FUNCTION });

await visit("theme.json", "source", "dark", `${SOURCE} .token`);
await page.screenshot({ path: `${shots}/json-source-dark.png`, fullPage: true });
await checkWord("json key", SOURCE, '"name"', { color: PROPERTY });
await checkWord("json string", SOURCE, '"ayu"', { color: STRING });
await checkWord("json number", SOURCE, "7", { color: CONSTANT });
await checkWord("json boolean", SOURCE, "true", { color: CONSTANT });

await visit("theme.css", "source", "dark", `${SOURCE} .token`);
await page.screenshot({ path: `${shots}/css-source-dark.png`, fullPage: true });
await checkWord("css comment", SOURCE, "/* The comment tone. */", { color: COMMENT });
await checkWord("css at-rule", SOURCE, "@media", { color: KEYWORD });
await checkWord("css selector", SOURCE, ".panel", { color: PROPERTY });
await checkWord("css property", SOURCE, "padding", { color: PROPERTY });
await checkWord("css function", SOURCE, "rgb", { color: FUNCTION });

await visit("page.html", "source", "dark", `${SOURCE} .token`);
await page.screenshot({ path: `${shots}/html-source-dark.png`, fullPage: true });
await checkWord("html comment", SOURCE, "<!-- The comment tone. -->", { color: COMMENT });
await checkWord("html tag", SOURCE, "section", { color: PROPERTY });
await checkWord("html attribute", SOURCE, "class", { color: FUNCTION });
await checkWord("html value", SOURCE, "panel", { color: STRING });

// ---------------------------------------------------------------- Monaco
await visit("theme.ts", "edit", "dark", ".monaco-editor .view-lines .view-line");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shots}/monaco-edit-dark.png`, fullPage: true });
await check("monaco page", ".file-editor-host", { backgroundColor: PAGE });
// The gutter, in the palette's muted ink, with the caret's line one step
// brighter — the palette's gutter, not Monaco's default gray.
await check("monaco gutter (caret line)", ".monaco-editor .line-numbers.active-line-number", { color: "rgba(108, 115, 128, 0.9)" });
await check("monaco gutter", ".monaco-editor .line-numbers:not(.active-line-number)", { color: GUTTER });
const monacoInk = await page.evaluate(() => {
  const seen = new Set();
  for (const span of document.querySelectorAll(".monaco-editor .view-line span")) {
    const el = span.querySelector("span") ?? span;
    const color = getComputedStyle(el).color;
    if (color) seen.add(color);
  }
  return [...seen];
});
for (const want of [FG, KEYWORD, STRING, CONSTANT, TYPE, FUNCTION]) {
  if (!monacoInk.includes(want)) {
    note(`monaco ink: nothing painted in ${want}; canvas ink was ${monacoInk.join(", ") || "nothing"}`);
  }
}
// Nothing outside the palette reaches the canvas. Monaco's defaults for bracket
// pairs, guides and gutter ink (gold, magenta, blues) are re-pointed at the
// palette, and the translucent comment tone is handed over blended onto the
// page, because a Monaco theme colour loses its alpha.
const PALETTE_INK = new Set([
  FG, KEYWORD, STRING, CONSTANT, TYPE, FUNCTION, PROPERTY, COMMENT,
  "rgb(100, 111, 115)",            // --code-comment, blended on the page
  "rgb(179, 174, 156)",            // --code-operator
  "rgb(152, 230, 194)",            // --code-inserted
  "rgb(149, 230, 203)",            // --code-regexp
  "rgb(240, 71, 71)",              // --code-deleted
  "rgb(114, 160, 224)",            // --code-changed
]);
for (const painted of monacoInk) {
  if (!PALETTE_INK.has(painted)) note(`monaco ink outside the palette: ${painted}`);
}

// ---------------------------------------------------------------- Light theme
await visit("notes.md", "preview", "light", `${PREVIEW} h1`);
await page.screenshot({ path: `${shots}/markdown-preview-light.png`, fullPage: true });
await check("light preview page", ".file-viewer-content", { backgroundColor: LIGHT_PAGE });
await check("light preview heading", `${PREVIEW} h1`, { color: LIGHT_HEADING });
await check("light preview bold", `${PREVIEW} strong`, { color: LIGHT_KEYWORD });
await check("light preview inline code", `${PREVIEW} code`, { color: LIGHT_STRING });
await check("light preview link", `${PREVIEW} a`, { color: "rgb(31, 126, 173)" });

await visit("theme.ts", "source", "light", `${SOURCE} .token`);
await page.screenshot({ path: `${shots}/typescript-source-light.png`, fullPage: true });
await checkWord("light ts keyword", SOURCE, "import", { color: LIGHT_KEYWORD });
await checkWord("light ts string", SOURCE, '"node:fs/promises"', { color: LIGHT_STRING });

await browser.close();
server.close();

await writeFile(`${shots}/report.json`, JSON.stringify({ failures, pageErrors }, null, 2));

if (pageErrors.length) {
  note(`page errors: ${pageErrors.slice(0, 4).join(" | ")}`);
}
assert.deepEqual(failures, [], `the Ayu Monokai palette: ${failures.length} measurement(s) off`);
console.log("Ayu Monokai theme: Markdown preview and source, fenced code, TypeScript/JSON/CSS/HTML, Monaco and the light palette all measure the palette.");
