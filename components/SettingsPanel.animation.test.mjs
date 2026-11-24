import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The settings dialog's appearance and disappearance.
 *
 * The panel was added to and removed from the DOM on the click: the sheet blinked
 * in and out with no motion at all. An animation on close needs the panel to stay
 * mounted while it plays, so the owner (AppShell) owns the exit state and the
 * panel only carries the `is-closing` class.
 */

test("the shell keeps the dialog mounted for its exit animation", async () => {
  const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /const SETTINGS_EXIT_MS = 180;/, "the exit length is named, and matches --dur-base");
  assert.match(shell, /const \[settingsClosing, setSettingsClosing\] = useState\(false\);/);
  assert.match(shell, /setSettingsClosing\(true\);\s*settingsExitRef\.current = window\.setTimeout\(\(\) => \{\s*settingsExitRef\.current = null;\s*setSettingsSection\(null\);/,
    "the unmount happens when the animation is over, not on the click");
  assert.match(shell, /onClose=\{closeSettings\}\s*closing=\{settingsClosing\}/, "the panel is told it is closing");
  assert.ok(!shell.includes("onClose={() => {\n          setSettingsSection(null);"), "no unmount-on-click handler is left");
  // The shortcuts, the sidebar, the composer's bare /mcp and the update reminder all
  // open a section; that is what cancels an exit in flight — inside the open helper,
  // next to the state it changes.
  const open = shell.match(/const openSettings = useCallback\(\(section: SettingsSection\) => \{[\s\S]*?\}, \[\]\);/);
  assert.ok(open, "an open helper owns the cancel");
  assert.match(open[0], /window\.clearTimeout\(settingsExitRef\.current\);/);
  assert.match(open[0], /setSettingsClosing\(false\);\s*setSettingsSection\(section\);/,
    "it clears the exit flag before the section, so the panel re-enters in one commit");
  assert.match(shell, /const openSettingsSection = useCallback\(\(section: SettingsSection\) => \{\s*openSettings\(section\);\s*\}, \[openSettings\]\);/,
    "the composer's route into Settings opens through the same helper");
  // No effect may cancel the exit for a section that is merely still open: for the whole
  // exit the section *is* the one being closed, so an effect watching
  // `[settingsClosing, settingsSection]` cancelled every close the instant it started and
  // the sheet snapped back into its entrance — a dialog that would not close, with no
  // animation to be seen.
  assert.ok(!/if \(settingsSection && settingsClosing\)/.test(shell), "the exit is not cancelled by the section it is closing");
  const writers = [...shell.matchAll(/setSettingsSection\(([^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(writers, ["null", "section"],
    "only the exit timer closes and the open helper opens: every open routes through openSettings");
  assert.match(shell, /useEffect\(\(\) => \(\) => \{\s*if \(settingsExitRef\.current !== null\) window\.clearTimeout\(settingsExitRef\.current\);/,
    "the timer never outlives the shell");
});

test("the sheet and the scrim animate in and out, and stop for reduced motion", async () => {
  const panel = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(panel, /className=\{`settings-dialog-backdrop\$\{closing \? " is-closing" : ""\}`\}/);
  assert.match(panel, /className=\{`settings-dialog-surface\$\{closing \? " is-closing" : ""\}`\}/);
  // The entrance is the app's shared dialog motion; the fork added the reverse.
  assert.match(css, /\.settings-dialog-backdrop \{[\s\S]*?animation: native-backdrop-in/);
  assert.match(css, /\.settings-dialog-surface \{[\s\S]*?animation: native-modal-in/);
  assert.match(css, /\.settings-dialog-backdrop\.is-closing \{\n\s*animation: native-backdrop-out[\s\S]*?pointer-events: none;/);
  assert.match(css, /\.settings-dialog-surface\.is-closing \{\n\s*animation: native-modal-out[\s\S]*?pointer-events: none;/,
    "the closing sheet stops taking clicks");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s*\.settings-dialog-backdrop,\n\s*\.settings-dialog-surface,/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.settings-dialog-surface\.is-closing \{\n\s*animation: none;/,
    "the motion is opt-out, as everywhere else in the app");
});
