// The file editor: edit mode, the save, and the unsaved-change protection.
//
// Like the panel tests, these read the source they describe: the behaviour
// lives in a browser component, and what is worth pinning is which channel
// connects which layer, that the save is refused by the server, and that a
// disk write never lands on top of what the user typed.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });

const viewer = fs.readFileSync("components/FileViewer.tsx", "utf8");
const shell = fs.readFileSync("components/AppShell.tsx", "utf8");
const tabs = fs.readFileSync("components/TabBar.tsx", "utf8");
const editor = fs.readFileSync("components/CodeEditor.tsx", "utf8");
const state = fs.readFileSync("lib/file-viewer-state.ts", "utf8");
const theme = fs.readFileSync("app/native-theme.css", "utf8");

await test("Edit is a display mode, offered only for a text file that is not binary", () => {
  assert.match(state, /export type FileViewerDisplayMode = "source" \| "preview" \| "diff" \| "edit"/);
  assert.match(viewer, /edit: "Edit",/, "the mode switch names it");
  assert.match(viewer, /const canEdit = !isBinary && !isDeletedDiff && isEditableExtension\(filePath\);/);
  assert.match(viewer, /\.\.\.\(canEdit \? \["edit" as const\] : \[\]\)/, "the button appears with the mode");
});

await test("the editor is mounted over the file, and its buffer is the source of truth", () => {
  assert.match(viewer, /effectiveDisplayMode === "edit" \? \(\s*<div className="file-editor-host">/);
  assert.match(viewer, /<CodeEditor[\s\S]{0,400}value=\{draft \?\? content\}/);
  assert.match(viewer, /setDraftAndDirty\(value === content \? null : value\)/, "typing back to the disk text clears the dirty flag");
  assert.match(viewer, /onSave=\{\(\) => void saveDraft\(\)\}/);
});

await test("the save is a PUT to the file API, against the disk time the file was read at", () => {
  assert.match(viewer, /method: "PUT"/);
  assert.match(viewer, /body: JSON\.stringify\(\{ content: buffer, baseMtime: baseMtimeRef\.current, allowOverwrite: options\.overwrite === true \}\)/);
  // The refusal codes drive the save bar; the client does not guess.
  assert.match(viewer, /const code = payload\.code \?\? String\(response\.status\);/);
  assert.match(viewer, /code === "CONFLICT" \? "conflict" : "error"/);
  // The read follows a save, so a formatter that rewrote the file is visible.
  assert.match(viewer, /void fetchContent\(filePath\);/, "the buffer is re-read after a save");
});

await test("Cmd and Ctrl+S save while the file is open in the editor", () => {
  assert.match(viewer, /if \(displayMode !== "edit"\) return;/);
  assert.match(viewer, /event\.key\.toLowerCase\(\) !== "s"/);
  assert.match(viewer, /window\.addEventListener\("keydown", onKeyDown, true\)/, "capture, so the editor's own binding is not the only path");
  assert.match(editor, /monaco\.KeyMod\.CtrlCmd \| monaco\.KeyCode\.KeyS/, "and inside Monaco itself");
});

await test("a change on disk never overwrites what the user typed", () => {
  assert.match(viewer, /if \(draftRef\.current !== null\) \{\s*setExternalChange\(true\);\s*return;\s*\}/);
  assert.match(viewer, /t\("files\.editorExternalChange"\)/);
  assert.match(viewer, /t\("files\.editorReload"\)/, "the reload is offered, not applied");
  // A save over a change the watcher saw is the user's explicit choice.
  assert.match(viewer, /saveDraft\(\{ overwrite: true \}\)/);
});

await test("the buffer belongs to the tab, so a tab switch does not lose it", () => {
  assert.match(viewer, /onDraftChange\?: \(draft: string \| null\) => void;/);
  assert.match(viewer, /const \[draft, setDraft\] = useState<string \| null>\(initialDraft \?\? null\)/);
  assert.match(shell, /const handleFileDraftChange = useCallback\(\(tabId: string, draft: string \| null\) => \{\s*setFileTabs\(\(prev\) => prev\.map\(\(tab\) => \(tab\.id === tabId \? \{ \.\.\.tab, draft \} : tab\)\)\)/);
  assert.match(shell, /initialDraft=\{activeFileTab\.draft \?\? null\}/);
  assert.match(tabs, /draft\?: string \| null;/);
});

await test("a tab with unsaved changes says so, and closing it asks first", () => {
  assert.match(tabs, /dirty\?: boolean;/);
  assert.match(tabs, /tab\.dirty \? \(\s*<span\s*className="file-tab-dirty"/);
  assert.match(shell, /const handleFileDirtyChange = useCallback\(\(tabId: string, dirty: boolean\) =>/);
  assert.match(shell, /if \(closing\?\.dirty && !window\.confirm\(translate\("files\.editorCloseUnsaved"\)\)\) return;/);
});

await test("completion is the document's words, with nothing from a language service", () => {
  assert.match(editor, /wordBasedSuggestions: "off"/);
  // The kind an item carries decides whether Monaco keeps it: the suggest model
  // builds a disabled-kinds set from the `editor.suggest.*` switches and drops
  // matching items, silently, with the popup reading "No suggestions". The
  // document's words are `CompletionItemKind.Text`, so `showWords` is on — the
  // word provider Monaco would own is the one switched off above.
  assert.match(editor, /showWords: true/, "the kind our items carry stays enabled");
  assert.match(editor, /CompletionItemKind\.Text/, "the document's words are Text items, not Keywords");
  assert.match(editor, /import \{ completeWords, collectDocumentWords, prefixAtCaret \} from "@\/lib\/editor\/word-completions"/);
  assert.match(editor, /completeWords\(cached\.index, prefix, \{ excludeWord: prefix \}\)/);
  assert.match(editor, /monaco\.languages\.registerCompletionItemProvider\("\*"/);
  assert.match(editor, /tabCompletion: "on"/, "Tab completes, as Sublime's did");
  assert.match(editor, /acceptSuggestionOnEnter: "on"/);
});

await test("the editor paints with the generated Ayu Monokai theme, not a hand-copied palette", () => {
  assert.match(editor, /monaco\.editor\.defineTheme\(EDITOR_THEME, \{/);
  assert.match(editor, /base: "vs-dark",/);
  assert.match(editor, /rules: ayuMonokaiMonacoRules\.map/);
  assert.match(editor, /colors: ayuMonokaiMonacoColors/);
  assert.match(editor, /theme: EDITOR_THEME/);
  assert.match(editor, /import \{\s*AYU_MONOKAI_NAME,[\s\S]*?\} from "@\/lib\/editor\/ayu-monokai";/);
  assert.match(editor, /theme: EDITOR_THEME,/);
  // The palette is generated from the vendored theme file, and the generator is
  // the only place a colour literal appears.
  const generated = fs.readFileSync("lib/editor/ayu-monokai.ts", "utf8");
  assert.match(generated, /GENERATED by scripts\/build-ayu-monokai\.mjs/);
  assert.match(generated, /Source: vendor\/ayu-monokai/);
  assert.match(generated, /"editor\.background": "#0b0e14"/, "the theme's own canvas");
  assert.match(generated, /"editor\.foreground": "#bfbdb6"/);
});

await test("the editor's CSS is tokens only, in the fork's stylesheet", () => {
  const block = theme.slice(theme.indexOf(".file-editor-host"));
  assert.ok(block.length > 100, "the editor styles are in native-theme.css");
  const editorCss = theme.slice(theme.indexOf("/* The file editor"), theme.indexOf("@media (max-width: 640px)", theme.indexOf("/* The file editor")));
  assert.doesNotMatch(editorCss, /#[0-9a-fA-F]{3,8}\b/, "no invented palette");
  assert.doesNotMatch(editorCss, /rgba?\(/, "no raw alpha");
  assert.doesNotMatch(editorCss, /font-size: \d+px/, "type comes from the app's scale");
  assert.match(editorCss, /background: var\(--bg\);/, "the editor sits on the app's code surface token");
  // Monaco measures the box it is mounted in: the host and the Monaco div need
  // heights of their own, or the editor paints a strip. Lost rules, found here.
  assert.match(editorCss, /\.code-editor-host \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0;/);
  assert.match(editorCss, /\.code-editor-monaco \{[\s\S]*?width: 100%;[\s\S]*?flex: 1 1 auto;/);
});

await test("every save-bar string exists in the three locales", async () => {
  const keys = [...viewer.matchAll(/t\("(files\.editor[A-Za-z]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length >= 10, `the bar states its states in words (${keys.length} keys)`);
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const pack = await jiti.import(`../lib/i18n/messages/${locale}.ts`);
    const localePack = Object.values(pack).find((value) => value && typeof value === "object" && "messages" in value)
      ?? Object.values(pack.default ?? {}).find((value) => value && typeof value === "object" && "messages" in value);
    const messages = localePack.messages;
    assert.ok(messages, `${locale} exports a message table`);
    for (const key of new Set(keys)) {
      assert.ok(messages[`files.${key.slice("files.".length)}`], `${locale} says "${key}"`);
    }
  }
});

await test("the languages the editor opens are the ones the viewer can show", async () => {
  const { isEditableExtension, languageForPath } = await jiti.import("../lib/editor/language.ts");
  assert.equal(isEditableExtension("src/App.tsx"), true);
  assert.equal(languageForPath("src/App.tsx"), "typescript");
  assert.equal(languageForPath("notes.md"), "markdown");
  assert.equal(languageForPath("app.json"), "json");
  assert.equal(isEditableExtension("image.png"), false, "an image has a viewer, not an editor");
  assert.equal(isEditableExtension("bundle.wasm"), false, "so has a binary");
  assert.equal(isEditableExtension("Makefile"), true, "a well-known name carries its language");
  assert.equal(languageForPath("Makefile"), "makefile");
  assert.equal(isEditableExtension("LICENSE"), true, "an extension-less text file is text");
});
