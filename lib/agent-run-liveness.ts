/**
 * Run liveness: what a running agent is doing, and whether it is still moving.
 *
 * A session can report itself busy forever. The SDK keeps `isStreaming` true, and the
 * wrapper's prompt promise outstanding, while the provider request that was supposed to
 * answer never does — a TCP socket the provider stopped feeding, a stdio MCP server that
 * hangs mid `before_agent_start`, an extension that awaits a promise nobody resolves. SSE
 * heartbeats keep flowing (they are this app's own timer, not the model's), so the browser
 * sees a live connection, reconciles against `get_state`, is told "busy", and prints
 * `Waiting for model…` for hours. Nothing in the stack distinguishes that from a slow
 * request, because the only signals available are the SDK's flags.
 *
 * The signals that *do* separate them are the run's own events: a model that answers
 * streams `message_update`, a tool publishes `tool_execution_update`, a retry announces
 * `auto_retry_start`. This module turns those into a phase and a "no progress for…"
 * duration, and decides what to do about it. Rules it is built to keep:
 *
 *  - Heartbeats are never progress. They are counted nowhere here.
 *  - A watchdog never touches a phase whose duration is the user's, or a tool's own
 *    business: an unanswered extension dialog, a running command (bounded by its own
 *    timeout, lib/command-timeout.ts), a compaction, a retry backoff, a subagent report.
 *  - A phase that is demonstrably moving is never touched, however long it lasts: the
 *    clock is the last progress event, not the start of the run.
 *  - Noticing is safe, so it is on by default. Killing is not, so the abort is opt-in
 *    (`PI_WEB_RUN_STALL_ABORT_MS`); 0 — the default — only tells the user.
 */

/** How often the running watchdog looks at the clock while a run is active. */
export const RUN_LIVENESS_TICK_MS = 15_000;

/** 5 minutes of a model request with no event at all is worth saying out loud. */
export const DEFAULT_RUN_STALL_NOTICE_MS = 5 * 60_000;

/** Aborting a run the user is watching is never the default. */
export const DEFAULT_RUN_STALL_ABORT_MS = 0;

/** Node's `setTimeout`/`setInterval` ceiling; beyond it a timer fires immediately. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * SDK events that prove a run moved. Lifecycle events (`agent_start`, `agent_end`,
 * `agent_settled`, `prompt_done`) are not here: they say a boundary happened, not that
 * work advanced, and `agent_end` in particular is followed by the post-run pipeline.
 * `heartbeat` is a transport keep-alive and is not an SDK event at all.
 */
export const AGENT_PROGRESS_EVENT_TYPES: ReadonlySet<string> = new Set([
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "bash_execution_start",
  "bash_execution_update",
  "bash_execution_end",
  "turn_start",
  "turn_end",
  "compaction_start",
  "compaction_end",
  "branch_summary_start",
  "branch_summary_end",
  "auto_retry_start",
  "auto_retry_end",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "queue_update",
]);

/** True when an SDK event is evidence of progress. */
export function isAgentProgressEvent(event: { type?: unknown }): boolean {
  return typeof event.type === "string" && AGENT_PROGRESS_EVENT_TYPES.has(event.type);
}

/**
 * What a run is busy with, in the order the app reads it. The order matters: a tool call
 * runs *inside* a streaming model turn, so `tool` must win over `waiting_model`, and an
 * unanswered extension dialog parks the run on a promise only a person can settle.
 */
export type AgentRunPhase =
  | "idle"
  | "awaiting_input"
  | "bash"
  | "tool"
  | "compaction"
  | "retry_backoff"
  | "mcp_wait"
  | "waiting_model"
  | "prompt_admission";

export interface AgentRunFlags {
  running: boolean;
  streaming: boolean;
  promptRunning: boolean;
  bashRunning: boolean;
  compacting: boolean;
  retrying: boolean;
  runningTools: number;
  awaitingInput: boolean;
  /** A prompt is waiting for its MCP servers to connect (lib/mcp-host.ts). */
  waitingForMcp: boolean;
}

/** The phase a set of wrapper flags describes. */
export function agentRunPhase(flags: AgentRunFlags): AgentRunPhase {
  if (!flags.running) return "idle";
  if (flags.awaitingInput) return "awaiting_input";
  if (flags.bashRunning) return "bash";
  if (flags.runningTools > 0) return "tool";
  if (flags.compacting) return "compaction";
  if (flags.retrying) return "retry_backoff";
  if (flags.waitingForMcp) return "mcp_wait";
  if (flags.streaming) return "waiting_model";
  return "prompt_admission";
}

/**
 * The phases a stall may be declared in: the run is waiting on a request the app cannot
 * see inside, and nothing the user is doing can explain the silence.
 *
 * `prompt_admission` is included because that is where a prompt sits while an extension's
 * `before_agent_start` or the SDK's preflight is still deciding — a hung extension shows
 * there. Every other phase is deliberately absent: a command has its own bounded timeout,
 * a compaction and a retry announce themselves, and an extension dialog is the user's.
 */
export const STALL_ELIGIBLE_PHASES: ReadonlySet<AgentRunPhase> = new Set<AgentRunPhase>([
  "waiting_model",
  "mcp_wait",
  "prompt_admission",
]);

export function isStallEligiblePhase(phase: AgentRunPhase): boolean {
  return STALL_ELIGIBLE_PHASES.has(phase);
}

export interface AgentStallThresholds {
  /** Silence that earns a visible notice. `0`: never. */
  noticeMs: number;
  /** Silence that ends the run. `0`: never (the default). */
  abortMs: number;
}

export type AgentStallVerdict =
  | { kind: "none"; phase: AgentRunPhase; noProgressMs: number }
  | { kind: "notice"; phase: AgentRunPhase; noProgressMs: number }
  | { kind: "abort"; phase: AgentRunPhase; noProgressMs: number };

/**
 * One tick of the watchdog.
 *
 * `notifiedMs` is the silence of the notice already sent for this run (0 for none) and
 * `aborted` says the abort already went out, so repeated ticks of the same stall escalate
 * exactly once and never twice. A run that is not running, in a phase that is not
 * eligible, or that produced an event inside the window is `none`.
 */
export function decideAgentRunStall(
  flags: AgentRunFlags,
  options: {
    now: number;
    lastProgressAt: number | null;
    thresholds: AgentStallThresholds;
    notifiedMs?: number;
    aborted?: boolean;
  },
): AgentStallVerdict {
  const phase = agentRunPhase(flags);
  if (!flags.running || !isStallEligiblePhase(phase)) {
    return { kind: "none", phase, noProgressMs: 0 };
  }
  const noProgressMs = options.lastProgressAt === null
    ? 0
    : Math.max(0, options.now - options.lastProgressAt);
  const { noticeMs, abortMs } = options.thresholds;
  if (abortMs > 0 && noProgressMs >= abortMs && options.aborted !== true) {
    return { kind: "abort", phase, noProgressMs };
  }
  if (noticeMs > 0 && noProgressMs >= noticeMs && (options.notifiedMs ?? 0) < noticeMs) {
    return { kind: "notice", phase, noProgressMs };
  }
  return { kind: "none", phase, noProgressMs };
}

/**
 * Parses a liveness environment variable: unset/blank is `fallback`, `0` turns the rule
 * off, and anything over Node's timer ceiling falls back with a warning (a timer that
 * fires instantly is worse than the default).
 */
export function resolveLivenessTimeoutMs(
  settingName: string,
  rawValue: string | undefined,
  fallback: number,
): number {
  if (rawValue === undefined || rawValue.trim() === "") return fallback;
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TIMER_DELAY_MS) return Math.floor(parsed);
  console.warn(`[pi-web] invalid ${settingName} "${rawValue}", falling back to ${fallback} ms`);
  return fallback;
}

/** Silence that earns the "no progress for…" notice. `PI_WEB_RUN_STALL_NOTICE_MS`, `0` disables it. */
export const RUN_STALL_NOTICE_MS = resolveLivenessTimeoutMs(
  "PI_WEB_RUN_STALL_NOTICE_MS",
  process.env.PI_WEB_RUN_STALL_NOTICE_MS,
  DEFAULT_RUN_STALL_NOTICE_MS,
);

/** Silence after which a stalled run is stopped. `PI_WEB_RUN_STALL_ABORT_MS`; `0` (the default) never stops it. */
export const RUN_STALL_ABORT_MS = resolveLivenessTimeoutMs(
  "PI_WEB_RUN_STALL_ABORT_MS",
  process.env.PI_WEB_RUN_STALL_ABORT_MS,
  DEFAULT_RUN_STALL_ABORT_MS,
);

/** The stall report `get_state` carries, and the browser reconciles from. */
export interface AgentRunLiveness {
  phase: AgentRunPhase;
  /** The last progress event of the current run; null while nothing runs. */
  lastProgressAt: number | null;
  noProgressMs: number;
  /** The notice has been sent for this run, and said how much silence it saw. */
  stalledMs: number;
  noticeMs: number;
  abortMs: number;
}
