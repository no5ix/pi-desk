import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A phone's keyboard opens for a focus that *moves* to an editable field during a gesture, for
// nothing at all when the field is already the active element, and for nothing while it is
// read-only (upstream pi-web #1702). That is the report "tapping the terminal never opens the
// keyboard, and the first tap after a Restart does": the panel focuses its own field, so every
// later tap is a focus that does not move. The answers sit in three places " the panel does not
// focus the field on a touch device, a tap inside it releases the field on finger-down and
// focuses it on finger-up, and the panel grows a visible always-editable command line. The panel
// toggle and the Explorer's terminal action reach the fields through this registry.

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

test("the panel publishes its field, retires it, and splits a tap into release and lift", async () => {
  const source = await readFile(new URL("../components/TerminalPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ isTouchFocusDevice, registerTerminalInputField \} from "@\/lib\/terminal-focus";/);
  assert.match(source, /registerTerminalInputField\(id, terminal\.textarea \?\? null\);/, "the mounted field is published");
  assert.match(source, /registerTerminalInputField\(id, null\);/, "the cleanup retires it");

  const tap = source.slice(source.indexOf("let raisedOnLift"), source.indexOf('container.addEventListener("pointerdown"'));
  assert.ok(tap.length > 100, "the tap handlers were found");
  const release = tap.slice(tap.indexOf("const releaseOnTouch"), tap.indexOf("const raiseOnTouch"));
  const raise = tap.slice(tap.indexOf("const raiseOnTouch"));
  assert.match(release, /terminal\.textarea/, "the finger landing works on xterm's own input field");
  assert.match(release, /activeElement === field\) field\.blur\(\);/, "a focused field lets go, so the lift is a focus change");
  assert.doesNotMatch(release, /terminal\.focus\(\)/, "the landing never focuses");
  assert.match(raise, /terminal\.focus\(\);/, "the lift focuses the terminal");
  assert.doesNotMatch(raise, /\.blur\(\)/, "and never blurs: blur and focus inside one gesture read as no net change, which is why the first fix (blur, then focus, in one handler) did nothing");
  assert.match(source, /container\.addEventListener\("pointerdown", releaseOnTouch, true\);\n\s*container\.addEventListener\("touchstart", releaseOnTouch, true\);\n\s*container\.addEventListener\("touchend", liftFromTouch, true\);\n\s*container\.addEventListener\("pointerup", liftFromPointer, true\);/,
    "down releases and the lift focuses, in both event families, in the capture phase");
  assert.match(source, /container\.removeEventListener\("touchend", liftFromTouch, true\);/, "the lift's listener is a named function, so the cleanup removes it");

  // The panel must not park the caret in the field on its own on a phone: that is the state
  // that makes every later tap a focus that does not move (the Restart clue).
  assert.match(source, /if \(container\.offsetWidth && container\.offsetHeight && !isTouchFocusDevice\(\)\) terminal\.focus\(\);/, "connect focuses on a mouse, not on a phone");
  assert.match(source, /if \(active && !isTouchFocusDevice\(\)\) terminalRef\.current\?\.focus\(\);/, "the tab becoming active does the same");

  // The first message opens input: WebKit gives no guarantee EventSource's `open` fires, and a
  // read-only field opens no keyboard.
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

test("on a touch device the panel toggle leaves the field alone", async () => {
  // One tap on the toggle is one gesture: it cannot be split into release-and-lift, and the
  // field is usually still read-only while the shell connects, so it opens no keyboard
  // anyway. Parking the caret there is the state that swallows every tap the user makes next,
  // so the registry declines and the panel's own handlers raise the keyboard.
  const { isTouchFocusDevice, registerTerminalInputField, focusTerminalInputFromTouch } = await loadSubject();
  const field = makeField({ label: "touch" });
  registerTerminalInputField("tab-touch", field);
  globalThis.window = {
    matchMedia: (query) => ({ matches: query === "(pointer: coarse)", addEventListener: () => {}, removeEventListener: () => {} }),
  };
  try {
    assert.equal(isTouchFocusDevice(), true);
    assert.equal(focusTerminalInputFromTouch("tab-touch"), false);
    assert.equal(field.focusCalls, 0, "no focus, so no caret the keyboard never followed");
  } finally {
    delete globalThis.window;
  }

  registerTerminalInputField("tab-touch", null);
  assert.equal(isTouchFocusDevice(), false, "a browser without matchMedia is not a touch device");
});
