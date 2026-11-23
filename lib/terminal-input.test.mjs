import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./terminal-input.ts");
}

function key(keyValue, modifiers = {}) {
  return {
    key: keyValue,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

test("maps navigation and editing keys to terminal sequences", async () => {
  const { toTerminalKeyData } = await loadSubject();

  assert.equal(toTerminalKeyData(key("ArrowDown")), "\x1b[B");
  assert.equal(toTerminalKeyData(key("Home")), "\x1b[H");
  assert.equal(toTerminalKeyData(key("Delete")), "\x1b[3~");
  assert.equal(toTerminalKeyData(key("Tab", { shiftKey: true })), "\x1b[Z");
  assert.equal(toTerminalKeyData(key("Enter", { shiftKey: true })), "\n");
});

test("maps legacy control and alt keys used by pi-tui", async () => {
  const { toTerminalKeyData } = await loadSubject();

  assert.equal(toTerminalKeyData(key("c", { ctrlKey: true })), "\x03");
  assert.equal(toTerminalKeyData(key("]", { ctrlKey: true })), "\x1d");
  assert.equal(toTerminalKeyData(key("ArrowLeft", { altKey: true })), "\x1bb");
  assert.equal(toTerminalKeyData(key("x", { altKey: true })), "\x1bx");
  assert.equal(toTerminalKeyData(key("v", { ctrlKey: true })), null);
  assert.equal(toTerminalKeyData(key("x", { metaKey: true })), null);
});

test("leaves printable text to the text input and wraps pasted text", async () => {
  const { asBracketedPaste, toTerminalKeyData } = await loadSubject();

  assert.equal(toTerminalKeyData(key("a")), null);
  assert.equal(toTerminalKeyData(key(" ")), null);
  assert.equal(asBracketedPaste("first\nsecond"), "\x1b[200~first\nsecond\x1b[201~");
});

/** A keydown as the terminal sees it: `key` is what the layout produced, `code`
 *  the physical key. Safari and WKWebView report `keyCode` 0 for a dead-key
 *  chord and for the arrows, so `code` is all that is left to name them. */
function chord(keyValue, code, modifiers = {}) {
  return { key: keyValue, code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...modifiers };
}

test("the macOS Option chords xterm's macOptionIsMeta cannot produce", async () => {
  const { macOptionSequence } = await loadSubject();

  // A dead-key chord (Option+E on a Portuguese layout is `Dead`) and a chord
  // whose key names no character: the letter under the finger, which is what
  // fzf's Option+E, Option+C and Option+/ bind.
  assert.equal(macOptionSequence(chord("Dead", "KeyE")), "\x1be");
  assert.equal(macOptionSequence(chord("Dead", "KeyC")), "\x1bc");
  assert.equal(macOptionSequence(chord("Unidentified", "Slash")), "\x1b/");
  assert.equal(macOptionSequence(chord("Dead", "KeyE", { shiftKey: true })), "\x1be");
  // Terminal.app's word jumps, not the modified CSI `ESC [ 1 ; 3 D` xterm sends.
  assert.equal(macOptionSequence(chord("ArrowLeft", "ArrowLeft")), "\x1bb");
  assert.equal(macOptionSequence(chord("ArrowRight", "ArrowRight")), "\x1bf");
  assert.equal(macOptionSequence(chord("ArrowUp", "ArrowUp")), "\x1bp");
  assert.equal(macOptionSequence(chord("ArrowDown", "ArrowDown")), "\x1bn");
  // The chords xterm's key translation does produce, in one shape for the shell.
  assert.equal(macOptionSequence(chord("Backspace", "Backspace")), "\x1b\x7f");
  assert.equal(macOptionSequence(chord("Enter", "Enter")), "\x1b\r");
  assert.equal(macOptionSequence(chord("Tab", "Tab")), "\x1b\t");
  assert.equal(macOptionSequence(chord("Escape", "Escape")), "\x1b\x1b");
  // One character: xterm's Meta path already sends ESC + the lowercase key, and
  // it must stay the only path, so a printable chord is not sent twice.
  assert.equal(macOptionSequence(chord("®", "KeyR")), null);
  assert.equal(macOptionSequence(chord("´", "KeyE")), null);
  // Not an Option chord, a chord with Control in it, or a key with no character
  // under it: xterm keeps those.
  assert.equal(macOptionSequence(chord("Dead", "KeyE", { ctrlKey: true })), null);
  assert.equal(macOptionSequence(chord("Dead", "KeyE", { metaKey: true })), null);
  assert.equal(macOptionSequence(chord("ArrowLeft", "ArrowLeft", { shiftKey: true })), "\x1bb");
  assert.equal(macOptionSequence({ ...chord("Dead", "KeyE"), altKey: false }), null);
  assert.equal(macOptionSequence(chord("F1", "F1")), null);
  assert.equal(macOptionSequence(chord("Dead", "")), null);
});
