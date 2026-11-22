import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { appleScriptString } = await createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
}).import("./apple-script.ts");

const source = readFileSync(new URL("./apple-script.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// The bridge for the one macOS thing a browser page cannot do: raise a Notification Center
// notification. It used to build a folder panel too, for "Add project"; the app's own window
// (components/DirectoryPicker.tsx) replaced it, and the measurements that killed the panel
// are recorded in the module doc and docs/agents/files-and-access.md.
//
// No test here runs osascript: it would open a window on the machine running the tests.

test("an AppleScript string literal escapes the two characters that matter", () => {
  assert.equal(appleScriptString("Pi Agent"), '"Pi Agent"');
  assert.equal(appleScriptString('say "hi"'), '"say \\"hi\\""');
  assert.equal(appleScriptString("C:\\temp\\x"), '"C:\\\\temp\\\\x"');
  assert.equal(appleScriptString("line\nbreak"), '"line\nbreak"', "a newline is legal inside the literal");
  // The em dash and CJK go through as themselves; AppleScript source is UTF-8.
  assert.equal(appleScriptString("Pi — 会话"), '"Pi — 会话"');
});

test("no folder panel comes out of this module any more", () => {
  // Finder's `choose folder` activates Finder (the Dock bounce, the desktop forward); a panel
  // owned by a bare osascript is not the key window, so the keyboard stays in the browser tab.
  for (const code of ["POSIX path of", "with prompt", "set chosenItem", "path to home folder"]) {
    assert.ok(!source.includes(code), `the panel builder stays deleted — no ${code}`);
  }
  assert.ok(!source.includes("System Events"), "nothing activates a helper app to show a window");
  assert.ok(!source.includes("defaultLocation"), "no path hint goes into a panel");
  assert.ok(!source.includes("frontmost"), "no front-app capture, no focus hand-back to reimplement");
  assert.ok(!source.includes("folderPanelScript") && !source.includes("folderPanelLocation"),
    "the exports the folder picker used are gone, not left unused");
  assert.match(source, /components\/DirectoryPicker\.tsx/, "the doc says where the window lives now");
  assert.match(source, /app\/api\/notifications\/local/, "the doc says what is still built here");
});
