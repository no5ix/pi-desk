/**
 * The run a finished background task woke, so the app keeps quiet about it.
 *
 * The task manager ends a finished task in three ways at once: it writes its notice into the
 * conversation (the card reports that, and the chat leaves it out — notification.ts), it raises a
 * terminal notification, and, by its default, it asks the agent for a follow-up turn about the
 * result. That turn is the extension's news arriving; it is not the user's task ending. Pi-desk
 * announces a finished run on the desktop, over web push and over ntfy (task-completion-server),
 * with the sentence "The task lasted …, started …, and ended …" — said for every one of those
 * machine-woken turns, it is a burst of notifications for work the user started minutes ago, from
 * a card that already lists the task, its status, its exit code and its output.
 *
 * So the run that a completion woke is announced by the card and by nothing else. This module is
 * where the two sides meet: the bridge sees the extension say that tasks stopped running and
 * settled, and the session asks, when a run starts, whether an extension completion explains it.
 *
 * The rules that make it trustworthy:
 * - Only a frame from the extension's own activation counts. Nothing is guessed from the chat's
 *   text, and no task list lives here: a settled/running count per conversation, and a timestamp.
 * - A run the app asked for is announced. The conversation's own request time is compared with
 *   the completion: the user's prompt, queue, steering, retry, slash command, fork or navigation
 *   (anything that goes through the session's request path) is the user's, always.
 * - A note expires. Only a run that starts within the window after the completion is treated as
 *   woken by it, so a completion never silences a later task, and a completion that woke nothing
 *   leaves nothing behind.
 * - A completion that settles nothing announces nothing: the finished task's own row and the
 *   card's failure mark are the announcement, on every channel.
 * - Like the other long-lived server maps in this process, it lives on `globalThis` (Next's hot
 *   reload replaces the module, not the process) and holds one number per live conversation.
 */

interface CompletionStore {
  /** sessionId → when the extension last said a task of this conversation stopped and settled. */
  settledAt: Map<string, number>;
  /** sessionId → the counts of the last frame, to see a task leave `running` and settle. */
  counts: Map<string, SettledCounts>;
}

interface SettledCounts {
  running: number;
  settled: number;
}

/** How long after a completion a run still counts as woken by it. The extension's follow-up turn
 *  starts when its notice lands; a run much later than that was asked for. */
export const COMPLETION_WINDOW_MS = 30_000;

const STATE_KEY = "__piBackgroundTasksCompletionGate";

function store(): CompletionStore {
  const globals = globalThis as Record<string, unknown>;
  const existing = globals[STATE_KEY] as CompletionStore | undefined;
  if (existing && existing.settledAt instanceof Map && existing.counts instanceof Map) return existing;
  const created: CompletionStore = { settledAt: new Map(), counts: new Map() };
  globals[STATE_KEY] = created;
  return created;
}

/**
 * One of this conversation's tasks stopped running and settled.
 *
 * Read from the extension's counts: a task left `running` and the settled total grew. That is
 * what a completion looks like from the outside, and it is what the extension itself reports;
 * the first frame only plants the baseline, so a bridge that starts with three finished tasks
 * announces nothing.
 */
export function noteBackgroundTaskSettlement(input: {
  sessionId: string;
  running: number;
  settled: number;
  at?: number;
}): void {
  const current = store();
  const at = input.at ?? Date.now();
  const previous = current.counts.get(input.sessionId);
  current.counts.set(input.sessionId, { running: input.running, settled: input.settled });
  if (!previous) return;
  if (input.running < previous.running && input.settled > previous.settled) {
    current.settledAt.set(input.sessionId, at);
  }
}

/**
 * Whether the run that is starting is the extension's news arriving, and so is announced by the
 * card alone.
 *
 * `requestedAt` is when this conversation last asked the server for work (the composer, a queue,
 * a retry, a command, a fork, a navigation). A request at or after the completion is the user's
 * own task, and its finish is announced like any other.
 */
export function runWokeByBackgroundTask(
  sessionId: string,
  requestedAt: number,
  options: { now?: number; windowMs?: number } = {},
): boolean {
  const settledAt = store().settledAt.get(sessionId);
  if (settledAt === undefined) return false;
  if (requestedAt >= settledAt) return false;
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? COMPLETION_WINDOW_MS;
  return now - settledAt <= windowMs;
}

/** A conversation the server is not holding has no completions to explain runs. */
export function clearBackgroundTaskCompletions(sessionId: string): void {
  const current = store();
  current.settledAt.delete(sessionId);
  current.counts.delete(sessionId);
}

/** The gate as the app sees it: which conversations carry a completion note, and how old it is. */
export function backgroundTaskCompletionSnapshot(now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [sessionId, at] of store().settledAt) out[sessionId] = now - at;
  return out;
}
