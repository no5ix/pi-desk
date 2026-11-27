import { backgroundTasksObservedIn, runWokeByBackgroundTask } from "./background-tasks/completion-gate";
import { COMPLETION_NOTICE_MAX_AGE_MS } from "./notification-tags";
import { backgroundTasksRunningCount } from "./background-tasks/running-index";
import { raiseMacNotification, readLocalNotificationSettings } from "./local-notification";
import { publishNtfyMessage, type NtfyPublishResult } from "./ntfy-publish";
import { resolveSessionPath } from "./session-reader";
import { readLastRunTimes } from "./session-last-run";
import { readPromptTitle } from "./session-prompt-title";
import {
  completionAnnouncement,
  notifySessionEvent,
  sessionPushPayload,
  type PushDelivery,
  type SessionPushEvent,
} from "./web-push";

/** The push service's answer for one send; the type lives in `lib/web-push.ts`. */
export type { PushDelivery };

/**
 * The one place a finished run is announced **by the server**.
 *
 * A finished task is news the moment this process says it is finished, and the page used
 * to be the sender for every channel except the phone push. That is where the two
 * complaints came from:
 *
 *  - *nothing arrives.* A task started from a phone over the relay, a queued prompt, a
 *    run that settles while the chat page is closed, navigated away, discarded by the
 *    browser, or suspended on iOS has no page left to run the notification code, and the
 *    ntfy message and the Mac's Notification Center row were that page's job. The server
 *    owns the run, its span, its name and its outcome, and it is awake; it sends.
 *  - *things arrive that are not news.* One run announces once: the dedupe key is the run
 *    itself, so the several paths that settle a run (`agent_settled`, the prompt promise,
 *    a wrapper re-created mid-run, a restart that settles a restored run) cannot repeat
 *    it, and a run that ended while this process was not watching is dropped rather than
 *    announced as breaking news.
 *  - *a notification must name its task.* Every channel speaks the same format: the title
 *    is the session's name, and the content is the run's one sentence ("The task lasted
 *    0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at
 *    10:22:47."). A run with no name, or with no span, is silent: "Session complete" and
 *    "Task finished." say nothing about which task finished, and the user asked never to
 *    be shown that format. `completionAnnouncement` in lib/web-push.ts is the one judge.
 *
 * The page raises no notification for a finished run any more. It used to show its own
 * banner next to these channels (the Notification API, a per-browser switch), and a task
 * that arrived twice — the second one only while the tab was in the background — read as a
 * bug. What the page keeps is the completion sound and the extension UI's "needs you"
 * notice (lib/browser-notifications.ts).
 *
 * A background task is not a finished run, and this is the module that says so. A prompt that
 * starts three shell tasks answers in fifteen seconds while the tasks run for two minutes, and
 * every task that settles wakes a turn of the agent's about its result. **Nothing is announced
 * when a task finishes** — the card is where a finished task is read. The announcement is the
 * **conversation** finishing: a run that ends with tasks of this conversation running is kept
 * (`holdRunEnd`), the settlement of a task only re-arms the quiet timer
 * (`noteBackgroundTasksSettled`), and the run that ends with the conversation quiet is announced
 * with the kept run's start and its own end — one sentence about the whole job, once, on every
 * channel. `quietTick` and `CONVERSATION_QUIET_MS` are the waiting, `DEFERRED_NOTICE_MAX_WAIT_MS`
 * the cap that never swallows a notice.
 *
 * Every channel is asked in parallel and every failure is swallowed: this runs at the end
 * of a task, next to the completion sound, and a notification problem must never reach the
 * chat. What is not swallowed is the knowledge of it: `reportAnnouncement` writes one line
 * per notice with each channel's answer, because three silently-swallowed channels and no
 * notification are indistinguishable from the sofa.
 */

/** How a run ended, as `lib/rpc-manager.ts` reports it. */
export interface AnnounceRunOutcome {
  status: "done" | "failed" | "aborted";
  error?: string;
  startedAt?: number;
  endedAt?: number;
}

export interface CompletionAnnounceRequest {
  sessionId: string;
  sessionName: string | null;
  outcome: AnnounceRunOutcome;
  /**
   * When this conversation last asked the server for work (a prompt, a queue, steering, a retry, a
   * command, a fork, a navigation). A run that starts after a task settled with no request behind
   * it is the extension handing in its result, and it announces nothing on its own
   * (background-tasks/completion-gate.ts). The session's own gate applies it first; this is the
   * same judge for the paths that reach the announcer before the extension's frame lands.
   */
  requestedAt?: number;
  /**
   * Whether this run started a background task of its own — the session saw the extension's task
   * tool execute. The running index reports news, and the extension's first frame reports an empty
   * registry, so at the moment a fast answer settles neither says that the run has work in flight.
   * The tool call does, with no race: a run that started a task is never announced on its own end.
   */
  backgroundWorkStarted?: boolean;
}

export interface AttentionAnnounceRequest {
  sessionId: string;
  sessionName: string | null;
  prompt: string;
  /** The dialog's own id: one dialog announces once, however often its request is replayed. */
  requestId?: string;
}

export type AnnounceSkip =
  | "aborted"
  | "failed"
  | "stale"
  | "announced"
  | "cooldown"
    /** The run ended while the conversation's background work was still going. */
  | "background-tasks"
  /** The run is the turn a finished task woke, and nothing of the user's is waiting on it. */
  | "machine-woken"
  | "unnamed"
  | "no-span";

export interface AnnounceOutcome {
  skipped?: AnnounceSkip;
  /** The key this announcement was booked under, so a caller can recognise it in a log. */
  key: string;
  sent: { push: boolean; ntfy: boolean; local: boolean };
  title?: string;
  body?: string;
}

export interface CompletionAnnounceEnv {
  now: () => number;
  /**
   * What the push service answered for one send: how many subscriptions took the message and why the
   * rest did not, so "no notification in the browser" is a fact in the log and not a guess; a caller
   * that answers nothing is read as a send that worked.
   */
  notifyPush: (sessionId: string, event: SessionPushEvent, sessionName?: string | null) => Promise<PushDelivery | void>;
  publishNtfy: (message: { title: string; body: string; priority?: number }) => Promise<Pick<NtfyPublishResult, "sent" | "status">>;
  raiseLocal: (options: { title: string; body: string }) => Promise<boolean>;
  /** The installation's own notification settings: the switch and the language. */
  localSettings: () => { enabled: boolean; locale: string };
  /**
   * The last run recorded in a session's own file, for a run this process has no span for
   * (a queued prompt, a wrapper restored mid-run, a run started from another device).
   */
  lastRun: (sessionId: string) => Promise<{ startedAt: number; endedAt: number } | null>;
  /**
   * The session's own title for a run whose live session carries no name: its first prompt,
   * the way the sidebar names the row (`lib/session-prompt-title.ts`). Null when the file has
   * no prompt in it, which leaves the run with no title and therefore no announcement.
   */
  sessionTitle: (sessionId: string) => Promise<string | null>;
  /**
   * How many of this conversation's background tasks the extensions say are running. A run that ends
   * while one is running is kept, not announced; a conversation whose tasks are all settled and
   * whose runs are over is the one that announces.
   */
  backgroundTasksRunning: (sessionId: string) => number;
  /**
   * Whether the extensions have anything to say about this conversation: its own bridge reported
   * tasks of it, running or settled. The per-session cooldown applies to that conversation only — a
   * session whose background work is producing a run per finished task is the burst; a session with
   * no such work is owed a notice for every task it finishes, however quickly they follow.
   */
  backgroundTasksObserved: (sessionId: string) => boolean;
  /**
   * Whether the run that is ending is the turn a finished task woke. `false` for a run this
   * conversation asked for, always; the extension's own frames are the evidence.
   */
  runWokeByBackgroundTask: (sessionId: string, requestedAt: number) => boolean;
}

/** At most one "waiting for you" push per session in this window. */
export const ATTENTION_COOLDOWN_MS = 10 * 60_000;

/**
 * At most one finished-task notice per session in this window.
 *
 * A task manager that finishes three tasks settles three runs, and a long answer followed by a
 * queued prompt settles two. To the user that is one finished task, and Notification Center shows
 * three rows of the same sentence about it; a desktop that announced one finished run has nothing
 * new to say about the next one a moment later.
 */
export const COMPLETION_NOTICE_COOLDOWN_MS = 30_000;

/**
 * How long a finished run may wait for the conversation's background work to settle before the app
 * says so anyway. A task that never settles (a server a task started and left running) must not
 * swallow the notice for the task the user asked for; ten minutes is longer than any shell command
 * a conversation starts on purpose and shorter than anyone will wait.
 */
export const DEFERRED_NOTICE_MAX_WAIT_MS = 10 * 60_000;

/**
 * How long the conversation must be quiet — no run of its own, no background task of its own —
 * before a kept notice is said.
 *
 * A finished task is not the end of the user's work, so the settlement never announces anything.
 * What announces is the conversation going quiet: the task manager starts a turn about the result
 * a moment after a task settles, that turn's end is the end of the job, and a notice kept past a
 * quiet window with nothing running has nothing left to arrive for it.
 */
export const CONVERSATION_QUIET_MS = 10_000;

/** The ntfy priority of a finished task: it is the message the user is waiting for. */
const NTFY_PRIORITY = 4;

interface NoticeLedger {
  /** Announced keys, oldest first, bounded. */
  announced: Map<string, number>;
  /** Last attention push per session. */
  attention: Map<string, number>;
  /** Last finished-task announcement per session, for the cooldown window. */
  completed: Map<string, number>;
}

/**
 * A finished run whose conversation is not over yet, kept for the moment it is.
 *
 * The run that started the tasks ends first, and its end is the end of what the user asked for only
 * once the tasks — and the turns those tasks woke — are done. So the announcement waits, and the
 * sentence carries the whole job: the kept run's start, the last settle's end. "The task lasted
 * 0h2m37s, started at 22:09:45, and ended at 22:12:22" is the number the user is waiting for, said
 * once, on every channel at once, when the conversation goes quiet.
 */
interface HeldCompletion {
  /** The run whose notice this is: its name, its request, its sentence. */
  request: CompletionAnnounceRequest;
  /** The start of the oldest kept run: the prompt that started the work. */
  startedAt: number | null;
  /** When the last of this conversation's activity settled — a run's end, or the last task. */
  settledAt: number;
  /** When the notice was first kept, for the cap that never swallows one. */
  heldSince: number;
  quietTimer: ReturnType<typeof setTimeout> | null;
  /**
   * The channels the caller chose, carried for the timers: the quiet window fires in the module's
   * own time, and it must send through the same sender the conversation's announcement uses — a
   * test's fakes, and never a second path to the real push service.
   */
  overrides: Partial<CompletionAnnounceEnv>;
}

interface HeldStore {
  held: Map<string, HeldCompletion>;
  /** The conversations with a run in flight, as the session reports it. */
  running: Set<string>;
}

const HELD_KEY = Symbol.for("pi-web:completion-notices-held");

function heldStore(): HeldStore {
  const store = globalThis as unknown as Record<symbol, HeldStore | undefined>;
  const existing = store[HELD_KEY];
  if (existing) return existing;
  const created: HeldStore = { held: new Map(), running: new Set() };
  store[HELD_KEY] = created;
  return created;
}

const LEDGER_LIMIT = 500;
const LEDGER_KEY = Symbol.for("pi-web:completion-notices");

function ledger(): NoticeLedger {
  const store = globalThis as unknown as Record<symbol, NoticeLedger | undefined>;
  const existing = store[LEDGER_KEY];
  if (existing) return existing;
  const created: NoticeLedger = { announced: new Map(), attention: new Map(), completed: new Map() };
  store[LEDGER_KEY] = created;
  return created;
}

/** Forget every announcement (tests; a restart of the process does the same). */
export function resetCompletionAnnouncements(): void {
  const book = ledger();
  book.announced.clear();
  book.attention.clear();
  book.completed.clear();
  const store = heldStore();
  for (const sessionId of [...store.held.keys()]) releaseConversationCompletion(sessionId);
  store.running.clear();
}

function claim(book: NoticeLedger, key: string, now: number): boolean {
  if (book.announced.has(key)) return false;
  book.announced.set(key, now);
  while (book.announced.size > LEDGER_LIMIT) {
    const oldest = book.announced.keys().next().value as string;
    book.announced.delete(oldest);
  }
  return true;
}

/**
 * The key that identifies one finished run.
 *
 * The span is the run's fingerprint. A run this process never saw begin has no span, so
 * the clock it settled on is used, bucketed: two paths settling the same run a second
 * apart get one key, and a genuinely new run gets a new one.
 */
export function runAnnounceKey(
  sessionId: string,
  kind: "complete" | "failed",
  outcome: AnnounceRunOutcome,
  now: number,
): string {
  const { startedAt, endedAt } = outcome;
  if (typeof startedAt === "number" && typeof endedAt === "number" && endedAt >= startedAt) {
    return `${sessionId}|${kind}|${startedAt}|${endedAt}`;
  }
  return `${sessionId}|${kind}|bucket:${Math.floor(now / 30_000)}`;
}

/** The push event for a run's end, shared by the push payload and the sentence. */
export function runEndEvent(outcome: AnnounceRunOutcome): SessionPushEvent {
  if (outcome.status === "failed") return { kind: "failed", detail: outcome.error };
  return { kind: "complete", startedAt: outcome.startedAt, endedAt: outcome.endedAt };
}

/**
 * The outcome with a span filled in from the session file when the caller had none. Never
 * throws: a run keeps its announcement when the file cannot be read.
 */
async function withSpan(
  outcome: AnnounceRunOutcome,
  sessionId: string,
  env: Required<CompletionAnnounceEnv>,
): Promise<AnnounceRunOutcome> {
  const { startedAt, endedAt } = outcome;
  if (typeof startedAt === "number" && typeof endedAt === "number" && endedAt >= startedAt) return outcome;
  const fromFile = await env.lastRun(sessionId).catch(() => null);
  if (!fromFile) return outcome;
  return { ...outcome, startedAt: fromFile.startedAt, endedAt: fromFile.endedAt };
}

const ENV_DEFAULTS: CompletionAnnounceEnv = {
  now: () => Date.now(),
  notifyPush: (sessionId, event, sessionName) => notifySessionEvent(sessionId, event, sessionName),
  publishNtfy: (message) => publishNtfyMessage(message),
  raiseLocal: (options) => raiseMacNotification(options),
  localSettings: () => readLocalNotificationSettings(),
  lastRun: async (sessionId) => {
    const filePath = await resolveSessionPath(sessionId).catch(() => null);
    if (!filePath) return null;
    const last = await readLastRunTimes(filePath).catch(() => null);
    if (!last || typeof last.startedAt !== "number" || typeof last.endedAt !== "number" || last.endedAt < last.startedAt) {
      return null;
    }
    return { startedAt: last.startedAt, endedAt: last.endedAt };
  },
  sessionTitle: async (sessionId) => {
    const filePath = await resolveSessionPath(sessionId).catch(() => null);
    if (!filePath) return null;
    return readPromptTitle(filePath).catch(() => null);
  },
  backgroundTasksRunning: (sessionId) => backgroundTasksRunningCount(sessionId),
  backgroundTasksObserved: (sessionId) => backgroundTasksObservedIn(sessionId),
  runWokeByBackgroundTask: (sessionId, requestedAt) => runWokeByBackgroundTask(sessionId, requestedAt),
};

/**
 * Callers override one part (a test fakes the push, a caller supplies its own clock), so
 * every part is merged over the defaults and never read straight off the caller's object.
 */
function resolveEnv(overrides: Partial<CompletionAnnounceEnv> = {}): Required<CompletionAnnounceEnv> {
  const merged = { ...ENV_DEFAULTS } as Required<CompletionAnnounceEnv>;
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) Object.assign(merged, { [name]: value });
  }
  return merged;
}

/**
 * Announce one run's end: the phone push, the ntfy message, and the Mac's Notification
 * Center row, each in the words the app uses, each asked once per run.
 */
export async function announceRunEnd(
  request: CompletionAnnounceRequest,
  overrides: Partial<CompletionAnnounceEnv> = {},
): Promise<AnnounceOutcome> {
  const env = resolveEnv(overrides);
  const { sessionId } = request;
  const sent = { push: false, ntfy: false, local: false };
  const now = env.now();
  // This call is a run of the conversation ending: its own work is over, whatever else is in flight.
  heldStore().running.delete(sessionId);
  if (request.outcome.status === "aborted") {
    quietIfConversationIdle(sessionId, env, overrides);
    return { skipped: "aborted", key: `${sessionId}|aborted`, sent };
  }
  // A run that ended in an error says nothing out loud. The sentence the phone, the topic
  // and Notification Center would carry is the provider's own failure text (a 400, a
  // quota, an offline proxy), and the user asked not to be shown it: the failure is in
  // the chat, and it stays in the session file. Only a run that finished is announced.
  if (request.outcome.status === "failed") {
    quietIfConversationIdle(sessionId, env, overrides);
    return { skipped: "failed", key: `${sessionId}|failed`, sent };
  }

  // Nothing is announced while the conversation is still at work, and a finished background task
  // announces nothing on its own.
  //
  // A background task changes what "the task finished" means. The run that started three tasks ends
  // in fifteen seconds while the tasks run for two more minutes, and each task that settles wakes a
  // turn of the agent's about its result. A notification for any of those is news about a task the
  // user can read in the card, in the words "The task lasted 0h0m15s" — not their task at all. So:
  //
  //  - a run that ends with tasks of this conversation still running is **kept**, not said;
  //  - so is a run of a conversation the extensions have background work for, even when its own
  //    tasks have settled: the task manager is about to wake a turn about each result, and the race
  //    between the extension's frame and the run's end is exactly how a settlement announcement got
  //    said at all. For a conversation with background work, the quiet window is the announcement;
  //  - the settlement of a task is not an announcement moment (see `noteBackgroundTasksSettled`);
  //  - the conversation going quiet is: the run that ends with nothing of this conversation running
  //    is the end of the job, and it is announced with the **kept run's start** and **this run's
  //    end** — the whole job in one sentence, on every channel, once.
  //
  // A run that ends with nothing running and nothing kept is an ordinary finished task, and it
  // announces straight away: a conversation with no background work is never made to wait.
  if (
    env.backgroundTasksRunning(sessionId) > 0
    || env.backgroundTasksObserved(sessionId)
    || request.backgroundWorkStarted === true
  ) {
    holdRunEnd(request, env, overrides);
    return { skipped: "background-tasks", key: `${sessionId}|background-tasks`, sent };
  }
  const held = heldStore().held.get(sessionId);
  if (held) {
    const merged: CompletionAnnounceRequest = {
      // The kept run is the one the user asked for: its name and its request carry over, and its
      // start opens the sentence. This run's end closes it.
      ...held.request,
      requestedAt: request.requestedAt ?? held.request.requestedAt,
      outcome: {
        ...request.outcome,
        startedAt: earliest(held.startedAt, request.outcome.startedAt),
        endedAt: request.outcome.endedAt ?? now,
      },
    };
    releaseConversationCompletion(sessionId);
    return announceFinishedRun(merged, env);
  }
  // The turn a finished task woke, with nothing of the user's waiting behind it: the card is the
  // announcer (the row moves, a failure wears its mark), and this run says nothing on the desktop,
  // over push, or over ntfy.
  if (typeof request.requestedAt === "number" && env.runWokeByBackgroundTask(sessionId, request.requestedAt)) {
    return { skipped: "machine-woken", key: `${sessionId}|machine-woken`, sent };
  }
  return announceFinishedRun(request, env);
}

/**
 * The announcement itself: the span, the title, the format, the dedupe, and the three channels.
 *
 * This is what `quietTick` and `noteConversationRunSettled` call directly. The conversation has
 * already been decided to be over by the time they ask, and a task of it that never settles must
 * not send the notice back into the hold that has been waiting for it — that is how a finished task
 * ends up with no notification at all.
 */
async function announceFinishedRun(
  request: CompletionAnnounceRequest,
  env: Required<CompletionAnnounceEnv>,
): Promise<AnnounceOutcome> {
  const { sessionId, sessionName } = request;
  const sent = { push: false, ntfy: false, local: false };
  const now = env.now();

  // A run this process has no numbers for asks the session's own file, so the phone and
  // the Mac read "the task lasted 0h18m13s …" instead of the short sentence. Best effort:
  // a run with no span anywhere is still announced.
  const outcome = await withSpan(request.outcome, sessionId, env);
  const kind = outcome.status === "failed" ? "failed" : "complete" as const;
  const key = runAnnounceKey(sessionId, kind, outcome, now);
  // A run whose end is older than the window is a run this process is catching up on
  // (a wrapper restored mid-run, a restart that settles what had already finished).
  if (typeof outcome.endedAt === "number" && now - outcome.endedAt > COMPLETION_NOTICE_MAX_AGE_MS) {
    return { skipped: "stale", key, sent };
  }
  // The format is fixed, on every channel: the **title** is the session's name, and the
  // **content** is the run's one sentence ("The task lasted 0h18m13s, started at 10:04:34,
  // and ended at 10:22:47. This notification pops up at 10:22:47.").
  //
  // The title is the session's name, and a session that has none yet (nobody renamed it and
  // auto-naming has not named it) is titled the way the sidebar titles its row: its first
  // prompt. "Session complete" is the wrong format — it cannot say which task ended — and
  // silence for every session with auto-naming off is not a better answer. A session with no
  // prompt at all in its file is the only one left untitled, and it announces nothing.
  const title = sessionName?.trim()
    || (await env.sessionTitle(sessionId).catch(() => null))?.trim()
    || null;
  // The span is the other half: a run with no numbers can only say "Task finished.", which
  // is the same wrong format, so it is skipped too (`withSpan` already asked the file).
  const parts = completionAnnouncement(title, outcome);
  if (!parts) {
    const skipped: AnnounceSkip = title ? "no-span" : "unnamed";
    return { skipped, key, sent };
  }
  const book = ledger();
  if (!claim(book, key, now)) return { skipped: "announced", key, sent };
  // One notice per session per window, where a window of background work is producing the runs.
  // A task manager that finishes three tasks settles a run for each of them, and Notification
  // Center gets three rows of the same sentence about one job the user asked for once. A session
  // with no background work is not in that situation, and every finished task of it is news.
  if (env.backgroundTasksObserved(sessionId)) {
    const lastCompletion = book.completed.get(sessionId);
    if (typeof lastCompletion === "number" && now - lastCompletion < COMPLETION_NOTICE_COOLDOWN_MS) {
      return { skipped: "cooldown", key, sent };
    }
  }

  const event = runEndEvent(outcome);
  const settings = env.localSettings();
  // One payload builder for every channel, so the phone, the topic and Notification
  // Center read exactly the same sentence about one finished task.
  const message = sessionPushPayload(sessionId, parts.title, event, settings.locale);

  const [pushResult, ntfyResult, localRaised] = await Promise.all([
    env.notifyPush(sessionId, event, parts.title)
      .then((delivery) => ({ ok: delivery === undefined || delivery.sent > 0, delivery: delivery ?? null }),
        () => ({ ok: false, delivery: null as PushDelivery | null })),
    env.publishNtfy({ title: message.title, body: message.body, priority: NTFY_PRIORITY })
      .then((result) => ({ ok: result.sent, status: result.status }),
        () => ({ ok: false, status: "failed" as const })),
    // The Mac's own row is the installation's switch; the push has none, because a
    // subscription is a device opting in, and ntfy has its own server-side switch.
    settings.enabled
      ? env.raiseLocal({ title: message.title, body: message.body }).then((raised) => ({ ok: raised === true }), () => ({ ok: false }))
      : Promise.resolve({ ok: false, }),
  ]);
  sent.push = pushResult.ok;
  sent.ntfy = ntfyResult.ok;
  sent.local = localRaised.ok;
  if (env.backgroundTasksObserved(sessionId)) book.completed.set(sessionId, now);
  reportAnnouncement({ sessionId, sent, push: pushResult.delivery, ntfyStatus: ntfyResult.status });
  return { sent, key, title: message.title, body: message.body };
}

/** A push endpoint, short: it names a device to its own server, and a full URL is log noise. */
function shortEndpoint(endpoint: string): string {
  return endpoint.replace(/^https:\/\//, "").slice(0, 24);
}

/**
 * One line in the server's log for every notice: which channels answered, and why one of them did
 * not. Each channel swallows its own failure — a notification must never reach the chat — so
 * without this line "the phone never buzzed" and "this browser has no subscription" and "Apple
 * refused the key" are the same silence. A finished run is announced a handful of times a day:
 * the line is the way to answer "did Safari get it?" without a debugger.
 */
function reportAnnouncement(facts: {
  sessionId: string;
  sent: AnnounceOutcome["sent"];
  push: PushDelivery | null;
  ntfyStatus: string;
}): void {
  const { sessionId, sent, push, ntfyStatus } = facts;
  const pushWords = push
    ? `${push.attempted === 0
        ? "no device is subscribed"
        : `${String(push.sent)}/${String(push.attempted)} device${push.attempted === 1 ? "" : "s"}`}`
    : sent.push ? "accepted" : "failed";
  const detail = (push?.failures ?? [])
    .map((failure) => `${shortEndpoint(failure.endpoint)} ${String(failure.statusCode)}`)
    .join(" ");
  const line = `[pi-web] finished run in ${sessionId.slice(0, 8)}: push ${pushWords}, ntfy ${ntfyStatus}, mac ${sent.local ? "raised" : "not raised"}`;
  if (!sent.push || !sent.ntfy) console.warn(`${line}${detail ? ` — refused: ${detail}` : ""}`);
  else console.info(line);
}

/**
 * The conversation's background tasks have all settled. **This announces nothing.**
 *
 * The bridge calls it (the extension's own frames are the only thing that knows a task stopped).
 * A finished task is not the end of what the user asked for: the card already shows the task, its
 * status, its exit and its log, and the task manager's default is to ask the agent for a turn about
 * the result — and that turn's end is the end of the job. So the settlement only re-arms the quiet
 * timer. If the conversation stays quiet for `CONVERSATION_QUIET_MS` with no run of its own, the
 * kept notice is said; if a turn starts, the timer is disarmed and that run's end says it, carrying
 * the kept run's start so the sentence names the whole job.
 */
export function noteBackgroundTasksSettled(sessionId: string, at = Date.now()): void {
  const held = heldStore().held.get(sessionId);
  if (!held) return;
  held.settledAt = Math.max(held.settledAt, at);
  armQuiet(sessionId, held.overrides);
}

/**
 * A run of this conversation has started, so the conversation is at work and a kept notice is not
 * due. The session calls this at `agent_start`; the run's own end is the call to `announceRunEnd`,
 * and that is what announces.
 */
export function noteConversationRunStart(sessionId: string): void {
  const store = heldStore();
  store.running.add(sessionId);
  const held = store.held.get(sessionId);
  if (held?.quietTimer) {
    clearTimeout(held.quietTimer);
    held.quietTimer = null;
  }
}

/** The run the conversation finished while its own work went on, kept for the moment it is over. */
function holdRunEnd(
  request: CompletionAnnounceRequest,
  env: Required<CompletionAnnounceEnv>,
  overrides: Partial<CompletionAnnounceEnv>,
): void {
  const store = heldStore();
  const existing = store.held.get(request.sessionId);
  const at = env.now();
  store.held.set(request.sessionId, {
    request,
    startedAt: existing?.startedAt ?? request.outcome.startedAt ?? null,
    settledAt: at,
    heldSince: existing?.heldSince ?? at,
    quietTimer: null,
    overrides,
  });
  armQuiet(request.sessionId, overrides);
}

function armQuiet(sessionId: string, overrides: Partial<CompletionAnnounceEnv> = {}): void {
  const held = heldStore().held.get(sessionId);
  if (!held) return;
  if (held.quietTimer) clearTimeout(held.quietTimer);
  const timer = setTimeout(() => {
    held.quietTimer = null;
    void quietTick(sessionId, overrides).catch((error: unknown) => {
      console.error("[pi-web] the quiet-window notice failed:", error instanceof Error ? error.message : String(error));
    });
  }, CONVERSATION_QUIET_MS);
  timer.unref?.();
  held.quietTimer = timer;
}

/**
 * The quiet window closed on a kept notice.
 *
 * A conversation with a run in flight, or with tasks of its own still running, is not over: the
 * timer is re-armed and says nothing. `DEFERRED_NOTICE_MAX_WAIT_MS` is the cap that stops a task
 * which never settles (a server a task started and left running) from swallowing the notice for the
 * work the user did ask for.
 */
export async function quietTick(
  sessionId: string,
  overrides: Partial<CompletionAnnounceEnv> = {},
): Promise<AnnounceOutcome | null> {
  const store = heldStore();
  const held = store.held.get(sessionId);
  if (!held) return null;
  // The kept notice carries the channels of the run that made it: the timer passes them back, and a
  // tick that names none (the bridge's re-arm, a caller with no env) must not fall through to this
  // process's real push, ntfy and Notification Center.
  const env = resolveEnv({ ...held.overrides, ...overrides });
  const now = env.now();
  const working = env.backgroundTasksRunning(sessionId) > 0 || store.running.has(sessionId);
  const atTheCap = now - held.heldSince >= DEFERRED_NOTICE_MAX_WAIT_MS;
  if (working && !atTheCap) {
    armQuiet(sessionId, held.overrides);
    return null;
  }
  const request: CompletionAnnounceRequest = {
    ...held.request,
    outcome: {
      ...held.request.outcome,
      startedAt: held.startedAt ?? held.request.outcome.startedAt,
      // The sentence ends at the last thing that settled, not on the timer's own tick. At the cap
      // the conversation is still working, and the notice is being said now, so it ends now — a
      // number minutes old would be read as a run this process is catching up on and stay silent.
      endedAt: atTheCap ? now : Math.max(held.settledAt, held.request.outcome.endedAt ?? 0),
    },
  };
  releaseConversationCompletion(sessionId);
  return announceFinishedRun(request, env);
}

/**
 * A run of this conversation ended, and the run is not news on its own: it is the turn a finished
 * task woke to hand in its result.
 *
 * Its end is still the conversation going quiet, and it is very often the *last* thing the user's
 * prompt set in motion. So this says nothing about the wake-up turn, and announces the notice kept
 * for the work that woke it, with **this run's end** closing the sentence. The session calls it when
 * its own gate has marked a run as machine-woken, because the announcement decision and the notice
 * for the user's run are one question and must be answered in one place.
 */
export async function noteConversationRunSettled(
  sessionId: string,
  end: { startedAt?: number; endedAt?: number; backgroundWorkStarted?: boolean } = {},
  overrides: Partial<CompletionAnnounceEnv> = {},
): Promise<AnnounceOutcome | null> {
  const store = heldStore();
  store.running.delete(sessionId);
  const held = store.held.get(sessionId);
  if (!held) return null;
  const env = resolveEnv(overrides);
  const now = env.now();
  // Something of this conversation is still running — a task, or a task this very turn started: the
  // notice waits, as it always does.
  if (env.backgroundTasksRunning(sessionId) > 0 || end.backgroundWorkStarted === true) {
    held.settledAt = now;
    armQuiet(sessionId, held.overrides);
    return null;
  }
  const request: CompletionAnnounceRequest = {
    ...held.request,
    outcome: {
      ...held.request.outcome,
      startedAt: earliest(held.startedAt, end.startedAt),
      endedAt: end.endedAt ?? Math.max(held.settledAt, held.request.outcome.endedAt ?? 0),
    },
  };
  releaseConversationCompletion(sessionId);
  return announceFinishedRun(request, env);
}

/** A conversation whose bridge is gone has nothing left to wait for: its kept notice goes with it. */
export function releaseConversationCompletion(sessionId: string): void {
  const store = heldStore();
  const held = store.held.get(sessionId);
  if (held?.quietTimer) clearTimeout(held.quietTimer);
  store.held.delete(sessionId);
  store.running.delete(sessionId);
}

/** An aborted or failed run has no sentence of its own, and it is the conversation going quiet. */
function quietIfConversationIdle(sessionId: string, env: Required<CompletionAnnounceEnv>, overrides: Partial<CompletionAnnounceEnv>): void {
  const store = heldStore();
  const held = store.held.get(sessionId);
  if (!held) return;
  if (env.backgroundTasksRunning(sessionId) > 0 || store.running.has(sessionId)) return;
  void quietTick(sessionId, overrides).catch((error: unknown) => {
    console.error("[pi-web] the quiet-window notice failed:", error instanceof Error ? error.message : String(error));
  });
}

/** The earlier of two run starts, ignoring a caller that has no number for its run. */
function earliest(a: number | null | undefined, b: number | null | undefined): number | undefined {
  const known = [a, b].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? Math.min(...known) : undefined;
}

/**
 * Announce that a session is parked on a dialog the user has to answer.
 *
 * A dialog announces once (its own id), and a session gets at most one of these pushes per
 * `ATTENTION_COOLDOWN_MS`: the trust and permission dialogs an MCP server raises at session
 * start are the buzzes people hear with no task running.
 */
export async function announceAttention(
  request: AttentionAnnounceRequest,
  overrides: Partial<CompletionAnnounceEnv> = {},
): Promise<AnnounceOutcome> {
  const env = resolveEnv(overrides);
  const { sessionId, sessionName, prompt, requestId } = request;
  const sent = { push: false, ntfy: false, local: false };
  const now = env.now();
  const book = ledger();
  const key = requestId ? `attention|${sessionId}|${requestId}` : `attention|${sessionId}|bucket:${Math.floor(now / 30_000)}`;
  if (!claim(book, key, now)) return { skipped: "announced", key, sent };
  const last = book.attention.get(sessionId);
  if (typeof last === "number" && now - last < ATTENTION_COOLDOWN_MS) return { skipped: "cooldown", key, sent };
  book.attention.set(sessionId, now);
  sent.push = await env.notifyPush(sessionId, { kind: "attention", detail: prompt }, sessionName)
    .then(() => true, () => false);
  return { sent, key };
}

/** The title/body a finished run produces for one locale, for callers that show it themselves. */
export function runEndMessage(
  sessionId: string,
  sessionName: string | null,
  outcome: AnnounceRunOutcome,
  locale: string,
): { title: string; body: string; url: string; tag: string } {
  return sessionPushPayload(sessionId, sessionName ?? undefined, runEndEvent(outcome), locale);
}
