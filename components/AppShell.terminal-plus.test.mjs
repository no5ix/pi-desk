import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The panel's tab strip, as the phone meets it: a `+` that opens a shell, a box a
// thumb can hit, and tabs a user can tell apart.

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("the strip's `+` opens a shell, it does not reopen the one that is there", () => {
  // The user's report: on a phone the button did nothing. `handleOpenTerminal` looked
  // up the project's existing tab, found the restored shell, and its tap only moved
  // the focus into that shell's input field: the strip came back exactly as it was.
  const handler = appShell.slice(
    appShell.indexOf("const handleOpenTerminal = useCallback"),
    appShell.indexOf("Opening the panel opens the project's shell"),
  );
  assert.ok(handler.length > 300, "the handler is in AppShell");
  assert.match(handler, /cwd: string, options\?: \{ newTab\?: boolean \}/, "the caller says what it wants");
  assert.match(handler, /const existing = options\?\.newTab \? undefined : terminalTabs\.find/, "a `+` creates a tab, it never adopts one");
  assert.match(appShell, /onNewTerminal=\{visibleProjectCwd \? \(\) => handleOpenTerminal\(visibleProjectCwd, \{ newTab: true \}\) : undefined\}/,
    "the strip's button is that caller");
  // Opening the panel is the other caller, and it keeps the project's existing shell.
  const toggle = appShell.slice(appShell.indexOf("const handleRightPanelToggle = useCallback"), appShell.indexOf("}, [activeFileTabId, isMobile, panelTabs"));
  assert.match(toggle, /handleOpenTerminal\(visibleProjectCwd\)/, "the panel toggle keeps the reuse, and says nothing about a new tab");
});

test("two shells in one folder are numbered, a lone shell keeps the folder's name", () => {
  const block = appShell.slice(appShell.indexOf("const terminalPanelTabs = useMemo"), appShell.indexOf("const panelTabs: Tab[] = useMemo"));
  assert.ok(block.length > 300, "the terminal tabs are built in their own memo");
  assert.match(block, /perCwd\.set\(tab\.cwd, \(perCwd\.get\(tab\.cwd\) \?\? 0\) \+ 1\)/, "the folder's shells are counted");
  assert.match(block, /label: \(perCwd\.get\(tab\.cwd\) \?\? 1\) > 1 \? `\$\{name\} \$\{n\}` : name/, "the second shell is named by its number, the first stays itself");
  assert.match(appShell, /orderPanelTabs\(\[\.\.\.fileTabs, \.\.\.terminalPanelTabs,/, "the panel's strip takes the named tabs");
});

test("the strip's icon buttons are finger-sized", () => {
  // 28px is a desktop box. On a phone the strip's `+` is the control whose tap showed
  // nothing at all, and a thumb landing beside it is the same experience twice.
  const coarse = css.match(/@media \(pointer: coarse\) \{([^}]*\{[^}]*\})*/g) ?? [];
  const rules = css.match(/\.file-tab-add,\s*\.file-workbench-icon-button \{[\s\S]*?\}/g) ?? [];
  const joined = coarse.join("\n") + "\n" + rules.join("\n");
  assert.match(joined, /\.right-panel-tab-strip > \.file-tree-toggle,/, "the file-list toggle is raised with it: the row's two icon buttons stay one size");
  assert.match(rules.join("\n"), /width: 36px;\s*height: 36px;\s*flex-basis: 36px;/, "36px inside the strip's 48px row");
});
