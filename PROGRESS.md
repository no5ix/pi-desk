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

---

# PROGRESS — a production refresh answered "Pi Web is offline" (`npm start`, web)

## The report

Refreshing the built web app (`npm start`, production) sometimes lands on the "Pi Web is
offline" page that tells the user to reconnect to the local server; the next refresh works.
Only the production build: it is the only context that registers the service worker.

## Root causes, in the order they bite

1. `public/sw.js` answered a navigation with `offline.html` when `fetch` **rejected**
   (a refused connection: the truth) **or** when it passed `NAVIGATION_TIMEOUT_MS` = 8 s
   (a server that is loaded, queued, or starved of a socket: not the truth). The page's
   only advice was "reconnect", and it has no app JS to reconnect with.
2. A browser gets ~6 open connections per host over HTTP/1.1 and this page keeps
   long-lived ones open: the open session's `/api/agent/<id>/events`, the sidebar's
   `/api/agent/running/events`, the scheduled stream, one file watcher per page, a terminal
   panel. A refresh whose document is 7th waits for a free socket, the worker's budget
   expires, and a healthy server is reported offline.
3. `next start` keeps idle sockets for 5 s (`--keepAliveTimeout` default); a browser
   reuses an idle socket past that, so every refresh after a pause rode a half-closed
   socket and was refused, and the worker read the refusal as offline.

## Implemented

* `public/sw.js`: navigation fallback split — refused connection → `offline.html` at once;
  accepted-and-silent → `unavailable.html` after `NAVIGATION_TIMEOUT_MS` (8 s → 15 s).
  Precache covers `offline-recovery.js`; `/api/` and `/sw.js` stay off the cache.
* `public/unavailable.html`: the second page ("still answering" heading, live elapsed
  seconds, the server's address, the connection-budget explanation).
* `public/offline-recovery.js`, shared by both pages: probe `/api/home` every 2 s (2.5 s
  cap, 2× back-off to 30 s), reload when the app answers, `localStorage`
  `pi-web:offline-reload:<origin>` budget of 8 reloads / 10 min, "Try again" clears it, and
  a page that has spent its budget reloads on a real tap.
* `bin/keep-alive.js`: `KEEP_ALIVE_TIMEOUT_MS` (65 000, `PI_WEB_KEEP_ALIVE_TIMEOUT_MS`
  overridable) + `keepAliveStartFlags()`. Used by `package.json`'s `start`/`start:lan`,
  `bin/pi-web.js` (with `--keepAliveTimeout=` passthrough), `scripts/lan-server.mjs`.
* File watchers fan in: `lib/file-watch-stream.ts` (server: one SSE, `GET
  /api/files/<p>?type=watch-all&paths=[{filePath,sessionId}]`, frames `{type:connected,
  paths}` / `change{filePath,sessionId,mtime,size}` / `removed{...}` / `error{message}`;
  every path through `hasReadAccess` + `hasCredentialAccess`, cap 64, one `fs.watch` per
  path, one registry stream per connection, cancel/abort release),
  `lib/file-watch-channel.ts` (client: leader-elected shared stream, debounced reopen,
  per-file dispatch, one leader's frames fan out to every tab), `useFileWatch()` in
  `components/FileViewer.tsx` (all five viewers: image, audio, video, document/PDF, text),
  routed from `app/api/files/[...path]/route.ts`. The old single-file `?type=watch` stays.
* The sidebar's running-sessions stream is shared across tabs
  (`openSharedEventStreamHandle` + `lib/running-sessions-stream.ts`), keeping its
  visibility/online forced reconnect (`reconnect()` is leader-only).
* `lib/scheduled-tasks/shared-stream.ts`: `openSharedEventStreamHandle()` with
  `{stop, reconnect}`, `onError` for the leader, and `onOpen` kept leader-only.

## Failed attempts

* Raising only the timeout: the offline page then sits 15 s on a dead server, which is the
  user's complaint with a longer delay, and it never reconnects by itself.
* Letting the worker cache the last HTML and serve it stale: it shows the app when the
  server is genuinely down, which is the same lie pointed the other way.
* Multiplexing file, terminal and agent streams through `lib/page-stream-registry.ts`:
  a terminal's handlers must run per tab (activity, audio), so its stream cannot be shared;
  the fan-in is per page and the leader election is per browser name.

## Verification

* `node --test public/sw.test.mjs public/offline-recovery.test.mjs` (the pages cannot lose
  the recovery script, auto-reload, tap-to-reload, the budget, or the probe).
* `node --test scripts/prod-server-flags.test.mjs` (every production entry passes
  `--keepAliveTimeout`; the floor is above a browser's idle reuse).
* `node --test lib/file-watch-channel.test.mjs` (7: one stream for every watched file, one
  entry per file, a burst is one reopen, per-file dispatch, the frames drive every viewer,
  a throwing handler does not stop the others, the wire shape).
* `node --test app/api/files/watch-all-route.test.mjs` (7: one stream for many files with
  `countFileWatches()` +1 then 0, a change names the file that moved, one removal,
  abort/cancel release, the roots and the credential store are filtered, the 400/403 input
  rules).
* `node --test lib/scheduled-tasks/shared-stream.test.mjs` (11, incl. leader-only
  `reconnect()`, the follower's takeover, `onError`), `components/SessionSidebar.test.mjs`
  (41), `components/FileViewer.state.test.mjs` + `FileViewer.test.mjs` (16, incl. "no
  viewer opens a file-watch connection of its own").
* `node --test components/web-session-tabs-hydration.test.mjs
  components/PwaRegistration.test.mjs scripts/web-logging.test.mjs
  scripts/web-package-layout.test.mjs scripts/fork-ownership.test.mjs
  components/fork-extractions.test.mjs scripts/release-workflows.test.mjs
  scripts/upstream-css-baseline.test.mjs` pass.
* `node e2e/offline-navigation.mjs` — the report reproduced in a real browser against a
  real `next start`: saturated pool → "not answering" page in 15 s, self-reload; killed
  server → offline page in 11 ms, self-reload on the restart; six refreshes spaced 1.2 s
  apart across the 5 s keep-alive window all load the app; four open file tabs →
  `server.fileWatches === 1` with a change delivered over that one stream; three refreshes
  with the file tabs open load the app.
* `tsc --noEmit` clean; `eslint` clean on the touched files; `PI_WEB_DESKTOP_BUILD=1
  next build --webpack` succeeds.

## Notes for the next step

* `npm run drift` already reported 5 files disagreeing with `scripts/fork-ownership.json`
  before this work (`components/FileExplorer.tsx`, `components/MarkdownBody.tsx`,
  `lib/request-security.ts`, `components/PwaRegistration.tsx`,
  `lib/directory-browser.ts`); the manifest bands for those need a decision of their own.
  `public/sw.js` stays an accepted upstream drift; the new fallback pages, the recovery
  script and the 15 s budget are fork behaviour a future upstream merge must not restore
  to "8 s, one offline page, no self-heal".
* `e2e/project-navigation.mjs`, `e2e/file-panel.mjs`, `e2e/project-sidebar.mjs` and friends
  import `./desktop.mjs`, `e2e/setup.mjs` and `e2e/support/*`, which do not exist in this
  fork: they are dead tests, and `e2e/sidebar.mjs`'s `showSidebarFiles()` targets
  `#session-sidebar-panel-files`, which this fork's sidebar does not render (files live in
  the right panel). `e2e/offline-navigation.mjs` is self-contained on purpose.
* The remaining per-tab connections are the open session's own stream (needed per tab) and
  a terminal panel's (must be per tab). A page that needs more tabs than the pool allows is
  the case an in-app reconnect strip (the `lib/desktop-connection.ts` pattern) would cover.

## The e2e's own trap (found by the verification pass, fixed in the test)

`openFileFromTree` used to gate on a `?type=read` response for every file. A first open of
an image issues `/api/files/<img>?serve` (plus `?meta`); the viewer's `<img>` URL is
byte-identical on a re-open, and Chromium answers that from its renderer's memory cache —
no request leaves, invisible to CDP. Scenario 5 re-opens the same files in the same
document before its reload, so the second pass hung ~30-40% of runs. The route's
`Cache-Control: no-cache` bounds the *server*'s staleness, not the browser's memory. The
helper now waits for the viewer itself: `.file-viewer-path[title="<path>" i]` (the toolbar
of the file just opened; the explorer's rows carry the same `title`, so it is scoped) and
the "Live sync active" badge, which is per-file state that says the shared stream's
`connected` frame reached this viewer.

## The e2e's second trap (panel geometry), and what the DOM says

The file-tab helper then waited on `.file-viewer-path`, which is a real 0×20 box in the
scenario: at a 1280px viewport the right panel is 538px, two under
`FILE_TREE_AUTO_COLLAPSE_WIDTH` (540 = `FILE_TREE_MIN_WIDTH` 220 + 320,
`components/AppShell.tsx`), so opening a file auto-collapses the tree, the test's own
"bring the tree back" click squeezes the viewer to 240px, and
`.file-viewer-path { min-width: 0; flex: 1 1 auto }` (`app/native-theme.css`, imported last,
so it wins over `app/globals.css`'s `min-width: 48px`) collapses a markdown toolbar's path
to zero width — a markdown tab with its Source/Preview switch is 0px, a plain text tab
35px, an image toolbar 29px. The scenario now runs at 1440×900 (above the threshold) and
its two signals are geometry-independent: the tab strip's
`[role=tab][title=<path>][aria-selected=true]` (`components/TabBar.tsx`) and the viewer's
live control — `.file-viewer-live-status` in the image/audio/document toolbar,
`[aria-label="Live sync active"]` (`.file-viewer-live-indicator`) in the text toolbar, so
the locator is their union filtered to `visible=true`, because every open tab stays mounted
with the panel and a hidden tab has the same badge.

## Stability of the e2e after both fixes

`node e2e/offline-navigation.mjs` on the current file: 9 consecutive PASS (11 steps each,
~64 s), including the load-bearing timings — the starved refresh shows the "not answering"
page at 15 s in every run, and the offline page arrives in 10–11 ms with the server killed.
The 0%-pass portfolio reported by one verification run was executed against the
pre-fix version of the test file; its own confirmation run on the fixed file passed.
