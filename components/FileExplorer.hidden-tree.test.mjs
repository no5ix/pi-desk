// A folder that was opened lists what is inside it.
//
// The report: clicking `.ruff_cache` in the file tree showed nothing. ruff writes
// a `.gitignore` of `*` inside its cache folder, so every entry there is ignored
// while the folder itself is not, and a rule that drops ignored entries opens
// the folder on an empty panel. The server-side rule is asserted in
// `app/api/files/list-route.test.mjs`; this is the client's half — the switch
// that reaches the convention-hidden folders, the note on a row Git ignores, and
// the palette's part in both.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const explorer = await read("components/FileExplorer.tsx");
const shell = await read("components/AppShell.tsx");
const css = await read("app/native-theme.css");
const prefs = await read("lib/app-prefs.ts");
const en = await read("lib/i18n/messages/en.ts");
const cn = await read("lib/i18n/messages/zh-CN.ts");
const tw = await read("lib/i18n/messages/zh-TW.ts");

await test("the row Git ignores says so, and dims, like the reference explorer", () => {
  assert.match(explorer, /\{hidden === "ignored" \?\s*\(\s*\n\s*<span className="file-tree-hidden-tag" title=\{t\("files\.hiddenIgnored"\)\}>\{t\("files\.gitExcluded"\)\}<\/span>/,
    "a marked row carries the note");
  assert.match(explorer, /const hidden = node\.hidden \?\? parentHidden;/,
    "a row inside an ignored folder inherits the reason");
  assert.match(css, /\.file-tree-hidden-tag \{[\s\S]*?background: var\(--bg-hover\);[\s\S]*?color: var\(--text-dim\);[\s\S]*?font-size: var\(--fs-micro\);/,
    "the note is token-styled, not a colour of its own");
});

await test("the switch for the folders the app hides by convention is in the tree's toolbar", () => {
  assert.match(prefs, /fileTreeShowGenerated: "pi-web:file-tree-show-generated"/, "the choice is remembered");
  assert.match(shell, /getPrefBool\(APP_PREF_KEYS\.fileTreeShowGenerated, false\)/, "read on open");
  assert.match(shell, /setPref\(APP_PREF_KEYS\.fileTreeShowGenerated, fileTreeShowGenerated \? "1" : "0"\)/, "and saved");
  assert.match(shell, /aria-pressed=\{fileTreeShowGenerated\}/, "the button states the mode it is in");
  assert.match(shell, /showHidden=\{fileTreeShowGenerated\}/, "and the tree is the one that asks for them");
  assert.match(explorer, /fetchEntries\(node\.fullPath, showHidden\)/, "an opened folder is listed with the same mode as the root");
  assert.match(explorer, /fetchEntries\(cwd, showHidden\)/, "and the root with it");
  assert.match(css, /\.context-panel-files-action\.is-active \{[\s\S]*?color: var\(--accent\);/, "the active switch reads as active");
});

await test("the tree's two new strings speak in all three languages", () => {
  for (const [name, source] of [["en", en], ["zh-CN", cn], ["zh-TW", tw]]) {
    for (const key of ["files.showGenerated", "files.gitExcluded"]) {
      assert.match(source, new RegExp(String.raw`"${key}": "[^"]+"`), `${key} is in ${name}`);
    }
  }
});

await test("the route's rule is the one the report needed", async () => {
  const route = await read("app/api/files/[...path]/route.ts");
  assert.match(route, /if \(hidden === "always"\) return \[\];/, ".git and .DS_Store stay out");
  assert.match(route, /if \(hidden === "excluded" && !showHidden\) return \[\];/,
    "only the convention list waits for the switch — what Git ignores is listed and marked");
});
