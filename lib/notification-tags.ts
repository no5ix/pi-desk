/**
 * The identity of a completion notification, shared by every channel.
 *
 * A finished task is announced by the page's own banner, by the server's Web Push, and
 * (on macOS) by the app that runs Pi. Those are separate senders that cannot see each
 * other, and the only thing they can agree on is the notification's `tag`: the browser
 * replaces a notification that carries the tag of one it already showed, and the service
 * worker reads that tag back to decide whether a push is the completion it already
 * announced (#1515). When the page tagged `pi-task-complete:<id>` and the push tagged
 * `pi-session-complete:<id>`, that rule could never match and one finished task alerted
 * twice — on an iPhone, as two banners.
 *
 * `public/sw.js` is a standalone worker and cannot import this file, so it repeats the
 * same literals. `lib/notification-tags.test.mjs` fails when the two drift apart.
 */

/** Every completion, failure and "waiting for you" notice for one session shares this tag. */
export const SESSION_TAG_PREFIX = "pi-session-complete:";

/** One banner per session, replaced by the next finished task. */
export function sessionNotificationTag(sessionId: string | null | undefined): string {
  return `${SESSION_TAG_PREFIX}${sessionId?.trim() || "current"}`;
}

/**
 * The window in which a notification carrying this session's tag is understood to be
 * *this* completion, so a push that lands right after the page's banner replaces it
 * quietly instead of alerting a second time. An older one belongs to an earlier task, and
 * the push alerts again (#701).
 */
export const RECENT_NOTIFICATION_MS = 10_000;

/**
 * A run this page (or this server) is only catching up on. A span older than this is a
 * run that ended while the announce path was reconnecting, restarting, or simply not
 * running, and the notification people read as "there was no task" is worse than none.
 */
export const COMPLETION_NOTICE_MAX_AGE_MS = 5 * 60_000;

/**
 * How long a push is worth delivering. RFC 8030: a push service stores a message for at
 * least its TTL while the subscriber cannot be reached, and delivers the stored stack
 * when it can again. A finished-task notice older than a few minutes is not news, and the
 * four-week TTL this file used to carry turned a week of offline phone into a week of
 * notifications arriving at once.
 */
export const PUSH_TTL_SECONDS = 5 * 60;

/** Beyond this, a push is a queued delivery, not a finished task: the worker collapses it. */
export const LATE_PUSH_MAX_AGE_MS = 5 * 60_000;

/** The tag late pushes collapse under, so a burst of them is one quiet row. */
export const LATE_PUSH_TAG = "pi-session-catchup";
