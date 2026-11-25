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

test("a phone folds the rail above the list, and the blocks are told apart by colour, not lines", () => {
  const body = rule(".directory-picker-body");
  assert.match(body, /display: flex;/, "rail and list side by side on a wide window");
  const phone = css.match(/@media \(max-width: 640px\) \{\n\s*\.directory-picker-body \{\n\s*flex-direction: column;/);
  assert.ok(phone, "a narrow window moves the rail above the list");

  // Two tones, no dividers: the window's frame (the rail, the footer band, the sheet's head)
  // is the base tone, and the reading surface — the title, the path field, the list's own
  // toolbar and the folders — is the app's raised card tone.
  assert.match(rule(".directory-picker-rail"), /background: var\(--bg\);/, "the rail is the window's frame tone");
  assert.doesNotMatch(rule(".directory-picker-rail"), /border/);
  assert.doesNotMatch(phone ? phone[0] : css, /border/, "and it keeps no divider line on a phone");
  for (const selector of [".directory-picker-header", ".directory-picker-pathbar", ".directory-picker-main"]) {
    assert.match(rule(selector), /background: var\(--surface-elevated\);/, `${selector} is the raised card tone`);
  }
  assert.match(rule(".directory-picker-footer"), /background: var\(--bg\);/, "the footer band is the frame tone");
  assert.match(rule(".directory-picker-sheet-header"), /background: var\(--bg\);/);
  assert.match(picker, /background: "var\(--surface-elevated\)", width: 400/, "the new-directory sheet is a card with a band");
  for (const selector of [".directory-picker-toolbar", ".directory-picker-footer", ".directory-picker-main", ".directory-picker-sheet-header", ".directory-picker-header", ".directory-picker-pathbar"]) {
    assert.doesNotMatch(rule(selector), /border/, `${selector} is a block, not a box`);
  }
  // No hairlines anywhere: the shadow is the window's edge over the scrim, and every
  // control is a filled chip. Asked after a screenshot — the panel's outlines read as a grid.
  assert.ok(!picker.includes("var(--hairline) solid var(--border)"), "the window and its controls keep no outline");
  assert.match(picker, /border: 0,/, "the inline styles switch every border off");
  for (const selector of [".directory-picker-filter", ".directory-picker-toggle", ".directory-picker-toolbar .app-select-trigger"]) {
    assert.doesNotMatch(rule(selector), /border: var\(--hairline\)/, `${selector} is a chip, not an outlined box`);
  }
  // With no line left, the background is a footer button's only affordance, and the two
  // secondary actions must not read as one control: "New directory" is the accent chip.
  assert.match(rule(".directory-picker-action.is-secondary"), /color-mix\(in srgb, var\(--text\) 14%, var\(--surface-elevated\)\)/, "the neutral chip is a solid wash over an opaque base");
  assert.match(rule(".directory-picker-action.is-emphasis"), /color-mix\(in srgb, var\(--accent\)/);
  assert.match(picker, /className="directory-picker-action is-emphasis"/, "New directory is the accent chip");
  assert.match(picker, /className="directory-picker-action is-secondary"/, "Cancel is the neutral chip");
  assert.match(css, /\.directory-picker-back:focus-visible,[\s\S]*?box-shadow: inset 0 0 0 2px var\(--accent\);/, "a borderless control still shows the keyboard on it");
  // Asked after a screenshot of the focused field: "when I focus it, don't give it a border".
  // The window focuses the path field on open, so any ring around it is a line the user
  // stares at while typing; a focused field only deepens its own chip.
  for (const selector of [".directory-picker-path:focus-visible", ".directory-picker-filter:focus-visible"]) {
    assert.doesNotMatch(rule(selector), /inset|2px var\(--accent\)/, `${selector} shows no ring`);
    assert.match(rule(selector), /box-shadow: none/, `${selector} clears the ring the chips keep`);
    assert.match(rule(selector), /color-mix\(in srgb, var\(--text\) 12%, var\(--bg-panel\)\)/, `${selector} deepens its chip while focused`);
  }
  assert.ok(!picker.includes("borderBottom") && !picker.includes("borderTop"),
    "no divider line is set inline on a band");

  assert.match(rule(".directory-picker-entry.is-active"), /background: var\(--bg-selected\);/, "the caret row is the app's selected colour");
  assert.match(rule(".directory-picker-entry"), /color: var\(--text\);/, "the folder names are the readable tone on the card");
  assert.match(rule(".directory-picker-rail-link"), /color: var\(--text-muted\);/, "the rail's rows stay the secondary tone");
  assert.match(rule(".directory-picker-rail-row:hover"), /background: var\(--bg-selected\);/);
  assert.match(rule(".directory-picker-list"), /outline: none;/);
  assert.match(rule(".directory-picker-list:focus-visible"), /box-shadow: inset 0 0 0 2px var\(--accent\);/, "a focused list shows it");
  assert.match(rule(".directory-picker-toggle[aria-pressed=\"true\"]"), /background: var\(--bg-selected\);/);
  assert.match(rule(".directory-picker-toolbar .app-select-trigger"), /width: auto;/, "the toolbar stays one row of controls");
  assert.match(css, /\.directory-picker-forget \{\n\s*opacity: 0;\n\}/, "a row's unpin is revealed on contact, not shouted");
  assert.match(css, /\.directory-picker-rail-row:hover \.directory-picker-forget,[\s\S]*?opacity: 1;/, "and appears on hover or focus");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.directory-picker-panel,[\s\S]*?animation: none;/, "the fade stays optional");
});

test("the folder list is the window's scroll pane, and the keyboard keeps its row in view", () => {
  // A project's folder holds far more rows than the window shows, and the panel clips for
  // its rounded corners: a list left to overflow hides the folders below the fold with no
  // wheel, no keyboard and no way in.
  const list = rule(".directory-picker-list");
  assert.match(list, /flex: 1 1 auto;/, "the list takes the room between the toolbar and the footer");
  assert.match(list, /min-height: 0;/, "a flex child needs the floor to shrink below its own content");
  assert.match(list, /overflow-y: auto;/, "the list scrolls, so every folder stays reachable");
  assert.match(list, /overscroll-behavior: contain;/, "scrolling past the last row does not scroll the page behind the window");
  assert.match(list, /padding-bottom: 8px;/, "the last row keeps a margin over the footer band");

  // A scrollable listbox has to keep its caret visible, and open at the top.
  assert.match(picker, /listRef\.current\.scrollTop = 0;/, "a folder opens at its first row, not where its parent was left");
  assert.ok(picker.includes('.scrollIntoView({ block: "nearest" })'),
    "arrows, Page keys, Home, End and type-ahead keep the caret's row on screen");
  assert.match(picker, /document\.activeElement !== list/, "a mouse crossing the edge of the last visible row leaves the list where it is");
});
