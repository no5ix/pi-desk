import { formatCompletionSummary } from "./completion-notification";
import { shouldShowBrowserNotification, showBrowserNotification } from "./browser-notifications";
import { COMPLETION_NOTICE_MAX_AGE_MS, sessionNotificationTag } from "./notification-tags";

/**
 * The banner this browser shows for a finished task.
 *
 * A finished task is announced by the server (lib/task-completion-server.ts): the phone
 * push, the ntfy message, and the Mac's Notification Center row all come from the process
 * that owns the run, so they arrive with no page open. What no server can do is put a
 * banner in the browser you are looking at, and that is this module's whole job.
 *
 * It says the same sentence the server says:
 *
 *   title  the session's name
 *   body   "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47.
 *           This notification pops up at 10:22:47."
 *
 * Four rules:
 *
 *  - **A run needs a span, and a run with no numbers still says something.** The page has
 *    a span only for a run it saw begin; for a task started from a phone over the relay, a
 *    queued prompt, a page reloaded mid-run, or an extension-triggered run it asks the
 *    session file (`/api/sessions/[id]/last-run`). A file with no run in it is not silence
 *    any more: the page watched this run end, so it says the short
 *    "Task finished." — once per session per `NO_TIMES_NOTICE_BUCKET_MS`. Silence is what
 *    the report "the task finished and nothing told me" came from.
 *  - **A finished task is announced while it is finished.** A span read out of the session
 *    file and older than `COMPLETION_NOTICE_MAX_AGE_MS` is a run this page is catching up
 *    on (a stale reconnect, a session opened in a background tab): that is the notification
 *    people read as "there was no task", so it is dropped.
 *  - **Once per run.** The key is the session and the run's end, so the several
 *    `agent_end` / `agent_settled` / poll paths, a reconnect, and a reload of the same page
 *    announce one task once.
 *  - **One banner, not two.** The tag is the server push payload's tag
 *    (`lib/notification-tags.ts`), so the browser replaces its own banner with the push for
 *    the same completion — and the service worker's 10-second rule can recognise it.
 *
 * The banner is skipped while this window is in the foreground: an answer you are looking
 * at needs no banner. A stopped run announces nothing.
 */

/** A run whose end this page cannot number is announced once per this window. */
export const NO_TIMES_NOTICE_BUCKET_MS = 30_000;

/** The notification's tag: one banner per session, replaced by the next finished task. */
export function completionNoticeTag(sessionId: string | null): string {
  return sessionNotificationTag(sessionId);
}

export interface CompletionNoticeRequest {
  sessionId: string | null;
  sessionName: string | null;
  /** How the run ended, from the chat hook: `aborted` when it was stopped. */
  end: { aborted: boolean; startedAt?: number; endedAt?: number };
}

export interface CompletionNoticeDeps {
  translate: (key: string) => string;
  locale?: string;
  now?: number;
  /** The session file's answer for a run this page did not see begin. */
  fetchLastRun?: (sessionId: string) => Promise<{ startedAt: number; endedAt: number } | null>;
  showPage?: typeof showBrowserNotification;
  /** The document's attention state, for the foreground rule. */
  attentionState?: Pick<Document, "visibilityState" | "hasFocus">;
  /** Settings › General › Local browser notification, this browser's own switch. */
  pageEnabled?: () => boolean;
  /** Runs already announced in this page. */
  notified: Set<string>;
}

export type CompletionNoticeSkip = "aborted" | "stale" | "notified" | "off" | "foreground";

export interface CompletionNoticeOutcome {
  skipped?: CompletionNoticeSkip;
  sent: { page: boolean };
  title?: string;
  body?: string;
  times?: { startedAt: number; endedAt: number };
}

function normalizeTimes(end: CompletionNoticeRequest["end"]): { startedAt: number; endedAt: number } | null {
  const { startedAt, endedAt } = end;
  if (typeof startedAt !== "number" || typeof endedAt !== "number") return null;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return { startedAt, endedAt };
}

/**
 * Announce one finished task in this browser. Silent by design: a completion notice runs
 * after a reply has landed, and nothing about it may throw into the chat's handler.
 */
export async function notifyTaskCompletion(
  request: CompletionNoticeRequest,
  deps: CompletionNoticeDeps,
): Promise<CompletionNoticeOutcome> {
  const { sessionId, sessionName, end } = request;
  const sent = { page: false };
  if (end.aborted) return { skipped: "aborted", sent };

  const now = deps.now ?? Date.now();
  const ownTimes = normalizeTimes(end);
  let times: { startedAt: number; endedAt: number } | undefined = ownTimes ?? undefined;
  if (!times && sessionId && deps.fetchLastRun) {
    try {
      const stored = await deps.fetchLastRun(sessionId);
      const storedTimes = stored
        ? normalizeTimes({ aborted: false, startedAt: stored.startedAt, endedAt: stored.endedAt })
        : undefined;
      if (storedTimes) times = storedTimes;
    } catch {
      // A session file that cannot be read is a task with no numbers, not an error.
    }
  }
  // Numbers read out of the session file are the only ones that can be stale: this page
  // did not watch the run, so an end time minutes old is a run it is catching up on.
  if (times && !ownTimes && now - times.endedAt > COMPLETION_NOTICE_MAX_AGE_MS) {
    return { skipped: "stale", sent, times };
  }

  const key = times
    ? `${sessionId ?? "-"}:${times.endedAt}`
    : `${sessionId ?? "-"}:no-times:${Math.floor(now / NO_TIMES_NOTICE_BUCKET_MS)}`;
  if (deps.notified.has(key)) return { skipped: "notified", sent, times };
  deps.notified.add(key);

  const pageEnabled = deps.pageEnabled ?? (() => true);
  if (!pageEnabled()) return { skipped: "off", sent, times };

  const attentionState = deps.attentionState;
  const foreground = attentionState
    ? !shouldShowBrowserNotification(attentionState)
    : !shouldShowBrowserNotification();
  if (foreground) return { skipped: "foreground", sent, times };

  const title = sessionName?.trim() || deps.translate("i18n.sessionComplete");
  const body = times
    ? formatCompletionSummary(
      deps.translate("safariNotify.summary"),
      { startedAt: times.startedAt, endedAt: times.endedAt, poppedAt: now },
      deps.locale,
    )
    // The page watched this run end and has no numbers for it (a session file with no run
    // in its tail yet, an unreadable file). "Task finished." is the honest short form; the
    // server says the same thing on the phone (lib/web-push.ts completionBody).
    : deps.translate("i18n.taskFinished");

  const showPage = deps.showPage ?? showBrowserNotification;
  try {
    sent.page = (await showPage({
      title,
      body,
      sessionUrl: sessionId ? `/?session=${encodeURIComponent(sessionId)}` : "/",
      tag: completionNoticeTag(sessionId),
      onClick: () => window.focus(),
    })) !== null;
  } catch {
    sent.page = false;
  }

  return { sent, title, body, times };
}

/** The fetch behind `deps.fetchLastRun`. */
export async function fetchLastRunTimes(sessionId: string): Promise<{ startedAt: number; endedAt: number } | null> {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/last-run`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null) as { startedAt?: unknown; endedAt?: unknown } | null;
    if (typeof data?.startedAt !== "number" || typeof data?.endedAt !== "number") return null;
    return { startedAt: data.startedAt, endedAt: data.endedAt };
  } catch {
    return null;
  }
}
