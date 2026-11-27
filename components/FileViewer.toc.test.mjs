// The Markdown outline: what the parser lists, and what the file viewer shows.
//
// The parser is `parseMarkdownHeadings` in `lib/markdown.ts` — the outline of the
// document the reader has open. The bar that lists it, and the corner that opens
// and closes it, are asserted on the source and the stylesheet; jumping to a
// heading is the editor's own `revealLine` and the preview's element order.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { parseMarkdownHeadings } = await jiti.import("../lib/markdown.ts");

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const viewer = await read("components/FileViewer.tsx");
const css = await read("app/native-theme.css");
const en = await read("lib/i18n/messages/en.ts");
const cn = await read("lib/i18n/messages/zh-CN.ts");
const tw = await read("lib/i18n/messages/zh-TW.ts");

await test("the outline is the document's headings, in order, with the line each is on", () => {
  const text = [
    "# doing",
    "",
    "## background",
    "text",
    "## editor",
    "### inside editor",
    "#### deep",
    "##### deeper",
    "###### deepest",
    "# Fixed",
  ].join("\n");
  const headings = parseMarkdownHeadings(text);
  assert.deepEqual(headings.map((h) => [h.level, h.title, h.line]), [
    [1, "doing", 1],
    [2, "background", 3],
    [2, "editor", 5],
    [3, "inside editor", 6],
    [4, "deep", 7],
    [5, "deeper", 8],
    [6, "deepest", 9],
    [1, "Fixed", 10],
  ], "level, title, line, in the document's order");
  assert.deepEqual(headings.map((h) => h.index), [0, 1, 2, 3, 4, 5, 6, 7], "and the index the preview scrolls by");
});

await test("a `#` inside a code sample is not a section", () => {
  const text = [
    "# Real",
    "",
    "```bash",
    "# a comment in a shell sample",
    "cd docs   # not a heading",
    "```",
    "",
    "## Also real",
    "~~~",
    "# a comment in a tilde fence",
    "~~~",
    "# Last",
  ].join("\n");
  assert.deepEqual(
    parseMarkdownHeadings(text).map((h) => h.title),
    ["Real", "Also real", "Last"],
    "the fence is skipped whole, in both fence styles",
  );
});

await test("a heading's trailing hashes and blank titles are handled", () => {
  assert.deepEqual(parseMarkdownHeadings("# Doing\n## Shipped ##\n###\n").map((h) => h.title), ["Doing", "Shipped"]);
  assert.deepEqual(parseMarkdownHeadings("#"), [], "a bare `#` is not a heading");
  assert.deepEqual(parseMarkdownHeadings("Not a heading\n"), [], "and prose is not either");
});

await test("the bar opens from the toolbar's corner, and closes from its own", () => {
  assert.match(viewer, /className=\{`file-viewer-mode-button file-viewer-toc-toggle\$\{tocOpen \? " is-active" : ""\}\`\}/,
    "the toolbar's outline button shows the state it is in");
  assert.match(viewer, /aria-pressed=\{tocOpen\}\s*\n\s*aria-controls="file-toc"/, "announced, and pointing at the bar it opens");
  assert.match(viewer, /className="file-toc" id="file-toc" role="complementary"/, "the bar is a complementary region");
  assert.match(viewer, /onClick=\{\(\) => setTocOpen\(false\)\}/, "and its own corner closes it");
  assert.match(viewer, /\{"#"\.repeat\(heading\.level\)\}/, "each row carries the level it is at, like the document");
  assert.match(viewer, /is-level-\$\{Math\.min\(heading\.level, 6\)\}/, "and the indentation is the level");
  assert.match(viewer, /editor\.revealLine\(heading\.line\)/, "in the editor, a row reveals the heading's line");
  assert.match(viewer, /querySelectorAll\("h1,h2,h3,h4,h5,h6"\)\[heading\.index\]/, "in the preview, the heading element of that index");
  assert.match(css, /\.file-toc \{[\s\S]*?position: absolute;[\s\S]*?border-left: var\(--hairline\) solid var\(--separator\);/,
    "the bar sits on the right of the file, and keeps the document's width");
  assert.match(css, /\.file-toc-row\.is-level-2 \{ padding-left: 20px; \}/, "the tree is read as an indent, not a list");
});

await test("the outline speaks in all three languages", () => {
  for (const [name, source] of [["en", en], ["zh-CN", cn], ["zh-TW", tw]]) {
    for (const key of ["files.tocTitle", "files.tocToggle", "files.tocCollapse", "files.tocEmpty"]) {
      assert.match(source, new RegExp(String.raw`"${key}": "[^"]+"`), `${key} is in ${name}`);
    }
  }
});
