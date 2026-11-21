import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { formatDurationHms, formatClockTime, formatCompletionSummary } =
  await createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false })
    .import("./completion-notification.ts");

// The user's format, quoted in the settings row and sent to the notification:
// "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This
// notification pops up at 10:22:47."

test("duration keeps all three units, unpadded, as the user writes them", () => {
  assert.equal(formatDurationHms(18 * 60_000 + 13_000), "0h18m13s");
  assert.equal(formatDurationHms(9_000), "0h0m9s");
  assert.equal(formatDurationHms(0), "0h0m0s");
  assert.equal(formatDurationHms(31 * 60_000 + 10_000), "0h31m10s");
  assert.equal(formatDurationHms(3_725_000), "1h2m5s");
  assert.equal(formatDurationHms(-5_000), "0h0m0s");
  assert.equal(formatDurationHms(1_499), "0h0m1s", "sub-second truncates, never rounds up");
});

test("clock is 24-hour, zero padded, in the local zone", () => {
  const at = (iso) => formatClockTime(Date.parse(iso));
  assert.equal(at("2026-01-01T10:04:34"), "10:04:34");
  assert.equal(at("2026-01-01T00:00:05"), "00:00:05", "midnight is 00, never 24");
  assert.equal(at("2026-01-01T23:59:09"), "23:59:09");
  assert.match(formatClockTime(Date.now(), "zh-CN"), /^\d{2}:\d{2}:\d{2}$/, "a zh locale keeps hh:mm:ss, no dots");
});

test("the sentence fills every placeholder exactly once", () => {
  const template = "The task lasted {duration}, started at {started}, and ended at {ended}. This notification pops up at {now}.";
  const startedAt = Date.parse("2026-01-01T10:04:34");
  const endedAt = Date.parse("2026-01-01T10:22:47");
  assert.equal(
    formatCompletionSummary(template, { startedAt, endedAt, poppedAt: endedAt }),
    "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at 10:22:47.",
  );
});

test("poppedAt defaults to the run's end and never shifts the measured duration", () => {
  const startedAt = Date.parse("2026-01-01T23:15:27");
  const endedAt = Date.parse("2026-01-01T23:46:37");
  const body = formatCompletionSummary("{duration}|{started}|{ended}|{now}", { startedAt, endedAt });
  assert.equal(body, "0h31m10s|23:15:27|23:46:37|23:46:37");
});

test("unknown placeholders survive, so a locale typo is visible rather than silent", () => {
  assert.equal(formatCompletionSummary("kept {typo} {duration}", { startedAt: 0, endedAt: 1_000 }), "kept {typo} 0h0m1s");
});
