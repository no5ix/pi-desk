import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { getTurnDurationMs, formatTurnDuration, formatTurnDurationCompact } = await jiti.import("./turn-duration.ts");

const user = (timestamp) => ({ role: "user", content: "hi", timestamp });
const reply = (timestamp, durationMs, stopReason = "toolUse") => ({ role: "assistant", content: [], model: "m", provider: "p", timestamp, durationMs, stopReason });
const result = (timestamp) => ({ role: "toolResult", toolCallId: "c", content: [], timestamp });

test("a turn runs from the user's message until its last response ended", () => {
  const messages = [user(1_000), reply(1_200, 3_000), result(4_500), reply(4_600, 2_400, "stop")];
  assert.equal(getTurnDurationMs(messages, 0, messages.length), 6_000);
});

test("only the messages before the next anchor belong to the turn", () => {
  const messages = [user(1_000), reply(1_100, 900, "stop"), user(10_000), reply(10_100, 5_000, "stop")];
  assert.equal(getTurnDurationMs(messages, 0, 2), 1_000);
  assert.equal(getTurnDurationMs(messages, 2, 4), 5_100);
});

test("a tool result after the last response, as in an aborted turn, ends the turn", () => {
  const messages = [user(1_000), reply(1_100, 900), result(8_000)];
  assert.equal(getTurnDurationMs(messages, 0, messages.length), 7_000);
});

test("the turn starts at the first time the transcript records inside it", () => {
  // The anchor is the user's message, and a user entry carries no time in a session
  // file, so the turn starts at the first time recorded in it: its reply's request
  // start. Measured from the anchor's own time when the writer set one.
  assert.equal(getTurnDurationMs([user(undefined), reply(1_100, 900, "stop")], 0, 2), 900);
  assert.equal(getTurnDurationMs([user(undefined), reply(10_000, 2_000), result(12_000), reply(42_000, 8_000, "stop")], 0, 4), 40_000,
    "from the first recorded time (10s) to the last end (50s)");
  assert.equal(getTurnDurationMs([user(1_000), reply(1_100, 900, "stop")], 0, 2), 1_000, "the anchor's own time wins when it has one");
  assert.equal(getTurnDurationMs([{ role: "user", content: "go" }, { role: "assistant", content: [], model: "m", provider: "p" }], 0, 2), undefined,
    "a turn with no time anywhere stays blank");
  // A provider that reports no `durationMs` (and every session written before pi 1.1):
  // the turn's end is the last thing that happened in it, so the footer shows the
  // task's length instead of nothing. A reply's own timestamp is when it started —
  // the honest floor, never a guess at its end.
  assert.equal(getTurnDurationMs([user(1_000), reply(1_100, 900), result(2_100), reply(2_200, undefined, "stop")], 0, 4), 1_200);
  assert.equal(getTurnDurationMs([user(1_000), reply(1_100, undefined, "stop")], 0, 2), 100);
  // The scan for a start stops at the turn's end, so a later turn's time is never
  // read as this turn's start: an empty range has none.
  assert.equal(getTurnDurationMs([user(undefined), reply(1_100, 900, "stop")], 0, 1), undefined);
});

test("a background subagent's report is the task working, not an idle wait", () => {
  // pi-web delivers a finished subagent's report as a custom message with no anchor
  // (lib/subagent-runtime.ts). The main session's answer, the hour it waits, and the
  // report are all part of the task, so the footer's length keeps them.
  const report = (timestamp) => ({ role: "custom", customType: "pi-web:subagent-notification", content: "done", display: true, timestamp });
  const messages = [user(1_000), reply(1_100, 900, "stop"), report(3_600_000), reply(3_600_050, 2_000, "stop")];
  assert.equal(getTurnDurationMs(messages, 0, messages.length), 3_601_050);
  // A report that arrives while the turn is still running extends it.
  const trailing = [user(1_000), reply(1_100, 900), report(9_000)];
  assert.equal(getTurnDurationMs(trailing, 0, trailing.length), 8_000);
  // The legacy spelling behaves the same.
  const legacy = [user(1_000), reply(1_100, 900, "stop"), { ...report(3_600_000), customType: "subagent-notification" }, reply(3_600_050, 2_000, "stop")];
  assert.equal(getTurnDurationMs(legacy, 0, legacy.length), 3_601_050);
});

test("a run an extension's message started later is timed from that message, not the answer", () => {
  // pi's file-trigger example: pi.sendMessage({ customType, content, display: true }, { triggerTurn: true }), no anchor.
  const trigger = (timestamp) => ({ role: "custom", customType: "file-trigger", content: "x", display: true, timestamp });
  const messages = [user(1_000), reply(1_100, 900, "stop"), trigger(3_600_000), reply(3_600_050, 2_000, "stop")];
  // 1 s for the first run, 2.05 s for the second; the hour between them is not the turn's.
  assert.equal(getTurnDurationMs(messages, 0, messages.length), 3_050);
  // A message the answer's own run left after it (sent without a new run) moves nothing.
  const late = [user(1_000), reply(1_100, 900, "stop"), trigger(1_500)];
  assert.equal(getTurnDurationMs(late, 0, late.length), 1_000);
});

test("durations read in whole seconds, then minutes and hours", () => {
  assert.equal(formatTurnDuration(0), "0s");
  assert.equal(formatTurnDuration(14_900), "14s");
  assert.equal(formatTurnDuration(185_000), "3m 5s");
  assert.equal(formatTurnDuration(3_725_000), "1h 2m 5s");
  assert.equal(formatTurnDuration(-50), "0s");
});

test("the compact shape a header and a footer read at a glance", () => {
  // A prompt at 10:20 that ends at 12:10 is `1h50m`.
  assert.equal(formatTurnDurationCompact(6_600_000), "1h50m");
  assert.equal(formatTurnDurationCompact(0), "0s");
  assert.equal(formatTurnDurationCompact(45_000), "45s");
  assert.equal(formatTurnDurationCompact(185_000), "3m5s");
  assert.equal(formatTurnDurationCompact(3_600_000), "1h");
  assert.equal(formatTurnDurationCompact(3_725_000), "1h2m");
  assert.equal(formatTurnDurationCompact(7_260_000), "2h1m");
  assert.equal(formatTurnDurationCompact(-50), "0s");
});
