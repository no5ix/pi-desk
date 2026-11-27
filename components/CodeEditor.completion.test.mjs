import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The keys that complete a word, and the keys that do not.
 *
 * The user types with Tab: it accepts the word the list is offering, and with
 * nothing offered it indents. Enter is the newline they are asking for. Monaco's
 * default commits a selected suggestion on Enter, which turned a finished line
 * into a word from the list — `format` became `formatCommitTime` while the
 * typist was pressing return. A browser cannot see this in the esbuild harness
 * (no suggestion widget opens there; BLOCKERS.md), so the option block itself is
 * the thing under test.
 */
const editor = readFileSync("components/CodeEditor.tsx", "utf8");

test("Tab completes; Enter is the newline", () => {
  assert.match(editor, /tabCompletion: "on"/, "Tab accepts a visible suggestion and completes inside a word");
  assert.match(editor, /acceptSuggestionOnEnter: "off"/, "Enter never accepts a suggestion");
  assert.match(editor, /acceptSuggestionOnCommitCharacter: false/, "no trigger character commits a suggestion either");
});

test("the word list is quiet, not shouty", () => {
  // The list is the document's own words plus the language's, and it previews
  // nothing: a preview panel that opens under the caret moves the text the
  // typist is reading.
  assert.match(editor, /quickSuggestions: \{ other: true, comments: false, strings: false \}/,
    "the list answers a typed prefix, not a comment or a string");
  assert.match(editor, /preview: false/, "a suggestion does not open a documentation preview");
});
