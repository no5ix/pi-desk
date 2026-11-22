import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The folder window's native-feeling half: a rail of places, a keyboard, a filter, an
// order, a hidden switch, pinned and recent folders.
//
// The window has to be good, because the web platform cannot give a native one: no browser
// folder input reports a folder path (the composer's file input answers with file contents
// and nothing else), and a session needs a path. So the app's own window reads the
// server's folders, and everything a native panel gives for free has to be built here.
// Node's type stripping does not read .tsx, so the component is tested as source, the way
// the rest of this window's tests are.
const picker = readFileSync(new URL("./DirectoryPicker.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const prefs = readFileSync(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
const placesRoute = readFileSync(new URL("../app/api/cwd/places/route.ts", import.meta.url), "utf8");
const browser = readFileSync(new URL("../lib/directory-browser.ts", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(^|\\n)${escaped} \\{([\\s\\S]*?)\\n\\}`, "m"));
  return match ? match[2] : "";
}

test("the rail names the folders people mean, and refuses the ones this computer cannot open", () => {
  assert.match(picker, /fetch\(`/, "the window calls the server");
  assert.ok(picker.includes("/api/cwd/places"), "the places are read from the server, not invented here");
  for (const id of ["home", "documents", "desktop", "downloads"]) {
    assert.ok(picker.includes(`${id}: "directoryPicker.place.${id}"`), `${id} is named in the app's language, not as a path`);
  }
  assert.match(picker, /enabled: place\.exists && place\.readable/, "a folder that is gone, or denied to this process, is not offered as openable");
  assert.match(picker, /disabled=\{!options\.enabled \|\| loading\}/, "and its row cannot be clicked");
  assert.match(placesRoute, /listStandardPlaces\(\)/, "the server answers with the folders under the user's home");
  assert.match(placesRoute, /reportDirectories\(requested\)/, "and with the state of the folders the window remembers");
});

test("the folders pinned here and taken here come back, kept in this browser", () => {
  for (const key of ["directoryPickerFavourites", "directoryPickerRecent", "directoryPickerSort", "directoryPickerHidden"]) {
    assert.ok(prefs.includes(`${key}: "pi-web:directory-picker-`), `${key} is a stored app preference`);
  }
  assert.match(picker, /getPrefJson<string\[\]>\(key\)/, "the remembered lists are read back");
  assert.match(picker, /setPrefJson\(APP_PREF_KEYS\.directoryPickerFavourites, next\)/, "pinning is written down");
  assert.match(picker, /setPrefJson\(APP_PREF_KEYS\.directoryPickerRecent, nextRecent\)/, "and a folder that was taken is remembered for the next open");
  assert.match(picker, /const FAVOURITES_MAX = \d+;/, "the rail stays a bounded length");
  assert.match(picker, /const RECENT_MAX = \d+;/);
  assert.match(picker, /forgetFavourite/, "a pin can be taken off again");

  // The commit point stays the one the callers trust: the window reports the path, and the
  // parent adopts it through /api/cwd/validate, which probes permissions.
  assert.match(picker, /chooseFolder\(currentPath\)/, "Select this folder is the commit");
  assert.match(picker, /onSelect\(path\)/, "reported to the parent, which validates it");
});

test("the keyboard drives the list the way a native panel's does", () => {
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]) {
    assert.ok(picker.includes(`event.key === "${key}"`), `${key} moves the caret`);
  }
  assert.match(picker, /if \(event\.key === "Enter"\)[\s\S]*?void navigateTo\(rows\[activeRow\]\.path\);/, "Enter opens the folder under the caret");
  assert.match(picker, /if \(event\.metaKey \|\| event\.ctrlKey\) \{\n\s*if \(canSelect\) chooseFolder\(currentPath\);/, "Cmd+Enter takes the folder in view");
  assert.match(picker, /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Enter" && canSelect/, "from anywhere in the window");
  assert.match(picker, /if \(event\.key === "Backspace"\)[\s\S]*?void navigateTo\(parentDirectory \?\? undefined\);/, "Backspace goes up a level");
  assert.match(picker, /event\.key\.toLowerCase\(\) === "g"/, "Cmd+Shift+G jumps to the path field, as a native panel does");
  assert.match(picker, /pathInputRef\.current\?\.focus\(\)/, "and puts the caret in it");
  assert.match(picker, /startsWith\(needle\)/, "typing a few letters jumps to the folder they name");
});

test("the list is walkable by a keyboard and a screen reader", () => {
  assert.match(picker, /role=\{drives === null \? "listbox" : undefined\}/, "a folder list, not a drive list");
  assert.match(picker, /role="option"/);
  assert.match(picker, /aria-selected=\{index === activeRow\}/);
  assert.match(picker, /aria-activedescendant=\{visibleDirectories\.length > 0 \? `directory-row-\$\{activeRow\}` : undefined\}/);
  assert.match(picker, /tabIndex=\{0\}/, "the list itself takes focus, so the arrows reach it");
  assert.match(picker, /aria-busy=\{loading\}/);
  assert.match(picker, /Math\.min\(activeIndex, visibleDirectories\.length - 1\)/, "a filter that empties the list leaves no caret behind");
});

test("the list has a filter, an order, and a hidden switch, all remembered", () => {
  assert.match(picker, /type="search"/, "a filter box over the rows");
  assert.match(picker, /entry\.name\.toLowerCase\(\)\.includes\(needle\)/, "it narrows the rows the server sent, and never adds any");
  assert.match(picker, /showHidden \|\| !isHiddenName\(entry\.name\)/, "hidden folders follow the switch");
  assert.match(picker, /<AppSelect/, "the order is the shared app select, not an OS menu");
  assert.match(picker, /directoryPicker\.sort\.name/, "by name");
  assert.match(picker, /directoryPicker\.sort\.date/, "or by last change");
  assert.match(picker, /\(right\.mtime \?\? 0\) - \(left\.mtime \?\? 0\)/, "newest first when ordered by date");
  assert.match(picker, /setPref\(APP_PREF_KEYS\.directoryPickerSort, mode\)/, "the order is remembered");
  assert.match(picker, /setPref\(APP_PREF_KEYS\.directoryPickerHidden/, "and so is the hidden switch");
  assert.match(picker, /aria-pressed=\{showHidden\}/, "the switch says whether it is on");
  assert.match(picker, /t\("directoryPicker\.noMatches"\)/, "a filter with no rows says so");
  assert.match(browser, /mtime\?: number/, "the server sends the time each folder last changed");
  assert.match(browser, /mtime: await modifiedTime\(entryPath\)/, "for plain folders");
  assert.match(browser, /mtime: entryStat\.mtimeMs/, "and for folders reached through a link");
});

test("a phone folds the rail above the list, and the rows keep the app's look", () => {
  const body = rule(".directory-picker-body");
  assert.match(body, /display: flex;/, "rail and list side by side on a wide window");
  const phone = css.match(/@media \(max-width: 640px\) \{\n\s*\.directory-picker-body \{\n\s*flex-direction: column;/);
  assert.ok(phone, "a narrow window moves the rail above the list");
  assert.match(rule(".directory-picker-rail"), /border-right: var\(--hairline\) solid var\(--border\);/);
  assert.match(rule(".directory-picker-rail"), /background: var\(--bg-panel\);/);
  assert.match(rule(".directory-picker-entry.is-active"), /background: var\(--bg-selected\);/, "the caret row is the app's selected colour");
  assert.match(rule(".directory-picker-list"), /outline: none;/);
  assert.match(rule(".directory-picker-list:focus-visible"), /box-shadow: inset 0 0 0 2px var\(--accent\);/, "a focused list shows it");
  assert.match(rule(".directory-picker-toggle[aria-pressed=\"true\"]"), /background: var\(--bg-selected\);/);
  assert.match(css, /\.directory-picker-forget \{\n\s*opacity: 0;\n\}/, "a row's unpin is revealed on contact, not shouted");
  assert.match(css, /\.directory-picker-rail-row:hover \.directory-picker-forget,[\s\S]*?opacity: 1;/, "and appears on hover or focus");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.directory-picker-panel,[\s\S]*?animation: none;/, "the fade stays optional");
});
