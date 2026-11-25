import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MAX_PROMPT_TITLE_CHARS, parsePromptTitle, promptTitleFromEntries, readPromptTitle } from "./session-prompt-title.ts";

// A finished task's notification is titled with the session's name. The live session only
// carries one once the user renames the session or auto-naming names it, so the announcement
// for a session nobody named used to be silent — with auto-naming switched off, no run
// announced itself at all. The sidebar titles such a row by its first prompt, and the
// notification reads the same title from the same file, so the phone and the sidebar agree.
//
// The file reader's bound is a read budget, not a window. A prompt that starts with a
// screenshot is one JSON line carrying a few hundred KB of base64, and the 256 KB window this
// reader used to open cut such a line in half: a half line is not JSON, the session had no
// title, and its finished run announced nothing on the phone, on ntfy, or in Notification
// Center — silently, because a run with no title has nothing honest to say.

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

test("a first prompt carrying an inline image still titles its run", async () => {
  // The regression: the screenshot attached to the first prompt is base64 on the same JSON
  // line, hundreds of KB of it, and a fixed head window truncates that line.
  const dir = await mkdtemp(join(tmpdir(), "pi-prompt-title-image-"));
  try {
    const file = join(dir, "screenshot.jsonl");
    const systemLine = JSON.stringify({
      type: "message", id: "sys", parentId: null, timestamp: "2026-01-27T08:00:00.500Z",
      message: { role: "system", content: "s".repeat(100 * 1024) },
    });
    const prompt = userLine([
      { type: "text", text: "fix the agents panel\nsubagent   highlight, please" },
      { type: "image", data: "A".repeat(400 * 1024) },
      { type: "image", data: "B".repeat(400 * 1024) },
    ]);
    assert.ok(prompt.length > 256 * 1024, "the prompt's line is far past the window the reader used to open");
    await writeFile(file, [HEADER, systemLine, prompt, userLine("the second prompt", "m2")].join("\n") + "\n");

    assert.equal(await readPromptTitle(file), "fix the agents panel subagent highlight, please");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a huge line that is no prompt is stepped over, and the prompt behind it is found", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-prompt-title-behind-"));
  try {
    const file = join(dir, "behind.jsonl");
    const toolResult = JSON.stringify({
      type: "message", id: "tr", parentId: null, timestamp: "2026-01-27T08:00:02.000Z",
      message: { role: "toolResult", toolCallId: "c1", content: [{ type: "image", data: "C".repeat(4 * 1024 * 1024) }] },
    });
    await writeFile(file, [HEADER, toolResult, userLine("the prompt after the big tool result")].join("\n") + "\n");

    assert.equal(await readPromptTitle(file), "the prompt after the big tool result");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the budget bounds the read: a prompt buried past it is not chased through the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-prompt-title-budget-"));
  try {
    const file = join(dir, "deep.jsonl");
    const filler = Array.from({ length: 17 * 1024 }, (_, i) => JSON.stringify({
      type: "message", id: `f${i}`, parentId: null, timestamp: "2026-01-27T08:00:02.000Z",
      message: { role: "assistant", content: "x".repeat(1024) },
    }));
    await writeFile(file, [HEADER, ...filler, userLine("buried past the budget")].join("\n") + "\n");

    assert.equal(await readPromptTitle(file), null, "the budget stops the read; it never truncates the line it is reading");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live session's own entries title its run by the same rule", () => {
  const entries = [
    { type: "session", version: 3, id: "s-1" },
    { type: "model_change", id: "e1", provider: "p", modelId: "m" },
    { type: "message", id: "m0", message: { role: "system", content: "a system message is no prompt" } },
    { type: "message", id: "m1", message: { role: "user", content: [{ type: "image", data: "AAAA" }] } },
    {
      type: "message", id: "m2",
      message: {
        role: "user",
        content: [{ type: "text", text: "fix the\n   parser" }, { type: "image", data: "B".repeat(500 * 1024) }],
      },
    },
    { type: "message", id: "m3", message: { role: "user", content: "a later prompt" } },
  ];

  assert.equal(promptTitleFromEntries(entries), "fix the parser", "the first prompt with words, the same cap and the same one-lining");
  assert.equal(promptTitleFromEntries([]), null);
  assert.equal(promptTitleFromEntries([null, "a string", { type: "session" }, { type: "message" }]), null, "entries of no use are stepped over");
  assert.equal(
    promptTitleFromEntries([{ type: "message", id: "m", message: { role: "user", content: "x".repeat(300) } }]).length,
    MAX_PROMPT_TITLE_CHARS,
  );
});
