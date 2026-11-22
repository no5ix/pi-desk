import { formatCompletionSummary } from "./completion-notification";
import { shouldShowBrowserNotification, showBrowserNotification } from "./browser-notifications";
import { sendNtfyNotification } from "./ntfy-notification";
import { sendSafariNotification, safariNotificationsEnabled } from "./safari-notification";

/**
 * One notice per finished task, on every channel the user switched on.
 *
 * The chat used to ask each channel on its own terms, which produced both of the
 * complaints people notice: a notice that says nothing useful, and no notice at all.
 * So this is the one place a finished task is announced, and it says the same
 * sentence everywhere:
 *
 *   title  the session's name
 *   body   "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47.
 *           This notification pops up at 10:22:47."
 *
 * Three rules keep it honest:
 *
 *  - **A run needs a span.** The page has one only for a run it saw begin; for a
 *    task started from a phone over the relay, a queued prompt, a page reloaded
 *    mid-run, or an extension-triggered run it asks the session file
 *    (`/api/sessions/[id]/last-run`). A run with no span says nothing — "0h0m0s"
 *    is worse than silence.
 *  - **A finished task is announced while it is finished.** A span older than
 *    `COMPLETION_NOTICE_MAX_AGE_MS` is a run that ended while this page was
 *    catching up (a stale reconnect, a session opened in a background tab): that
 *    is the notification people read as "there was no task", so it is dropped.
 *  - **Once per run.** The key is the session and the end time, so the several
 *    `agent_end` / `agent_settled` / poll paths, a reconnect, and a reload of the
 *    same page announce one task once.
 *
 * Channels: the local notification (the Mac's Notification Center through the
 * server, and the page's own notification on Chrome/Edge, which is what makes
 * this browser-neutral rather than Safari-only), and the ntfy push. The page's
 * notification is skipped while this window is in the foreground: an answer
 * you are looking at needs no banner. A stopped run announces nothing.
 */

/** A span older than this is a run this page is catching up on, not one that just finished. */
export const COMPLETION_NOTICE_MAX_AGE_MS = 5 * 60_000;

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
  sendLocal?: (options: { title: string; body: string }) => Promise<boolean>;
  sendNtfy?: (options: { title: string; body: string }) => Promise<{ sent: boolean; error?: string }>;
  showPage?: typeof showBrowserNotification;
  /** The document's attention state, for the foreground rule. */
  attentionState?: Pick<Document, "visibilityState" | "hasFocus">;
  /** Settings › General › Local browser notification. */
  localEnabled?: () => boolean;
  /** Runs already announced in this page. */
  notified: Set<string>;
}

export type CompletionNoticeSkip = "aborted" | "no-times" | "stale" | "notified";

export interface CompletionNoticeOutcome {
  skipped?: CompletionNoticeSkip;
  sent: { local: boolean; ntfy: boolean; page: boolean };
  title?: string;
  body?: string;
  times?: { startedAt: number; endedAt: number };
}

/** The notification's tag: one banner per session, replaced by the next finished task. */
export function completionNoticeTag(sessionId: string | null): string {
  return `pi-task-complete:${sessionId ?? "current"}`;
}

function normalizeTimes(end: CompletionNoticeRequest["end"]): { startedAt: number; endedAt: number } | null {
  const { startedAt, endedAt } = end;
  if (typeof startedAt !== "number" || typeof endedAt !== "number") return null;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
  return { startedAt, endedAt };
}

/**
 * Announce one finished task. Silent by design: a completion notice runs after a
 * reply has landed, and nothing about it may throw into the chat's handler.
 */
export async function notifyTaskCompletion(
  request: CompletionNoticeRequest,
  deps: CompletionNoticeDeps,
): Promise<CompletionNoticeOutcome> {
  const { sessionId, sessionName, end } = request;
  const sent = { local: false, ntfy: false, page: false };
  if (end.aborted) return { skipped: "aborted", sent };

  const now = deps.now ?? Date.now();
  let times = normalizeTimes(end);
  if (!times && sessionId && deps.fetchLastRun) {
    try {
      const stored = await deps.fetchLastRun(sessionId);
      if (stored) times = normalizeTimes({ aborted: false, startedAt: stored.startedAt, endedAt: stored.endedAt });
    } catch {
      // A session file that cannot be read is a task with no numbers, not an error.
    }
  }
  if (!times) return { skipped: "no-times", sent };
  if (now - times.endedAt > COMPLETION_NOTICE_MAX_AGE_MS) return { skipped: "stale", sent, times };

  const key = `${sessionId ?? "-"}:${times.endedAt}`;
  if (deps.notified.has(key)) return { skipped: "notified", sent, times };
  deps.notified.add(key);

  const title = sessionName?.trim() || deps.translate("i18n.sessionComplete");
  const body = formatCompletionSummary(
    deps.translate("safariNotify.summary"),
    { startedAt: times.startedAt, endedAt: times.endedAt, poppedAt: now },
    deps.locale,
  );
  const localEnabled = deps.localEnabled ?? safariNotificationsEnabled;
  const sendLocal = deps.sendLocal ?? sendSafariNotification;
  const sendNtfy = deps.sendNtfy ?? sendNtfyNotification;
  const showPage = deps.showPage ?? showBrowserNotification;

  const foreground = deps.attentionState
    ? !shouldShowBrowserNotification(deps.attentionState)
    : !shouldShowBrowserNotification();

  if (localEnabled()) {
    try {
      sent.local = await sendLocal({ title, body });
    } catch {
      sent.local = false;
    }
    if (!foreground) {
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
    }
  }

  try {
    sent.ntfy = (await sendNtfy({ title, body })).sent;
  } catch {
    sent.ntfy = false;
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
