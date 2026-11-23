import { COMPLETION_NOTICE_MAX_AGE_MS } from "./notification-tags";
import { raiseMacNotification, readLocalNotificationSettings } from "./local-notification";
import { publishNtfyMessage, type NtfyPublishResult } from "./ntfy-publish";
import { resolveSessionPath } from "./session-reader";
import { readLastRunTimes } from "./session-last-run";
import {
  notifySessionEvent,
  sessionPushPayload,
  type SessionPushEvent,
} from "./web-push";

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
 *
 * The page raises no notification for a finished run any more. It used to show its own
 * banner next to these channels (the Notification API, a per-browser switch), and a task
 * that arrived twice — the second one only while the tab was in the background — read as a
 * bug. What the page keeps is the completion sound and the extension UI's "needs you"
 * notice (lib/browser-notifications.ts).
 *
 * Every channel is asked in parallel and every failure is swallowed: this runs at the end
 * of a task, next to the completion sound, and a notification problem must never reach the
 * chat.
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
}

export interface AttentionAnnounceRequest {
  sessionId: string;
  sessionName: string | null;
  prompt: string;
  /** The dialog's own id: one dialog announces once, however often its request is replayed. */
  requestId?: string;
}

export type AnnounceSkip = "aborted" | "failed" | "stale" | "announced" | "cooldown";

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
  /** Resolves when the push service took the message for every subscription. */
  notifyPush: (sessionId: string, event: SessionPushEvent, sessionName?: string | null) => Promise<void>;
  publishNtfy: (message: { title: string; body: string; priority?: number }) => Promise<Pick<NtfyPublishResult, "sent" | "status">>;
  raiseLocal: (options: { title: string; body: string }) => Promise<boolean>;
  /** The installation's own notification settings: the switch and the language. */
  localSettings: () => { enabled: boolean; locale: string };
  /**
   * The last run recorded in a session's own file, for a run this process has no span for
   * (a queued prompt, a wrapper restored mid-run, a run started from another device).
   */
  lastRun: (sessionId: string) => Promise<{ startedAt: number; endedAt: number } | null>;
}

/** At most one "waiting for you" push per session in this window. */
export const ATTENTION_COOLDOWN_MS = 10 * 60_000;

/** The ntfy priority of a finished task: it is the message the user is waiting for. */
const NTFY_PRIORITY = 4;

interface NoticeLedger {
  /** Announced keys, oldest first, bounded. */
  announced: Map<string, number>;
  /** Last attention push per session. */
  attention: Map<string, number>;
}

const LEDGER_LIMIT = 500;
const LEDGER_KEY = Symbol.for("pi-web:completion-notices");

function ledger(): NoticeLedger {
  const store = globalThis as unknown as Record<symbol, NoticeLedger | undefined>;
  const existing = store[LEDGER_KEY];
  if (existing) return existing;
  const created: NoticeLedger = { announced: new Map(), attention: new Map() };
  store[LEDGER_KEY] = created;
  return created;
}

/** Forget every announcement (tests; a restart of the process does the same). */
export function resetCompletionAnnouncements(): void {
  const book = ledger();
  book.announced.clear();
  book.attention.clear();
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
  const { sessionId, sessionName } = request;
  const sent = { push: false, ntfy: false, local: false };
  const now = env.now();
  if (request.outcome.status === "aborted") return { skipped: "aborted", key: `${sessionId}|aborted`, sent };
  // A run that ended in an error says nothing out loud. The sentence the phone, the topic
  // and Notification Center would carry is the provider's own failure text (a 400, a
  // quota, an offline proxy), and the user asked not to be shown it: the failure is in
  // the chat, and it stays in the session file. Only a run that finished is announced.
  if (request.outcome.status === "failed") return { skipped: "failed", key: `${sessionId}|failed`, sent };

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
  const book = ledger();
  if (!claim(book, key, now)) return { skipped: "announced", key, sent };

  const event = runEndEvent(outcome);
  const settings = env.localSettings();
  // One payload builder for every channel, so the phone, the topic and Notification
  // Center read exactly the same sentence about one finished task.
  const message = sessionPushPayload(sessionId, sessionName ?? undefined, event, settings.locale);

  const [push, ntfy, local] = await Promise.all([
    env.notifyPush(sessionId, event, sessionName).then(() => true, () => false),
    env.publishNtfy({ title: message.title, body: message.body, priority: NTFY_PRIORITY })
      .then((result) => result.sent, () => false),
    // The Mac's own row is the installation's switch; the push has none, because a
    // subscription is a device opting in, and ntfy has its own server-side switch.
    settings.enabled
      ? env.raiseLocal({ title: message.title, body: message.body }).then(() => true, () => false)
      : Promise.resolve(false),
  ]);
  sent.push = push === true;
  sent.ntfy = ntfy === true;
  sent.local = local === true;
  return { sent, key, title: message.title, body: message.body };
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
