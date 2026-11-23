import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A phone's terminal raises the software keyboard only for a focus that *moves*
// to an editable field during the touch (upstream pi-web #1702). The panel keeps
// its field focused, so every plain `focus()` a tap makes is a no-op and no
// keyboard ever appears; the panel toggle and the Explorer's terminal action
// raise it from the tap that opens the panel through `lib/terminal-focus.ts`.

async function loadSubject() {
  return import("./terminal-focus.ts");
}

function makeField({ readOnly = false, connected = true, focused = false, label = "field" } = {}) {
  const field = {
    label,
    readOnly,
    isConnected: connected,
    focusCalls: 0,
    blurCalls: 0,
    focus() {
      this.focusCalls += 1;
      this.ownerDocument.activeElement = this;
      this.ownerDocument.focusEvents += 1;
    },
    blur() {
      this.blurCalls += 1;
      if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
    },
  };
  field.ownerDocument = { activeElement: focused ? field : null, body: { label: "body" }, focusEvents: 0 };
  return field;
}

test("a tap on an already-focused field blurs it first, so focus moves", async () => {
  const { registerTerminalInputField, focusTerminalInputFromTouch } = await loadSubject();
  const field = makeField({ focused: true });
  registerTerminalInputField("tab-a", field);
  assert.equal(focusTerminalInputFromTouch("tab-a"), true);
  assert.equal(field.blurCalls, 1, "the focus has to leave the field to be able to arrive");
  assert.equal(field.focusCalls, 1, "and land back inside the same gesture");
  assert.equal(field.ownerDocument.activeElement, field);
  assert.equal(field.ownerDocument.focusEvents, 1, "one focus event per tap");
});

test("a tap on an unfocused field only focuses it", async () => {
  const { registerTerminalInputField, focusTerminalInputFromTouch } = await loadSubject();
  const field = makeField();
  registerTerminalInputField("tab-b", field);
  assert.equal(focusTerminalInputFromTouch("tab-b"), true);
  assert.equal(field.blurCalls, 0, "nothing to leave");
  assert.equal(field.focusCalls, 1);
});

test("a connecting terminal's read-only field never takes the focus", async () => {
  const { registerTerminalInputField, focusTerminalInputFromTouch } = await loadSubject();
  // xterm mirrors `disableStdin` onto the field's `readOnly`, and iOS opens no
  // keyboard for a read-only field: focusing it would only hide the page's focus.
  const field = makeField({ readOnly: true });
  const composer = makeField({ focused: true, label: "composer" });
  registerTerminalInputField("tab-connecting", field);
  assert.equal(focusTerminalInputFromTouch("tab-connecting"), false);
  assert.equal(field.focusCalls, 0);
  assert.equal(composer.ownerDocument.activeElement, composer, "the page keeps its focus");
});

test("a field that left the DOM is declined, and retiring one by id works", async () => {
  const { registerTerminalInputField, focusTerminalInputFromTouch } = await loadSubject();
  const gone = makeField({ connected: false });
  registerTerminalInputField("tab-closed", gone);
  assert.equal(focusTerminalInputFromTouch("tab-closed"), false);
  assert.equal(gone.focusCalls, 0, "a detached field cannot show a keyboard");

  const live = makeField();
  registerTerminalInputField("tab-alive", live);
  registerTerminalInputField("tab-alive", null);
  assert.equal(focusTerminalInputFromTouch("tab-alive"), false, "a closed tab's field is off the registry");
});

test("without a tab, the most recently mounted field answers", async () => {
  const { registerTerminalInputField, focusTerminalInputFromTouch } = await loadSubject();
  const first = makeField({ label: "first" });
  const last = makeField({ label: "last" });
  registerTerminalInputField("tab-1", first);
  registerTerminalInputField("tab-2", last);
  assert.equal(focusTerminalInputFromTouch(), true);
  assert.equal(last.focusCalls, 1, "the panel shows the newest tab's panel");
  assert.equal(first.focusCalls, 0);

  // An unknown id falls back to it rather than declining the tap.
  const panelField = makeField({ label: "unknown id" });
  registerTerminalInputField("tab-3", panelField);
  assert.equal(focusTerminalInputFromTouch("tab-unknown"), true);
  assert.equal(panelField.focusCalls, 1);
});

test("the panel publishes its field, retires it, and takes the focus change itself", async () => {
  const source = await readFile(new URL("../components/TerminalPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ registerTerminalInputField \} from "@\/lib\/terminal-focus";/);
  assert.match(source, /registerTerminalInputField\(id, terminal\.textarea \?\? null\);/, "the mounted field is published");
  assert.match(source, /registerTerminalInputField\(id, null\);/, "the cleanup retires it");

  const tap = source.slice(source.indexOf("const focusFromTouch"), source.indexOf('container.addEventListener("pointerdown"'));
  assert.match(tap, /terminal\.textarea/, "the tap works on xterm's own input field");
  assert.match(tap, /activeElement === field\) field\.blur\(\);/, "a focused field is blurred, so the tap moves focus");
  assert.match(tap, /terminal\.focus\(\);/, "and lands back in the terminal");

  // The first message opens input: WebKit gives no guarantee EventSource's
  // `open` fires, and a read-only field opens no keyboard.
  const stream = source.slice(source.indexOf("events.onmessage"), source.indexOf("events.onopen"));
  assert.match(stream, /terminal\.options\.disableStdin = false;/);
});

test("the panel toggle opens a terminal, not the file list, and raises the keyboard", async () => {
  const appShell = await readFile(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
  const toggle = appShell.match(/const handleRightPanelToggle = useCallback\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(toggle, "the panel toggle is a callback of its own");
  assert.match(appShell, /import \{ focusTerminalInputFromTouch \} from "@\/lib\/terminal-focus";/);
  assert.match(appShell, /const liveTerminal = terminalTabs\.find\(\(tab\) => !tab\.closing\);/);
  assert.match(appShell, /focusTerminalInputFromTouch\(liveTerminal\.id\);/, "the tap that opens the panel focuses the terminal");
  assert.match(appShell, /handleOpenTerminal\(visibleProjectCwd\);/, "a panel with no terminal opens one");
  assert.ok(appShell.indexOf("const handleRightPanelToggle") > appShell.indexOf("const handleOpenTerminal = useCallback"),
    "the toggle is declared after handleOpenTerminal, so the callback is initialized when its deps read it");
  assert.doesNotMatch(toggle[0], /setRightPanelOpen\(\(open\) =>/, "the open path no longer runs through the updater's `!open` test");
  // The file list stays behind its own button; only a panel where no terminal is
  // possible (a chat) still lands on the tree.
  const opensWithTree = toggle[0].match(/setFileTreeOpen\(true\)/g) ?? [];
  assert.equal(opensWithTree.length, 1, "the file tree is the fallback only where no terminal is possible");
});
