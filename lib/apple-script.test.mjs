import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { appleScriptString, appleScriptCancelled } =
  await createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false })
    .import("./apple-script.ts");

// Both native bridges (the Finder panel and the notification) build AppleScript source,
// and the user's text is inside it. The routes are the callers; these two helpers are
// the part that can corrupt the source.

test("an AppleScript string literal escapes the two characters that end it", () => {
  assert.equal(appleScriptString("plain"), `"plain"`);
  assert.equal(appleScriptString('He said "done"'), '"He said \\"done\\""');
  assert.equal(appleScriptString("a\\b"), '"a\\\\b"');
  assert.equal(appleScriptString(""), `""`);
  // The classic escape-out: an unescaped quote would let the value run a statement.
  assert.equal(appleScriptString('x" with title "y'), '"x\\" with title \\"y"');
});

test("a dismissed AppleScript panel is recognised, not an error", () => {
  assert.equal(appleScriptCancelled('48:72: execution error: User canceled. (-128)'), true);
  assert.equal(appleScriptCancelled("user canceled"), true);
  assert.equal(appleScriptCancelled("-128"), true);
  assert.equal(appleScriptCancelled("execution error: Can’t get folder (−1728)"), false, "a real failure stays a failure");
  assert.equal(appleScriptCancelled(""), false);
});
