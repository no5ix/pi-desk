import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { TurnWrittenFiles } = await jiti.import("./TurnWrittenFiles.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

test("renders a button per file showing the basename and full path", () => {
  const html = render({
    files: [{ filePath: "/abs/out/report.html" }, { filePath: "/abs/out/data.json" }],
    onOpenFile() {},
  });
  assert.match(html, /<button/);
  assert.match(html, /report\.html/);
  assert.match(html, /data\.json/);
  assert.match(html, /title="\/abs\/out\/report\.html"/);
  assert.match(html, /title="\/abs\/out\/data\.json"/);
});

test("renders nothing when no files were written", () => {
  assert.equal(render({ files: [], onOpenFile() {} }), "");
});

test("shows a summary header with total and per-file line counts", () => {
  const html = render({
    files: [{ filePath: "/abs/a.ts", added: 17, removed: 2 }, { filePath: "/abs/b.css", added: 7, removed: 0 }],
    onOpenFile() {},
  });
  assert.match(html, /Edited 2 files/);
  assert.match(html, />\+24</);
  assert.match(html, />−2</);
  assert.match(html, />\+17</);
  assert.match(html, />\+7</);
});

test("the rows stay mounted, and a folded list is clipped, inert and announced", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

  const open = render({ files: [{ filePath: "/abs/a.ts" }], onOpenFile() {}, defaultExpanded: true });
  assert.match(open, /<div class="turn-files-list is-open"[^>]*>/, "an open list carries the open state");
  assert.doesNotMatch(open.match(/<div class="turn-files-list[^>]*>/)[0], /inert/, "open rows are reachable");
  const folded = render({ files: [{ filePath: "/abs/a.ts" }], onOpenFile() {}, defaultExpanded: false });
  assert.match(folded, /<div class="turn-files-list" inert=""[^>]*>/,
    "a folded list is `inert`: clipped away and out of the tab order and the a11y tree");
  assert.match(folded, /<button[^>]*class="turn-files-row"/, "and its rows are still in the DOM, so the height can animate");
  assert.match(open, /<div class="turn-files-list-inner">/, "the clipping child the 0fr track needs");

  const list = css.match(/\.turn-files-list \{[\s\S]*?\n\}/);
  assert.ok(list, "the list's rule exists");
  assert.match(list[0], /display: grid;/);
  assert.match(list[0], /grid-template-rows: 0fr;/, "the closed track is 0fr");
  assert.match(list[0], /transition: grid-template-rows var\(--dur-base\) var\(--ease-native\);/, "and the track is the motion");
  assert.match(css, /\.turn-files-list\.is-open \{\n  grid-template-rows: 1fr;\n\}/, "open is 1fr");
  assert.match(css, /\.turn-files-list-inner \{\n  overflow: hidden;\n  min-height: 0;\n\}/, "the child clips to the track");
  assert.match(css, /\.turn-files-list \.turn-files-row \{\n  opacity: 0;/, "the rows fade with the track");
  assert.match(css, /\.turn-files-list\.is-open \.turn-files-row \{\n  opacity: 1;\n\}/, "and end visible");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.turn-files-list,[\s\S]*?\.turn-files-list \.turn-files-row \{\n    transition: background var\(--dur-fast\) var\(--ease-native\);/,
    "reduced motion: no height motion, the hover tint still answers, and the end states are the same");
  // The newer way to animate a height to `auto` is Chromium-only, and this app runs on
  // WebKit (the desktop's WKWebView, a phone) where it would jump. `grid-template-rows`
  // is animated by every engine here — pinned by e2e/turn-files-animation.mjs.
  assert.doesNotMatch(list[0], /interpolate-size|calc-size/, "no Chromium-only sizing animation");

  // The header is a band, not the first row of the table.
  const header = css.match(/\.turn-files-header \{[\s\S]*?\n\}/);
  assert.ok(header, "the header carries a plate of its own");
  assert.match(header[0], /background-color: color-mix\(in srgb, var\(--surface\) 88%, transparent\);/);
  assert.match(header[0], /background-image: linear-gradient\(color-mix\(in srgb, var\(--bg-selected\) 62%, transparent\)/,
    "the palette's selected wash over an opaque base — the app's plate recipe, not a half-transparent mix");
  const shared = css.match(/\.turn-files-header,\n\.turn-files-row \{[\s\S]*?\n\}/);
  assert.match(shared[0], /background: transparent;/, "the rows stay transparent on the card, so the band is the header's alone");
});
