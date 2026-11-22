# Fix the two stubborn notification bugs

Branch: `fix/notification-double-and-missing` (from `pi-desk-main`).

## The two reports

1. A task finishes and there is **no** local browser notification and **no** ntfy push.
2. With nothing running, the mobile Safari web app delivers **a stack of** push
   notifications on the iPhone.

## Root causes found in the code

### Why a finished task can be silent

* `lib/task-completion-notice.ts` is a **page** module, and it is the only sender for
  ntfy (`/api/notifications/ntfy` POST) and for the macOS notification
  (`/api/notifications/local` POST). Both of those are server capabilities that need no
  page. So with the chat page closed, navigated away, discarded by the browser,
  suspended on iOS, or for a run started from a phone over the relay with no page open,
  those two channels announce nothing at all. The server — which owns the run, knows the
  span, and pushes Web Push at that exact moment (`lib/rpc-manager.ts:4045`
  `onAgentRunComplete`) — sends nothing on those channels.
* The in-page banner is gated by `APP_PREF_KEYS.safariNotifyOnComplete` (localStorage,
  default **false**, one per browser). Chrome/Edge with permission granted stay silent
  until the user finds that switch in a browser they opened once.
* A notice needs a span. Without one, the page reads the session file's tail
  (`/api/sessions/[id]/last-run`); a not-yet-flushed new session, a tail wider than the
  2 MB window, or a reload before the file has the run answers `null` →
  `skipped: "no-times"` → silence on **every** channel, ntfy included.
* `COMPLETION_NOTICE_MAX_AGE_MS` (5 min) drops a run the page learned about late —
  correct for a reconnect, and also the reason a long task in a background tab can go
  unannounced.
* In `npm run dev` the service worker is unregistered (`components/PwaRegistration.tsx`),
  so there is no push subscription at all and the banner falls back to the page
  `Notification` constructor (Chrome yes, plain Safari tab no).

### Why the phone buzzes with nothing running

* `lib/web-push.ts:82` `PUSH_OPTIONS = { TTL: 2419200 }` — 4 weeks. RFC 8030: a push
  service stores a message for at least its TTL while the subscriber is unreachable.
  An iPhone that is offline, powered off, or in a Focus mode therefore accumulates every
  finished run of every session for four weeks and receives the whole stack the moment it
  is reachable again. The body's "This notification pops up at hh:mm:ss" is a lie for
  every one of them. This is the "a lot of notifications, no task running" report.
* The page banner's tag is `pi-task-complete:<id>`
  (`lib/task-completion-notice.ts:completionNoticeTag`) while the push payload's tag is
  `pi-session-complete:<id>` (`lib/web-push.ts:sessionPushPayload`). The service worker's
  "a same-tag notification under 10 s old is this same completion, so replace it quietly"
  rule (`public/sw.js:hasRecentNotification`, the #1515 fix) can therefore never match the
  page's banner: one finished task alerts twice.
* The server has no per-run dedupe: the guard is the wrapper's own
  `agentRunNeedsCompletion` flag, cleared when it fires. A wrapper re-created mid-run, a
  session driven from two windows, or a restart that settles a restored run can announce
  the same finished task again.
* An attention push (`kind: "attention"`) is sent for every blocking dialog — MCP and
  project trust dialogs included — with no cooldown, so a phone buzzes "Waiting for you"
  while no task runs.

## The fix

**One rule: the server announces a finished run; the page only decorates the tab.**

1. `lib/task-completion-server.ts` (new): the one place a run's end is announced
   server-side — Web Push, ntfy, and the macOS notification — with
   * per-run dedupe (session + kind + span, bounded LRU on `globalThis`),
   * a stale-run guard (a run that ended more than 5 min ago announces nothing),
   * a stopped run announces nothing,
   * attention pushes deduped per request id and rate limited per session.
   Wired from `lib/rpc-manager.ts` `onAgentRunComplete` / `onAttentionNeeded`, which
   already know the span, the name, and the suppression for subagents and side chats.
2. `lib/task-completion-notice.ts` (page): keeps only the page's own banner, gated by the
   browser's own switch and `Notification` permission, and **announces with the short
   "Task finished." sentence when there is no span** (once per session per 30 s) instead
   of going silent. ntfy and the macOS notification move out of the page.
3. `lib/web-push.ts`: `TTL` 4 weeks → 5 minutes (`PUSH_TTL_SECONDS`), payload carries
   `sentAt`, and the tag comes from `lib/notification-tags.ts`.
4. `public/sw.js`: a push that lands more than 5 minutes after it was sent is a queued
   delivery, so it is shown **collapsed and silent** under one catch-up tag — the burst
   becomes one quiet row, and a notification is still shown (iOS revokes the subscription
   when a push is handled without one, see 3e9fcfa5).
5. `lib/notification-tags.ts` (new, shared): the tag builder the page, the server payload
   and the worker all use, so the #1515 suppression works again and one finished task
   makes one banner.
6. `lib/local-notification.ts` + `app/api/notifications/local`: the macOS notification
   gains a **server-side** switch (it is the server that raises it; a browser pref cannot
   describe it) plus the app locale, so a server-announced notice reads in the user's
   language. Settings › General gets that switch next to the per-browser page switch.
7. `lib/ntfy-publish.ts` (new): the publish call, shared by the route and the server
   announcer.

## Verification

`node --test lib/task-completion-notice.test.mjs lib/web-push.test.mjs
lib/task-completion-server.test.mjs lib/notification-tags.test.mjs public/sw.test.mjs
app/api/notifications/local/route.test.mjs app/api/notifications/ntfy/route.test.mjs
components/SafariNotificationSection.test.mjs components/NtfyNotificationSection.test.mjs
components/fork-extractions.test.mjs` · `tsc --noEmit` · `npm run lint` · full `node --test`.
