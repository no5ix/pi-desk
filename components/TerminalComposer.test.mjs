import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The phone terminal's command line (`components/TerminalComposer.tsx`) is the keyboard's way
// in that does not depend on Safari's focus rules. The terminal's own field is xterm's one-cell
// helper textarea: read-only until the shell connects, moved by xterm to the cursor, and focused
// by the panel — so a tap on it is often a focus that does not move, and iOS opens nothing. The
// report said it exactly: tapping the terminal a dozen times did nothing, while the first tap on
// a restarted terminal (a fresh, never-focused field) opened the keyboard. A visible, always
// editable `<input>` needs no trickery: the tap focuses it for the first time.

const source = await readFile(new URL("./TerminalComposer.tsx", import.meta.url), "utf8");

test("the row appears only where typing means an on-screen keyboard", () => {
  assert.match(source, /const getCoarsePointer = \(\) => window\.matchMedia\("\(pointer: coarse\)"\)\.matches;/);
  assert.match(source, /useSyncExternalStore\(subscribeCoarsePointer, getCoarsePointer, \(\) => false\)/,
    "the same coarse-pointer test the extra-keys strip uses, and nothing on the server");
});

test("the field is a real input, tuned for a phone keyboard", () => {
  assert.match(source, /<input[\s\S]*?ref=\{inputRef\}[\s\S]*?type="text"/, "a real editable input, not xterm's helper field");
  assert.match(source, /enterKeyHint="send"/, "the phone's own return key sends, like the button");
  assert.match(source, /autoCapitalize="off"[\s\S]*?autoCorrect="off"[\s\S]*?spellCheck=\{false\}/,
    "a path is not a sentence: no autocapitalisation, no autocorrect, no squiggles");
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /value=\{text\}[\s\S]*?onChange=\{\(event\) => setText\(event\.target\.value\)\}/, "controlled, so a refused send keeps the text");
  assert.doesNotMatch(source, /readOnly=\{/, "never read-only: a phone opens no keyboard for a read-only field");
});

test("the field is labelled by a real, stable label", () => {
  assert.match(source, /const fieldId = useId\(\);/, "stable across renders, unique per row");
  assert.match(source, /<label className="terminal-composer-label" htmlFor=\{fieldId\}>/);
  assert.match(source, /<input[\s\S]*?id=\{fieldId\}/);
  assert.doesNotMatch(source, /Math\.random\(\)/, "no id invented per render: a label that changes every render labels nothing");
});

test("Send keeps the focus, and a send the panel refuses leaves the command in the box", () => {
  assert.match(source, /<button[\s\S]*?type="submit"[\s\S]*?disabled=\{!text\}/);
  assert.match(source, /const keepFocus = \(event: PointerEvent<HTMLButtonElement>\) => \{\n\s*event\.preventDefault\(\);\n\s*\};/);
  assert.match(source, /onPointerDown=\{keepFocus\}\n\s*onMouseDown=\{keepFocus\}\n\s*onContextMenu=\{keepFocus\}/,
    "a button that took the focus would close the keyboard between commands");
  assert.match(source, /if \(onSend\(value\)\) setText\(""\);\n\s*inputRef\.current\?\.focus\(\);/,
    "the panel answers whether the shell took it; the row keeps a command typed while the shell was connecting, and the keyboard stays");
  assert.match(source, /event\.preventDefault\(\);\n\s*send\(\);/, "the form's submit is the Enter key path");
});

test("every locale names the row", async () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    for (const key of ["terminal.commandLabel", "terminal.commandPlaceholder", "terminal.commandSend"]) {
      assert.ok(messages.includes(`"${key}"`), `${locale} is missing ${key}`);
    }
  }
});
