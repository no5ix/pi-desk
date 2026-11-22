# PROGRESS — notification reliability (branch `fix/notification-double-and-missing`)

Two reports, both fixed: a finished task that announced nothing on the page's local
notification and on ntfy, and an iPhone that delivered a stack of push notifications for
tasks that had long finished, with nothing running.

## Implemented

* `lib/notification-tags.ts` (new): the tag builder and the shared windows
  (`RECENT_NOTIFICATION_MS`, `COMPLETION_NOTICE_MAX_AGE_MS`, `PUSH_TTL_SECONDS`,
  `LATE_PUSH_MAX_AGE_MS`, `LATE_PUSH_TAG`). The page banner, the push payload and
  `public/sw.js` now use one tag, which is what the #1515 suppression needs; the worker
  cannot import, so `lib/notification-tags.test.mjs` compares its literals.
* `lib/local-notification.ts` (new): the AppleScript raise, the text sanitizing, and the
  installation's `localNotification { enabled, locale }` setting in Pi Web's settings file
  (on by default, macOS only).
* `lib/ntfy-publish.ts` (new): the publish call, shared by `POST /api/notifications/ntfy`
  and the announcer.
* `lib/task-completion-server.ts` (new): `announceRunEnd` / `announceAttention` — the phone
  push, the ntfy message and the Mac's Notification Center row, sent by the process that
  owns the run. One announcement per run (`runAnnounceKey`), a run this process is only
  catching up on is dropped, a stopped run is silent, a span the caller does not have is
  read from the session file, and an "waiting for you" dialog pushes once per dialog and
  at most once per session per 10 minutes.
* `lib/rpc-manager.ts`: `onAgentRunComplete` → `announceRunEnd`, `onAttentionNeeded` →
  `announceAttention` (the listener now carries the dialog's `requestId`).
* `lib/web-push.ts`: TTL 4 weeks → `PUSH_TTL_SECONDS` (5 min) with `urgency: high`, the
  payload carries `sentAt`, the tag comes from the shared builder.
* `public/sw.js`: a push that lands more than `LATE_PUSH_MAX_AGE_MS` after `sentAt` is
  shown silent and collapsed under `pi-session-catchup`, so an offline phone wakes to one
  quiet row. A notification is still shown: iOS revokes a subscription whose push is
  handled without one.
* `lib/task-completion-notice.ts`: the page keeps only its own banner. A run with no
  numbers now says the short "Task finished." (once per session per 30 s) instead of
  nothing; the staleness rule applies only to numbers read out of the session file, so a
  long task watched in a background tab is announced when it lands; `pageEnabled` is this
  browser's switch.
* `components/AppShell.tsx`: passes `pageEnabled: safariNotificationsEnabled`; the client
  no longer publishes ntfy or asks for the macOS row.
* `app/api/notifications/local`: GET reports `enabled`/`locale`, PUT writes the
  installation's switch (this computer only), POST raises through the one sender.
* `hooks/useI18n.tsx`: a language switch tells the server, so the server's sentence is in
  the language the user reads.
* `components/SafariNotificationSection.tsx` + `lib/safari-notification.ts` + i18n
  (en / zh-CN / zh-TW): two switches — this browser's banner (never gated by the server)
  and the notification the app raises with no page open, with its Test button.
* Docs: `docs/agents/fork-files-security.md` (the two paragraphs rewritten), AGENTS.md file
  map, `todo.md` (the two P3 reports removed), `scripts/fork-ownership.json`
  (`public/sw.js` registered, `lib/web-push.ts` drift re-measured).

## Verification

* `npm test` equivalent: 4516 tests, 4514 pass. The single failure
  (`lib/rpc-manager-chat-only.integration.test.mjs` — "Chat only names a model only an
  extension provides (#804)") reproduces on `pi-desk-main` with these changes stashed; it
  is not from this work.
* `tsc --noEmit` clean; `eslint` clean on every touched file (the repo-wide run leaves the
  pre-existing warnings and the `native-theme.css` experiments untouched).
* `next build --webpack` (into `.next-desktop`) succeeds; `next start -p 30142` served the
  new `/sw.js`, answered the notification probes, and raised a macOS notification.
* Live end-to-end, twice (dev on 30141, production start on 30142): a session started over
  the API, a prompt, the run finishing, and the ntfy topic receiving **exactly one**
  message — `The task lasted 0h1m9s, started at 21:48:13, and ended at 21:49:22. This
  notification pops up at 21:49:22.` — plus the macOS row. Before the change the same run
  announced nothing on ntfy and the Mac while no chat page was open.
* `npm run drift`: `public/sw.js` and `lib/web-push.ts` agree with the manifest.

## Notes for the next step

* The page banner cannot be verified headlessly; it needs a real browser with notification
  permission, a backgrounded tab, and the switch on.
* `public/sw.js` is upstream-owned and now registered as drifted; a future upstream merge
  that restores the 4-week TTL or the always-alert push handler re-opens both bugs —
  `lib/notification-tags.test.mjs` and `components/fork-extractions.test.mjs` are the trip
  wires.
