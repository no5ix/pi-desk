import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { buildSessionFileDiff, countPatchLines } = await jiti.import("./session-file-diff.ts");

const CWD = "/repo";
const FILE = "/repo/src/a.ts";

function toolCall(toolCallId, toolName, input) {
  return { role: "assistant", content: [{ type: "toolCall", toolCallId, toolName, input }] };
}

function toolResult(toolCallId, details, isError) {
  return { role: "toolResult", toolCallId, toolName: "edit", content: [], ...(isError ? { isError: true } : {}), ...(details ? { details } : {}) };
}

function messages(...entries) {
  return entries;
}

test("an edit whose result carries a patch shows that patch", () => {
  const patch = `--- src/a.ts
+++ src/a.ts
@@ -10,3 +10,4 @@
 context line
-const a = 1;
+const a = 2;
+const b = 3;
`;
  const diff = buildSessionFileDiff(messages(
    toolCall("t1", "edit", { path: "src/a.ts", edits: [{ oldText: "const a = 1;", newText: "const a = 2;\nconst b = 3;" }] }),
    toolResult("t1", { diff: "-10 const a = 1;\n+10 const a = 2;\n+11 const b = 3;", patch, firstChangedLine: 10 }),
  ), FILE, CWD);

  assert.equal(diff.status, "modified");
  assert.equal(diff.changes, 1);
  // One file header pair, then the call's hunks.
  assert.equal(diff.patch.match(/^--- /gm).length, 1);
  assert.equal(diff.patch.match(/^\+\+\+ /gm).length, 1);
  assert.match(diff.patch, /^--- src\/a\.ts$/m);
  assert.match(diff.patch, /^@@ -10,3 \+10,4 @@$/m);
  assert.ok(diff.patch.includes("-const a = 1;"));
  assert.ok(diff.patch.includes("+const b = 3;"));
  assert.deepEqual({ additions: diff.additions, deletions: diff.deletions }, { additions: 2, deletions: 1 });
  assert.deepEqual(countPatchLines(diff.patch), { additions: 2, deletions: 1 });
});

test("a chain of edits stacks its hunks under one header", () => {
  const first = `--- src/a.ts
+++ src/a.ts
@@ -1,2 +1,2 @@
-one
+uno
`;
  const second = `--- src/a.ts
+++ src/a.ts
@@ -40,2 +40,3 @@
-four
+quattro
+five
`;
  const diff = buildSessionFileDiff(messages(
    toolCall("t1", "edit", { path: "src/a.ts", edits: [{ oldText: "one", newText: "uno" }] }),
    toolResult("t1", { patch: first }),
    toolCall("t2", "edit", { path: "src/a.ts", edits: [{ oldText: "four", newText: "quattro\nfive" }] }),
    toolResult("t2", { patch: second }),
  ), FILE, CWD);

  assert.equal(diff.changes, 2);
  assert.equal(diff.patch.match(/^--- /gm).length, 1, "one file section, not one per call");
  assert.equal(diff.patch.match(/^@@ /gm).length, 2);
  assert.deepEqual({ additions: diff.additions, deletions: diff.deletions }, { additions: 3, deletions: 2 });
});

test("a write reads as the file's whole content, added", () => {
  const diff = buildSessionFileDiff(messages(
    toolCall("w1", "write", { path: "src/a.ts", content: "first\nsecond\n" }),
    toolResult("w1", null),
  ), FILE, CWD);

  assert.equal(diff.status, "added");
  assert.match(diff.patch, /^--- \/dev\/null$/m);
  assert.ok(diff.patch.includes("+first"));
  assert.ok(diff.patch.includes("+second"));
  assert.ok(!diff.patch.includes("+\n+"), "the trailing newline is not an empty line");
  assert.deepEqual({ additions: diff.additions, deletions: diff.deletions }, { additions: 2, deletions: 0 });
});

test("an edit whose result carries only pi's numbered diff still shows hunks", () => {
  const diff = buildSessionFileDiff(messages(
    toolCall("t1", "edit", { path: "src/a.ts", edits: [{ oldText: "old", newText: "new" }] }),
    toolResult("t1", { diff: " 9 keep\n-10 old\n+10 new\n 11 tail", firstChangedLine: 10 }),
  ), FILE, CWD);

  assert.ok(diff.patch.includes(" keep"));
  assert.ok(diff.patch.includes("-old"));
  assert.ok(diff.patch.includes("+new"));
  assert.ok(diff.patch.includes(" tail"));
  assert.deepEqual({ additions: diff.additions, deletions: diff.deletions }, { additions: 1, deletions: 1 });
});

test("an edit with no result details falls back to its old and new text", () => {
  const diff = buildSessionFileDiff(messages(
    toolCall("t1", "edit", {
      path: "src/a.ts",
      edits: [{
        oldText: "keep one\nkeep two\nkeep three\nkeep four\nold line\nkeep six\nkeep seven\nkeep eight",
        newText: "keep one\nkeep two\nkeep three\nkeep four\nnew line\nkeep six\nkeep seven\nkeep eight",
      }],
    }),
    toolResult("t1", {}),
  ), FILE, CWD);

  assert.ok(diff.patch.includes("-old line"));
  assert.ok(diff.patch.includes("+new line"));
  // The quoted context is trimmed to what changed, with a little around it.
  assert.ok(diff.patch.includes(" keep four"), "context lines survive");
  assert.ok(!diff.patch.includes("keep one"), "the unchanged quote head is not shown");
});

test("an apply_patch shows its own hunks and marks an added file", () => {
  const input = `*** Begin Patch
*** Add File: src/a.ts
+created
+line two
*** End Patch`;
  const diff = buildSessionFileDiff(messages(
    toolCall("p1", "apply_patch", { input }),
    toolResult("p1", {}),
  ), FILE, CWD);

  assert.equal(diff.status, "added");
  assert.ok(diff.patch.includes("+created"));
  assert.ok(diff.patch.includes("+line two"));
});

test("an apply_patch that deletes the file reports it as deleted", () => {
  const input = `*** Begin Patch
*** Delete File: src/a.ts
*** End Patch`;
  const diff = buildSessionFileDiff(messages(
    toolCall("p1", "apply_patch", { input }),
    toolResult("p1", {}),
  ), FILE, CWD);

  assert.equal(diff.status, "deleted");
  assert.match(diff.patch, /^\+\+\+ \/dev\/null$/m);
  assert.ok(diff.patch.includes("deleted"));
});

test("a call with no result, an errored result, or another file yields nothing", () => {
  const call = toolCall("t1", "edit", { path: "src/a.ts", edits: [{ oldText: "a", newText: "b" }] });
  assert.equal(buildSessionFileDiff(messages(call), FILE, CWD), null);
  assert.equal(buildSessionFileDiff(messages(call, toolResult("t1", { patch: "--- x\n+++ x\n@@ -1 +1 @@\n-a\n+b" }, true)), FILE, CWD), null);
  assert.equal(buildSessionFileDiff(messages(
    toolCall("t1", "edit", { path: "src/other.ts", edits: [{ oldText: "a", newText: "b" }] }),
    toolResult("t1", { patch: "--- src/other.ts\n+++ src/other.ts\n@@ -1 +1 @@\n-a\n+b" }),
  ), FILE, CWD), null);
});

test("a path the call names relative to the session folder resolves to the same file", () => {
  const diff = buildSessionFileDiff(messages(
    toolCall("t1", "write", { path: "src/a.ts", content: "one\n" }),
    toolResult("t1", null),
  ), FILE, CWD);
  assert.ok(diff);
  // The header is the path relative to the session's folder, not the absolute one.
  assert.match(diff.patch, /^\+\+\+ src\/a\.ts$/m);
});

test("an enormous write is capped, with a notice", () => {
  const content = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n");
  const diff = buildSessionFileDiff(messages(
    toolCall("w1", "write", { path: "src/a.ts", content }),
    toolResult("w1", null),
  ), FILE, CWD);
  const body = diff.patch.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  assert.equal(body.length, 2000);
  assert.match(diff.patch, /diff truncated/);
});
