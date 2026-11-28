import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/**
 * A refused diff is a sentence, not a blank pane.
 *
 * The file viewer's Diff mode asked `/api/git/diff` and, on any failure, set the
 * diff to nothing. Nothing means "no change for this file", so the mode demoted
 * itself back to the source and the reader was left with a file, no change, and
 * no word about the refusal — which is how a 403 on a file in the user's own
 * working tree became a mystery. The route now names the reason (four of them),
 * and the viewer keeps the diff mode and says which one it is. These assertions
 * keep the two ends of that contract in step.
 */

test("every refusal the route can answer has a sentence, and none is invented", async () => {
  const gate = await read("../lib/git-diff-access.ts");
  const viewer = await read("./FileViewer.tsx");
  const reasons = (gate.match(/export type DiffPathDenial =([\s\S]*?);/)[1].match(/"[^"]+"/g) ?? [])
    .map((s) => s.replaceAll('"', ""));
  assert.deepEqual(reasons, ["parent-segment", "outside-root", "link-escapes-root", "unresolvable"],
    "the refusal set is the one the gate documents");
  const table = viewer.match(/const DIFF_DENIAL_KEYS: Record<string, string> = \{[\s\S]*?\};/);
  assert.ok(table, "the viewer maps refusals to sentences in one table");
  for (const reason of reasons) {
    assert.match(table[0], new RegExp(`"${reason}": "files\\.diffDenied\\.`), `the viewer names the '${reason}' refusal`);
  }
  // And no key in the table is a refusal the gate never returns.
  for (const key of table[0].match(/"[a-z-]+":/g) ?? []) {
    const reason = key.slice(1, -2);
    assert.ok(reasons.includes(reason), `the viewer maps '${reason}', which the gate never answers`);
  }
});

test("the refusal keeps the diff mode and shows the path it is about", async () => {
  const viewer = await read("./FileViewer.tsx");
  assert.match(viewer, /setGitDiffDenial\(!response\.ok && next\.reason \? next\.reason : null\);/,
    "the refusal is read from the response, in the route's words");
  assert.match(viewer, /if \(diffResolved && !hasDiff && !gitDiffDenial && displayMode === "diff"\)/,
    "a refusal is not 'no change': the diff mode does not demote to the source");
  assert.match(viewer, /effectiveDisplayMode === "diff" && gitDiffDenial/,
    "the pane answers the refusal, in the mode the reader is in");
  assert.match(viewer, /className="file-diff-denied" role="status"/,
    "the sentence is announced, and it is a status, not an error storm");
  assert.match(viewer, /<span className="file-diff-denied-path">\{filePath\}<\/span>/,
    "the refusal names the path it refused");
});

test("the refusal's box is the app's ink, in the fork stylesheet", async () => {
  const css = await read("../app/native-theme.css");
  const rule = css.match(/\.file-diff-denied \{[\s\S]*?\}/);
  assert.ok(rule, "the refusal is a class, not an inline style");
  assert.match(css, /\.file-diff-denied-title \{[\s\S]*?color: var\(--text\);/);
  assert.match(css, /\.file-diff-denied-path \{[\s\S]*?font-family: var\(--font-mono\);/);
  assert.doesNotMatch(`${rule[0]}${css.match(/\.file-diff-denied-title \{[\s\S]*?\}/)[0]}`, /#[0-9a-fA-F]{3,8}/,
    "no invented palette in the refusal's rules");
});

test("every refusal is spoken in all three language packs", async () => {
  const packs = await read("../lib/i18n/locale-plugins.ts");
  for (const key of ["outsideRoot", "linkEscapesRoot", "parentSegment", "unresolvable"]) {
    const hits = packs.match(new RegExp(`"files\\.diffDenied\\.${key}": "[^"]+"`, "g")) ?? [];
    assert.equal(hits.length, 3, `files.diffDenied.${key} exists in en, zh-CN and zh-TW`);
  }
});
