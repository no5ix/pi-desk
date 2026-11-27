import type { AgentMessage } from "./types";

/** A time pi recorded, or undefined when it is missing, negative or not a finite number. */
export function recordedMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** When a response ended: its request start plus the time pi recorded for it (pi 1.1). */
function responseEnd(message: AgentMessage): number | undefined {
  if (message.role !== "assistant") return undefined;
  const start = recordedMs(message.timestamp);
  if (start === undefined) return undefined;
  const duration = recordedMs(message.durationMs);
  // A reply with no recorded length (a provider that reports none, a session
  // written before pi 1.1) ends where it started. That is the honest floor of
  // the turn, and it keeps the footer's length on the task instead of blank.
  return duration === undefined ? start : start + duration;
}

/** A background subagent's report, delivered as a custom message (lib/subagent-runtime.ts). */
const SUBAGENT_REPORT_TYPES = new Set(["pi-web:subagent-notification", "subagent-notification"]);

function isSubagentReport(message: AgentMessage): boolean {
  if (message.role !== "custom") return false;
  const customType = (message as { customType?: unknown }).customType;
  return typeof customType === "string" && SUBAGENT_REPORT_TYPES.has(customType);
}

/** A reply that answered the turn: a run that follows it was started later, e.g. by an extension's message. */
function answersTurn(message: AgentMessage): boolean {
  return message.role === "assistant" && (message.stopReason === "stop" || message.stopReason === "length");
}

/**
 * When the turn began. The anchor is usually the user's message, and a user entry
 * carries no time of its own, so the turn starts at the first time the transcript
 * records inside it — its own timestamp if the writer set one, else the moment its
 * first reply (or a tool) began. The scan stops at the turn's end, so a later turn's
 * time is never read as this turn's start.
 */
function turnStart(messages: AgentMessage[], anchorIdx: number, endIdx: number): number | undefined {
  for (let idx = anchorIdx; idx < endIdx; idx++) {
    const at = recordedMs(messages[idx].timestamp);
    if (at !== undefined) return at;
  }
  return undefined;
}

/**
 * How long a finished turn took: from its anchor (the user's message, a compaction summary,
 * a subagent completion) until the last response or tool result in `messages[anchorIdx + 1, endIdx)`
 * ended, less the waits between an answer and a run an extension started after it (its message,
 * e.g. pi's `triggerTurn`, is no anchor). Undefined when nothing in the turn carries a time: a
 * turn whose replies report no length is measured to the last thing that happened in it, because
 * the task ran at least that long.
 */
export function getTurnDurationMs(messages: AgentMessage[], anchorIdx: number, endIdx: number): number | undefined {
  const start = turnStart(messages, anchorIdx, endIdx);
  if (start === undefined) return undefined;
  let end: number | undefined;
  let idle = 0;
  let answeredAt: number | undefined;
  let nextRunAt: number | undefined;
  for (let idx = anchorIdx + 1; idx < endIdx; idx++) {
    const message = messages[idx];
    if (message.role === "assistant") {
      if (answeredAt !== undefined && nextRunAt !== undefined) idle += Math.max(0, nextRunAt - answeredAt);
      answeredAt = nextRunAt = undefined;
      const ended = responseEnd(message);
      if (ended !== undefined) end = Math.max(end ?? ended, ended);
      if (ended !== undefined && answersTurn(message)) answeredAt = end;
    } else if (message.role === "toolResult") {
      const ended = recordedMs(message.timestamp);
      if (ended !== undefined) end = Math.max(end ?? ended, ended);
    } else if (isSubagentReport(message)) {
      // A background subagent's report is the task working, not a wait: the time
      // between an answer and the report is the run it delivers, so the report
      // ends the turn no further and takes nothing off it.
      const at = recordedMs(message.timestamp);
      if (at !== undefined) end = Math.max(end ?? at, at);
    } else if (answeredAt !== undefined) {
      const at = recordedMs(message.timestamp);
      if (at !== undefined) nextRunAt = Math.max(nextRunAt ?? at, at);
    }
  }
  if (end === undefined) return undefined;
  return Math.max(0, end - start - idle);
}

/**
 * The same length in the compact shape a label reads at a glance: `45s`, `12m30s`,
 * `1h50m`, `12d3h4m`. Units a shorter turn has are left out, so a long task reads
 * in the width a topbar label has.
 *
 * `withSeconds` keeps the seconds a ticking header needs: without them a running
 * clock changes once a minute and looks frozen. A footer that states a finished
 * length has no use for them, and `1h50m` is what fits beside Copy.
 */
export function formatTurnDurationCompact(ms: number, options: { withSeconds?: boolean } = {}): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${seconds}s`;
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const withSeconds = options.withSeconds === true;
  if (totalHours < 24) {
    if (withSeconds) return `${totalHours}h${minutes}m${seconds}s`;
    return minutes > 0 ? `${totalHours}h${minutes}m` : `${totalHours}h`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (withSeconds) return `${days}d${hours}h${minutes}m${seconds}s`;
  return minutes > 0 ? `${days}d${hours}h${minutes}m` : `${days}d${hours}h`;
}

/** A turn's length as the chat shows it, in whole seconds: 14s, then 3m 5s, then 1h 2m 5s. */
export function formatTurnDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds}s`;
}
