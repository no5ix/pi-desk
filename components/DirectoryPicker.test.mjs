import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The app's folder window (components/DirectoryPicker.tsx). "Add project" in a browser tab
// opens it titled "Choose folder"; the project picker's browse opens it with its own title.
// It is a web window on purpose: a browser tab cannot own a native panel (Finder's activates
// Finder, a bare osascript panel is not the key window), and the browser's own folder input
// is a file chooser titled "Choose Files to Upload" that reports no folder path.
//
// What is pinned here is the contract the two callers rely on: the folders-only list, the
// title, and the entrance/exit animation shared with the app's other modals.

// Node's type stripping does not read .tsx, so the component is tested as source plus the
// one value its animation contract depends on.
const picker = readFileSync(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const closeMs = Number(picker.match(/export const DIRECTORY_PICKER_CLOSE_MS = (\d+);/)[1]);
const sidebar = readFileSync(new URL("./SessionSidebar.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const projectPicker = readFileSync(new URL("./ProjectPicker.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(^|\\n)${escaped} \\{([\\s\\S]*?)\\n\\}`, "m"));
  return match ? match[2] : "";
}

test("the window lists folders, so a pick cannot be a file", () => {
  // The browse route answers with directories only, and the component renders exactly that:
  // drives, then the subdirectories of the folder in view. No file entry is rendered, so the
  // user cannot click a file — which is what a project folder needs.
  assert.match(picker, /directories\?: DirectoryEntry\[\]/, "the browse answer is a list of directories");

  assert.ok(!/\bfiles\b/.test(picker), "no file list enters this window");
  assert.match(picker, /drives\.map\(\(drive\) =>/, "drives come first, on Windows");
  assert.match(picker, /directories\.map\(\(entry\) =>/, "then the folders inside the folder in view");
  const browse = readFileSync(new URL("../app/api/cwd/browse/route.ts", import.meta.url), "utf8");
  assert.match(browse, /listDirectories\(/, "the server lists directories");
  assert.match(browse, /directoryStat\.isDirectory\(\)/, "and refuses a file as the starting folder");
});

test("the title says what this window is for", () => {
  assert.match(picker, /title\?: string;/, "a caller names the job");
  assert.match(picker, /aria-label=\{title \?\? t\("directoryPicker\.selectDirectory"\)\}/,
    "the accessible name is the title, so a screen reader says Choose folder too");
  assert.match(picker, /fontSize: "var\(--fs-title\)" \}\}>\{title \?\? t\("directoryPicker\.selectDirectory"\)\}/);
  assert.match(sidebar, /<DirectoryPicker\n\s*title=\{t\("sidebar\.chooseFolderTitle"\)\}/);
  const usage = projectPicker.match(/<DirectoryPicker\n([\s\S]*?)\/>/);
  assert.ok(usage && !usage[1].includes("title="),
    "the project picker keeps the component's own title — the prop is additive");
});

test("every way out fades the window, and the delay matches the CSS", () => {
  const close = picker.match(/const requestClose = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[onCancel\]\);/);
  assert.ok(close, "one dismissal path, so no way out jumps the animation");
  assert.match(close[0], /setClosing\(true\);\n\s*setTimeout\(\(\) => onCancel\(\), DIRECTORY_PICKER_CLOSE_MS\);/);
  for (const [what, pattern] of [
    ["the backdrop click", /onClick=\{\(event\) => \{\n\s*if \(event\.target === event\.currentTarget && !busy && !closing\) requestClose\(\);/],
    ["Escape", /if \(event\.key === "Escape" && !busy && !closing && !isImeComposing\(event\)\) requestClose\(\);/],
    ["the close button", /onClick=\{requestClose\}\n\s*disabled=\{busy \|\| closing\}/],
    ["the Cancel button", /onClick=\{requestClose\} disabled=\{busy \|\| closing\}/],
  ]) {
    assert.match(picker, pattern, `${what} has to go through requestClose`);
  }
  // A bare onCancel in a dismissal handler is the bug: the parent unmounts the window and
  // it disappears between two paints instead of fading.
  assert.ok(!picker.includes("onClick={onCancel}"), "no dismissal path unmounts the window directly");
  assert.ok(!/\) onCancel\(\)/.test(picker), "not the backdrop click, not Escape");

  const cssDuration = css.match(/^  --dur-base: (\d+)ms;$/m);
  assert.ok(cssDuration, "the app's base modal duration is a token");
  assert.equal(closeMs, Number(cssDuration[1]),
    "the panel's fade-out and the unmount have to agree, or the fade is cut off");
});

test("it arrives and leaves with the app's shared modal animation", () => {
  const backdrop = rule(".directory-picker-backdrop");
  const panel = rule(".directory-picker-panel");
  assert.match(backdrop, /animation: native-backdrop-in var\(--dur-base\) var\(--ease-native\) both;/);
  assert.match(panel, /animation: native-modal-in var\(--dur-base\) var\(--ease-sheet\) both;/,
    "the same keyframes the settings dialog uses (native-modal-in), not a private one");
  assert.match(backdrop, /backdrop-filter: blur\(3px\) saturate\(110%\)/, "the shared blurred scrim");

  const closingBackdrop = rule(".directory-picker-backdrop.is-closing");
  const closingPanel = rule(".directory-picker-panel.is-closing");
  assert.match(closingBackdrop, /animation: native-backdrop-out var\(--dur-base\) var\(--ease-native\) both;/);
  assert.match(closingPanel, /animation: native-modal-out var\(--dur-base\) var\(--ease-sheet\) both;/);
  assert.match(closingBackdrop, /pointer-events: none;/, "a fading window is not clickable");
  for (const name of ["native-backdrop-out", "native-modal-out"]) {
    assert.match(css, new RegExp(`@keyframes ${name} \\{[\\s\\S]*?opacity: 0;`), `${name} has to end transparent`);
  }
  assert.match(picker, /className=\{`directory-picker-backdrop\$\{closing \? " is-closing" : ""\}\`\}/);
  assert.match(picker, /className=\{`directory-picker-panel\$\{closing \? " is-closing" : ""\}\`\}/);

  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\n\s*\.directory-picker-backdrop,\n\s*\.directory-picker-panel,[\s\S]*?\n\}/);
  assert.ok(reduced, "reduced motion: no animation, and the window still closes (the timer is not motion)");
  assert.match(reduced[0], /animation: none;/);
});

test("choosing a folder is reported at once, not after a fade", () => {
  const select = picker.match(/onClick=\{\(\) => onSelect\(currentPath\)\}/);
  assert.ok(select, "the Select button reports the path straight away");
  assert.ok(!picker.includes("requestClose(() =>"), "no fade wrapper around a choice");
});
