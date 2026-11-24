import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";

/**
 * The one sentence that says how full the context window is.
 *
 * It started as the composer ring's native tooltip (`37.6% ctx · 161.8M tok`) and is now
 * the conversation header's tip, the native menu's stats line, and the chip's accessible
 * name. Three places, one wording: a number that reads differently in each of them stops
 * being a measurement.
 *
 * Numbers are not translated (a token count is a token count), and the units stay the
 * short `ctx` / `tok` the ring has always used: the sentence lives in a narrow header.
 */

/** `161800000` → `161.8M`, `128000` → `128k`, `900` → `900`. */
export function formatTokenWindow(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/** The context window's fullness, clamped into 0..100 for an arc. */
export function contextPercent(percent: number | null): number {
  return percent === null ? 0 : Math.max(0, Math.min(100, percent));
}

/**
 * `37.6% ctx · 161.8M tok · $0.123`, built from what is known:
 * - no usage at all (a session that has never run) → `null`, so the chip renders nothing
 *   rather than an empty ring that reads as a spinner;
 * - a percent that is not known yet (right after a compaction) → the window's size over
 *   the denominator (`— / 128k`), which is the one thing that is known;
 * - the session's own total tokens and cost join the sentence when they exist.
 */
export function contextUsageSummary(
  contextUsage: ContextUsage | null | undefined,
  sessionStats?: SessionStatsInfo | null,
): string | null {
  if (!contextUsage) return null;
  const { percent, contextWindow } = contextUsage;
  const parts: string[] = [];
  if (percent !== null) parts.push(`${percent.toFixed(1)}% ctx`);
  else if (contextWindow > 0) parts.push(`— / ${formatTokenWindow(contextWindow)}`);
  else return null;
  const total = sessionStats?.tokens.total ?? 0;
  if (total > 0) parts.push(`${formatTokenWindow(total)} tok`);
  else if (percent !== null && contextWindow > 0) parts[0] += ` / ${formatTokenWindow(contextWindow)}`;
  const cost = sessionStats?.cost ?? 0;
  if (cost > 0) parts.push(`$${cost.toFixed(3)}`);
  return parts.join(" · ");
}
