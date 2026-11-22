import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseLastRunFromJsonl, readLastRunTimes } from "./session-last-run.ts";

// The completion notification's numbers. A page has them only for a run it saw begin,
// so the session file is the authority: every entry carries a timestamp, and the run is
// the last user message through the last entry written after it.

const T0 = Date.parse("2026-01-27T10:04:34.000Z");

function line(role, at, extra = {}) {
  return JSON.stringify({
    type: "message",
    id: `e-${at}-${role}`,
    parentId: null,
    timestamp: new Date(at).toISOString(),
    message: { role, timestamp: at, ...extra },
  });
}

test("a run is the last prompt through the last entry after it", () => {
  const text = [
    line("user", T0),
    line("assistant", T0 + 5_000, { stopReason: "toolUse" }),
    line("toolResult", T0 + 9_000),
    line("assistant", T0 + 20_000, { stopReason: "stop" }),
  ].join("\n");
  assert.deepEqual(parseLastRunFromJsonl(text), { startedAt: T0, endedAt: T0 + 20_000 });
});

test("a later prompt starts the span over, so an old answer is not the task's start", () => {
  const text = [
    line("user", T0),
    line("assistant", T0 + 60_000, { stopReason: "stop" }),
    line("user", T0 + 600_000),
    line("assistant", T0 + 660_000, { stopReason: "stop" }),
  ].join("\n");
  assert.deepEqual(parseLastRunFromJsonl(text), { startedAt: T0 + 600_000, endedAt: T0 + 660_000 });
});

test("a prompt with no reply is a task that has not ended", () => {
  const text = [line("user", T0), line("user", T0 + 1000)].join("\n");
  assert.equal(parseLastRunFromJsonl(text), null, "the last prompt has no answer yet");
});

test("an entry with no time is left out, and a half-written line is not a run", () => {
  const text = [
    line("user", T0),
    JSON.stringify({ type: "model_change", id: "m1", parentId: null, provider: "x", modelId: "y" }),
    '{"type":"message","id":"half-wri',
    line("assistant", T0 + 30_000, { stopReason: "stop" }),
  ].join("\n");
  assert.deepEqual(parseLastRunFromJsonl(text), { startedAt: T0, endedAt: T0 + 30_000 });
});

test("a message timestamp is used when the entry carries no ISO stamp", () => {
  const text = JSON.stringify({ type: "message", id: "a", message: { role: "assistant", timestamp: T0 + 40_000 } });
  const user = JSON.stringify({ type: "message", id: "u", message: { role: "user", timestamp: T0 } });
  assert.deepEqual(parseLastRunFromJsonl(`${user}\n${text}`), { startedAt: T0, endedAt: T0 + 40_000 });
});

test("a header-only file, and empty text, answer nothing to announce", () => {
  assert.equal(parseLastRunFromJsonl(""), null);
  assert.equal(parseLastRunFromJsonl(JSON.stringify({ type: "session", id: "s", timestamp: new Date(T0).toISOString() })), null);
});

test("reading a session file answers the same span", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-last-run-"));
  const file = path.join(dir, "session.jsonl");
  try {
    fs.writeFileSync(file, [
      JSON.stringify({ type: "session", version: 3, id: "s", timestamp: new Date(T0).toISOString(), cwd: "/repo" }),
      line("user", T0),
      line("assistant", T0 + 1_000, { stopReason: "toolUse" }),
      line("toolResult", T0 + 2_000),
      line("assistant", T0 + 75_000, { stopReason: "stop" }),
    ].join("\n") + "\n");
    assert.deepEqual(await readLastRunTimes(file), { startedAt: T0, endedAt: T0 + 75_000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a run wider than the first window is read from a wider one", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-last-run-"));
  const file = path.join(dir, "session.jsonl");
  try {
    // A prompt, then tool output wider than the narrow window, then the answer.
    const padding = line("toolResult", T0 + 5_000, { content: "x".repeat(300 * 1024) });
    fs.writeFileSync(file, [line("user", T0), padding, line("assistant", T0 + 90_000, { stopReason: "stop" })].join("\n") + "\n");
    assert.deepEqual(await readLastRunTimes(file), { startedAt: T0, endedAt: T0 + 90_000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing or unreadable file answers nothing to announce", async () => {
  assert.equal(await readLastRunTimes(path.join(os.tmpdir(), "pi-web-last-run-missing", "session.jsonl")), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-last-run-"));
  assert.equal(await readLastRunTimes(dir), null, "a folder is not a session file");
  fs.rmSync(dir, { recursive: true, force: true });
});
