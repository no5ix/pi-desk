/**
 * The text of the completion notification (Settings › General › Safari notification).
 *
 * "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This
 *  notification pops up at 10:22:47."
 *
 * Kept separate from the React tree so the numbers are a pure function: the chat's own
 * duration label (formatTurnDuration in lib/turn-duration.ts) reads "1h 2m 5s" with
 * spaces and drops the units it does not need, while this sentence always carries all
 * three, as the user asked. The clock is built from formatToParts so no locale ever
 * renders it with dots or a 24-o'clock hour.
 */

const DURATION_PATTERN = /\{duration\}|\{started\}|\{ended\}|\{now\}/g;

/** A run's length as `0h18m13s` — hours, minutes and seconds are always present, unpadded (`0h0m9s`). */
export function formatDurationHms(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h${minutes}m${seconds}s`;
}

/** Wall clock as `hh:mm:ss`, 24-hour and zero padded, in the browser's zone. */
export function formatClockTime(atMs: number, locale?: string): string {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(atMs));
  const value = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === kind)?.value ?? "00";
  return `${value("hour")}:${value("minute")}:${value("second")}`;
}

export interface CompletionTimes {
  /** When the run started (the prompt that opened it). */
  startedAt: number;
  /** When the run settled. */
  endedAt: number;
  /** When the notification is raised; the run's end while the page is open. */
  poppedAt?: number;
}

/** Fills `{duration} {started} {ended} {now}` in the localized sentence. */
export function formatCompletionSummary(template: string, times: CompletionTimes, locale?: string): string {
  const poppedAt = times.poppedAt ?? times.endedAt;
  const duration = formatDurationHms(Math.max(0, times.endedAt - times.startedAt));
  const started = formatClockTime(times.startedAt, locale);
  const ended = formatClockTime(times.endedAt, locale);
  const now = formatClockTime(poppedAt, locale);
  return template.replace(DURATION_PATTERN, (token) =>
    token === "{duration}" ? duration
      : token === "{started}" ? started
        : token === "{ended}" ? ended
          : now);
}
