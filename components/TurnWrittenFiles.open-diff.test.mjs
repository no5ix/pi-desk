import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const source = await readFile(new URL("./TurnWrittenFiles.tsx", import.meta.url), "utf8");

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props)),
  );
}

const files = [{ filePath: "/abs/a.ts", added: 3, removed: 1 }];

test("a row hands the file and its session to the opener, so the panel shows the diff", () => {
  // The card counts what the session wrote; the panel must show that change,
  // which git cannot when the working tree is clean.
  assert.match(source, /onClick=\{\(\) => onOpenFile\?\.\(filePath, sessionId\)\}/);
  assert.match(source, /onOpenFile\?: \(filePath: string, sessionId\?: string\) => void;/);
});

test("the live card opens folded and keeps its rows hidden", () => {
  const folded = render({ files, sessionId: "s1", defaultExpanded: false });
  assert.match(folded, /aria-expanded="false"/);
  // The rows stay mounted so the card's height can animate (the collapse is a
  // `grid-template-rows: 0fr` track, measured in e2e/turn-files-animation.mjs). Folded
  // therefore means clipped, invisible and inert, not absent from the DOM.
  assert.match(folded, /<div class="turn-files-list" inert=""/, "folded, the list is clipped and out of the tab order");
  assert.doesNotMatch(folded, /turn-files-list is-open/, "and it is not marked open");

  const open = render({ files, sessionId: "s1" });
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /a\.ts/);
  assert.match(open, /<div class="turn-files-list is-open"/, "open, the track is open and the rows are reachable");
});

test("the fold is the caller's choice, not the card's own state default", () => {
  assert.match(source, /const \[expanded, setExpanded\] = useState\(defaultExpanded\);/);
  assert.match(source, /defaultExpanded = true/);
});
