import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getToolExecutionProgress } = await jiti.import("./tool-execution-progress.ts");

test("uses the latest non-empty text line from a partial tool result", () => {
  assert.equal(getToolExecutionProgress({
    content: [
      { type: "text", text: "Phase 1 complete\n" },
      { type: "image", data: "ignored" },
      { type: "text", text: "\nProcessing item 4 of 10\n" },
    ],
  }), "Processing item 4 of 10");
});

test("ignores partial tool results without displayable text", () => {
  assert.equal(getToolExecutionProgress(null), null);
  assert.equal(getToolExecutionProgress({ content: [{ type: "image" }] }), null);
  assert.equal(getToolExecutionProgress({ content: [{ type: "text", text: "  \n" }] }), null);
});

test("reads a command's coloured output by what it shows", () => {
  // eslint/tsc colour their summary, and the status line is plain text.
  assert.equal(
    getToolExecutionProgress({
      content: [{ type: "text", text: "\x1b[0m\x1b[31m✖\x1b[39m\x1b[0m 2 problems (0 errors, 2 warnings)\x1b[0m\n" }],
    }),
    "✖ 2 problems (0 errors, 2 warnings)",
  );

  // A run that only paints colours reports the last line with text, not the boxes.
  assert.equal(
    getToolExecutionProgress({
      content: [{ type: "text", text: "1 problem found\n\x1b[0m\x1b[33m\x1b[1m\x1b[22m\x1b[39m\x1b[0m" }],
    }),
    "1 problem found",
  );

  // Output that is nothing but escapes says nothing.
  assert.equal(getToolExecutionProgress({ content: [{ type: "text", text: "\x1b[0m\x1b[33m\x1b[0m" }] }), null);
});

test("reports the latest frame of a line a tool redraws with \\r", () => {
  assert.equal(
    getToolExecutionProgress({ content: [{ type: "text", text: "building…\r10%\r50%\r100%" }] }),
    "100%",
  );
});

test("bounds long progress lines while preserving the latest text", () => {
  const progress = getToolExecutionProgress({
    content: [{ type: "text", text: `prefix-${"x".repeat(600)}-latest` }],
  });

  assert.equal(progress.length, 500);
  assert.match(progress, /^\.\.\./);
  assert.match(progress, /-latest$/);
});
