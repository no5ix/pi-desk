import assert from "node:assert/strict";
import test from "node:test";

const { contextPercent, contextUsageSummary, formatTokenWindow } =
  await (await import("jiti")).createJiti(import.meta.url, { tsconfigPaths: true }).import("./context-usage-summary.ts");

const stats = (total, cost = 0) => ({
  tokens: { input: 0, output: 0, total, cacheRead: 0, cacheWrite: 0 },
  cost,
});

test("the sentence the tip shows", () => {
  // The screenshot that started this: `37.6% ctx · 161.8M tok`.
  assert.equal(contextUsageSummary({ percent: 37.6, contextWindow: 1_000_000, tokens: 400_000 }, stats(161_800_000)),
    "37.6% ctx · 161.8M tok");
  assert.equal(contextUsageSummary({ percent: 92.04, contextWindow: 200_000, tokens: 184_000 }, stats(1_200_000, 0.123)),
    "92.0% ctx · 1.2M tok · $0.123");
});

test("what is missing leaves a hole, not a zero", () => {
  // Nothing has run: no chip at all, rather than an empty ring that reads as a spinner.
  assert.equal(contextUsageSummary(null, null), null);
  assert.equal(contextUsageSummary(null, stats(1_000)), null,
    "a session with tokens and no context window has no fullness to report");
  // Right after a compaction the percent is unknown; the window's size is not.
  assert.equal(contextUsageSummary({ percent: null, contextWindow: 128_000, tokens: null }, null), "— / 128k");
  // A known percent and no session totals: the denominator rides along, so the number
  // is a fraction of something and not a bare percentage.
  assert.equal(contextUsageSummary({ percent: 52, contextWindow: 128_000, tokens: 66_560 }, null), "52.0% ctx / 128k");
  assert.equal(contextUsageSummary({ percent: 52, contextWindow: 0, tokens: null }, null), "52.0% ctx");
  // A window with no percent and no size: nothing to say.
  assert.equal(contextUsageSummary({ percent: null, contextWindow: 0, tokens: null }, null), null);
});

test("token counts are written the way the ring always wrote them", () => {
  assert.equal(formatTokenWindow(900), "900");
  assert.equal(formatTokenWindow(1_000), "1k");
  assert.equal(formatTokenWindow(128_000), "128k");
  assert.equal(formatTokenWindow(1_618_000), "1.6M");
  assert.equal(formatTokenWindow(161_800_000), "161.8M");
});

test("the arc's percent is clamped, and an unknown one is 0", () => {
  assert.equal(contextPercent(null), 0);
  assert.equal(contextPercent(37.6), 37.6);
  assert.equal(contextPercent(140), 100);
  assert.equal(contextPercent(-5), 0);
});
