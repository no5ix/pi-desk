import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MAX_PROMPT_TITLE_CHARS, parsePromptTitle, readPromptTitle } from "./session-prompt-title.ts";

// A finished task's notification is titled with the session's name. The live session only
// carries one once the user renames the session or auto-naming names it, so the announcement
// for a session nobody named used to be silent — with auto-naming switched off, no run
// announced itself at all. The sidebar titles such a row by its first prompt, and the
// notification reads the same title from the same file, so the phone and the sidebar agree.

const HEADER = JSON.stringify({ type: "session", version: 3, id: "s-1", timestamp: "2026-01-27T08:00:00.000Z", cwd: "/tmp/p" });

function userLine(content, id = "m1") {
  return JSON.stringify({ type: "message", id, parentId: null, timestamp: "2026-01-27T08:00:01.000Z", message: { role: "user", content } });
}

test("the first user prompt becomes the title", () => {
  const title = parsePromptTitle([
    HEADER,
    JSON.stringify({ type: "model_change", id: "e1", parentId: null, provider: "p", modelId: "m", timestamp: "2026-01-27T08:00:00.500Z" }),
    userLine("don't modify anything, just say hi to me."),
    JSON.stringify({
      type: "message", id: "m2", parentId: "m1", timestamp: "2026-01-27T08:00:09.000Z",
      message: { role: "assistant", content: [{ type: "text", text: "Hi!" }] },
    }),
    userLine("and now the second prompt", "m3"),
  ]);

  assert.equal(title, "don't modify anything, just say hi to me.");
});

test("a prompt of content blocks is titled by its first text block, on one line", () => {
  assert.equal(
    parsePromptTitle([userLine([{ type: "image", data: "AAAA" }, { type: "text", text: "fix the\n   parser\nplease" }])]),
    "fix the parser please",
  );
});

test("a prompt with no words is passed over, and the title is capped like a generated name", () => {
  assert.equal(parsePromptTitle([userLine([{ type: "image", data: "AAAA" }]), userLine("the one with text")]), "the one with text");

  const long = parsePromptTitle([userLine("x".repeat(300))]);
  assert.equal(long.length, MAX_PROMPT_TITLE_CHARS, "the same cap auto-naming uses, so both titles fit the row");
  assert.ok(long.endsWith("…"));
});

test("malformed lines and an empty file answer null, and a session with no prompt has no title", () => {
  assert.equal(parsePromptTitle([]), null);
  assert.equal(parsePromptTitle(["", "   ", "{ not json", "[", HEADER]), null);
  assert.equal(parsePromptTitle([
    HEADER,
    JSON.stringify({ type: "session_info", id: "e2", parentId: null, name: "Renamed by hand", timestamp: "2026-01-27T08:00:00.500Z" }),
    JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "assistant", content: "an answer with no prompt" } }),
  ]), null, "the caller prefers a session_info name; this reader answers what the file's prompts say");
});

test("readPromptTitle reads the file's head, and never throws", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-prompt-title-"));
  try {
    const withPrompt = join(dir, "with.jsonl");
    await writeFile(withPrompt, [HEADER, userLine("  rebuild   the index  "), userLine("next")].join("\n") + "\n");
    assert.equal(await readPromptTitle(withPrompt), "rebuild the index");

    const noPrompt = join(dir, "quiet.jsonl");
    await writeFile(noPrompt, HEADER + "\n");
    assert.equal(await readPromptTitle(noPrompt), null);

    assert.equal(await readPromptTitle(join(dir, "missing.jsonl")), null, "a session file that is not there is no title, not an error");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
