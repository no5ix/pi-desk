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

## Option chords, the phone's keyboard, the installed app's notch (2026-11-23)

Three reports, one branch (`fix/fzf-web-app-keyboard`), three separate causes.

**Option+E wrote `´´´´´` at the prompt; Option+Left wrote `DDDD`; Option+R worked.**
xterm 6's `macOptionIsMeta` is one condition in the `keydown` handler
(`isMac && macOptionIsMeta && altKey`) and its translation reads the legacy
`keyCode`: the printable chords land in the `default:` arm (`keyCode` 82 is `R`,
so `^[r`), a chord whose `key` is the layout's accent (`Dead` on a Portuguese
layout) reaches no case, and an arrow is answered by its own case *above* the Alt
branch, so it leaves as the modified CSI `ESC [ 1 ; 3 D`. The fix is
`macOptionSequence()` (`lib/terminal-input.ts`): rebuild only what xterm cannot
produce, from `key` and the physical `code` — letters under the finger, arrows as
Terminal.app's word jumps `ESC b/f/p/n`, `Backspace` as `ESC DEL` — and consume
it in `attachCustomKeyEventHandler` only for a keydown inside the panel, with
`preventDefault()` so the browser stops composing the accent behind the panel.
`keyCode` is not read (Chromium reports 0 for it under Playwright's keyboard
layer); a one-character chord is left to xterm so nothing is sent twice.

**A tap on the phone's terminal put a cursor on screen and no keyboard.** xterm
focuses on `mousedown`, which iOS synthesizes after the tap, and the field it
focuses (`.xterm-helper-textarea`, `tabIndex = 0`, `readOnly` mirrors
`disableStdin`) is `opacity: 0` with zero width. The panel focuses from
`pointerdown` / `touchend` in the capture phase (xterm's `mousedown` is
`preventDefault`-ed, and the key listeners sit on the textarea in capture, so a
chord typed into another field never reaches the panel's handler) and
`app/native-theme.css` gives that field `opacity: 0.01` and `font-size: 16px` —
16px is the composer's own floor, under which Safari zooms the page on focus. The
CSS deliberately sets no geometry: xterm's `_syncTextArea` writes `left`, `top`,
`width`, `height` and `line-height` inline to sit on the cursor (upstream #1182,
IME anchoring), and a CSS width of `1px` was measured at 5.39px, one cell.

**The home-screen app sat under the notch; mobile Safari looked right.** In a tab
the shell's inline `env(safe-area-inset-*)` padding is the whole story. Installed,
WebKit draws the status bar over the page, reports the top inset as 0, and the
fork's `.app-topbar { height: 48px !important }` beat AppShell's inline
`calc(36px + env(safe-area-inset-top))` (`components/AppShell.tsx`), leaving one
48px row at the window's top edge; the fixed `.right-panel-toggle-button`
(`top: 10px`) and the `.app-notice-shelf` (`top: calc(60px + env(...))`) sit in the
same strip. `hooks/useStandaloneSafeArea.ts` marks `<html data-standalone-safe-area>`
for a standalone display on a machine with `maxTouchPoints > 0` — a floor is
needed (59px, the one `app/settings.css` already uses for the settings dialog) and
it must not reach the Tauri window, where 0 is honest. The rules pad boxes, not
heights (box-sizing is border-box app-wide, so padding alone spends the bar's
48px), and cover the two fixed overlays a phone's shell cannot pad, top and
bottom (both are `top: 0; bottom: 0` at `height: var(--app-viewport-height,
100dvh)`, so the sidebar's settings row and the panel's body sit on the home
indicator). Every `env()` is 0 without `viewport-fit=cover`, so the installed
app's viewport source needs it: the page's meta tag has it (`layout.tsx`'s
`viewportFit`), Safari reads only that — no Safari version supports the
manifest's `viewport` member — and `/manifest.webmanifest` now says the same for
a Chromium 124+ install, which does read the manifest member. My first pass
documented the reverse (that iOS reads the manifest); the MDN compatibility
table says it does not, and the iOS path is the meta tag.

## Verification of that branch

`npm test` 4566 tests / 0 failures; `npm run lint` clean; `tsc --noEmit` clean.
A live pass against the dev server (`next dev` on 30141) with Playwright:
`cat -v` on a real PTY shows `^[e ^[r` for the printable chords, `^[b ^[f` for
Option+arrows, `^[c` for a synthesized WebKit dead-key chord
(`key: "Dead"`, `code: "KeyC"`), each arriving exactly once; a tap on a touch
viewport leaves the caret in `.xterm-helper-textarea` (5.39×16px, opacity 0.01,
font 16px) and text typed after the tap reaches the PTY; fullscreen — Chromium
cannot emulate `display-mode: standalone`, and fullscreen is one of the modes the
hook matches — marks the shell and moves the topbar to 107px with its title at
75px and the panel toggle at 69px, where a browser tab keeps 48px and no mark.

`e2e/terminal.mjs` carries these checks (macOS-gated, skipped elsewhere, as the
existing `^[e` / `^[r` assertion is). Its own session-terminal section is broken
on this fork before this change and is recorded in `BLOCKERS.md`.

Not verified on real hardware: an iPhone's Safari keyboard and a home-screen
install. Both fixes rest on the same source-verified behavior (WebKit's touch
focus rule, the 0 inset + 48px bar in an installed app) and on the emulation
above, not on a device.

## The panel's default tab, a phone's terminal keyboard, the running clock

Branch `fix/keyboard-msg-time-subagent` (from `pi-desk-main`), commit `1168a6ff`.

- **The right panel opens on a shell, not the file list.** `handleRightPanelToggle`
  activates a live terminal tab, or calls `handleOpenTerminal(visibleProjectCwd)` when
  the project has none; the tree is behind its own header button and stays the fallback
  only where no shell exists (a chat, whose `visibleProjectCwd` is null). The toggle is
  declared after `handleOpenTerminal` — a `useCallback` dependency array is read during
  render, so declaring it first reads an uninitialized `const`.
- **A phone's terminal keyboard.** WebKit opens the keyboard when focus *arrives* at an
  editable field during the touch. The panel focuses xterm's helper field when the PTY
  connects, so every tap found it already focused: no focus event, no keyboard, however
  many taps — while a tap after *Restart terminal* worked, because a restart builds a
  fresh, unfocused field. `TerminalPanel.tsx` now blurs a focused field before focusing
  it, clears `disableStdin` on the first SSE message (a `readOnly` field never raises a
  keyboard; EventSource's `open` is not guaranteed on WebKit), and publishes its field to
  `lib/terminal-focus.ts`, a module registry, because the panel is `dynamic()`-loaded and
  `AppShell` owns the panel toggle and the Explorer's terminal action. A terminal created
  by the same tap that opens the panel has no field during the gesture, so its keyboard
  arrives with the next tap.
- **The header's `[folder] project  [branch] branch  [clock] 1h50m`.** `ChatWindow`
  reports the last prompt (`onLastPromptChange`), `AppShell` holds it, `TopbarElapsed`
  ticks it — a per-second render inside `AppShell` would re-render the shell, the sidebar
  and the chat every second. A *user* entry carries no timestamp in a session file, so the
  clock starts at the first time the transcript records for that prompt, and a context
  that opens after a compaction (no prompt inside) counts from its first recorded time.
  The row is visible on a phone, where the header is the only place project, branch and
  elapsed time appear; the project label keeps `min-width` so the long branch name is what
  ellipsizes.
- **A turn's length beside Copy.** It was gated by `showTimestamp`, so it appeared on a
  third of finished turns, and `getTurnDurationMs` read the anchor's own timestamp — which
  a user entry never has — so on real data the footer was empty for every turn. The length
  now starts at the first time recorded inside the turn (bounded by the turn's end), shows
  on every finished turn in the compact `1h50m` shape with a clock glyph, and treats a
  background subagent's report as the task working, not an idle wait. Every reply's model
  line carries its own time.
- **A subagent report opens collapsed**, like the compaction note, its header the toggle
  (`aria-expanded`, the same chevron), with no Copy row while folded.

## Verification of that branch

`npm test` 4584 tests / 0 failures / 1 skipped; `npm run lint` 0 errors (7 pre-existing
warnings in files this branch did not touch); `tsc --noEmit` clean. Live passes against the
running server on 30141 with Playwright: desktop 1280px and phone 390/320px render the row
as `pi-desk · fix/keyboard-msg-time-subagent · 1h11m` under the session title (chip
`tabular-nums`, one clock glyph, no overflow; the clock read 14m21s → 14m24s → 14m26s across
loads, so it ticks); the footer shows `1h11m` with the tooltip `The task lasted 1h11m11s`;
model lines read `…IQ3_S(Splash) 04:00 PM`; the four subagent report cards in a real session
start at 34px with one button and expand to 2006px with seven on a header click; opening the
panel from closed yields one terminal tab (`terminalWidth` 538, `treeWidth` 0,
`terminal-status-dot is-ready`). On a 390×844 touch context: the panel opens on a ready
terminal, the helper field is editable (5×16px, opacity 0.01, font 16px), a tap while it is
*already* the active element produced **2** focus events (the blur-then-focus, i.e. the
keyboard's precondition), and `printf OK-$((40+2))` typed after the tap printed `OK-42` on
the PTY.

Not verified on real hardware: an iPhone's Safari keyboard. The fix rests on WebKit's touch
focus rule, the emulation above (a tap that moves focus, on a rendered 16px editable field),
and the user's own report that the tap worked after a restart — the fresh-field case that
this branch turns into the normal case.

# The second pass on the same seven (seconds, silence at the right moments, no 10-image wall)

Recorded 2026-11-23 on `fix/keyboard-msg-time-subagent`, after the user's screenshots.

## What changed and why
- **Header clock**: the running count now shows its seconds and its days
  (`1h50m32s`, `12d0h54m32s`) — `formatTurnDurationCompact(ms, { withSeconds: true })`.
  A label that changes once a minute reads as frozen. The assistant footer keeps the
  short `1h50m`. New test: "a clock that counts shows its seconds and its days".
- **The clock is gone when the task ends**: `AppShell` renders `TopbarElapsed` only while
  the selected session is in `runningSessionIds`. The user's pic5/pic6 were a finished main
  session and a finished subagent session whose clocks kept ticking. A count that outlives
  its run is a reading of the wall, not a clock.
- **A failed run notifies nothing** (`announceRunEnd` → `skipped: "failed"`): the sentence
  the phone, the topic and Notification Center would carry is the provider's own failure
  text. The user's pic3 ("Run failed / synthetic API error (400): Offline interception,
  type fixture") is exactly that, and much of it came from *tests* running real sessions in
  this checkout. The failure stays in the chat and in the session file; the failed payload
  builder in `lib/web-push.ts` stays for scheduled runs, which report their own failures.
- **A subagent ending notifies nothing**: the report's delivery marks the parent
  (`lib/subagent-report-runs.ts`), `lib/rpc-manager.ts` consumes the mark at the run's end,
  and the page reaches the same conclusion from its transcript
  (`finishedRunFacts` in `lib/finished-run-facts.ts`, carried on `AgentEndInfo`). One mark
  per run, so the run of a prompt the user typed is announced as usual.
- **No 10-image wall**: `MAX_ATTACHED_IMAGES` is 1000. The composer, the draft store and the
  read-images route read the one constant; each image keeps its 10MB cap. The number stays
  finite because the desktop picker's count and the route's payload guard derive from it.
- **`git status` vs the Edited files card (pic1/pic4): no fix, as agreed.** The card lists
  the files *one turn's* `write`/`edit`/`apply_patch` tool calls touched
  (`lib/turn-written-files.ts`). Files the agent changed through the shell — heredocs,
  scripts, `git mv` — are recorded as bash calls, not as file edits, so they cannot appear.
  In the recorded turn that is all the session file holds: 8 file-edit records out of the
  24 files that commit moved.

## The lesson about stubs (the suite taught this, twice)
`lib/rpc-manager*.test.mjs` and `lib/chat-protected-sends.test.mjs` stub `./subagent-runtime`
when they load the manager. A helper added to that module and called from the manager is
`undefined` under those stubs: the listener throws into its own `try`, the announcement
never happens, and 12 integration tests fail while passing standalone. Small helpers the
manager calls live in their **own** module (`lib/subagent-report-runs.ts`), which nobody
stubs. The registry module is where the marks live; `lib/subagent-runtime.ts` imports it.

## Verified
- `npm test`: 4591 pass, 0 fail, 1 skipped.
- `tsc --noEmit` clean; `eslint` 0 errors (7 pre-existing warnings in files this pass did not touch).
- `node --experimental-strip-types --test e2e/terminal.mjs`: PASS (168s).
- `npm run test:e2e` (production build in `.next-desktop`, `E2E_SERVER_MODE=start`): 39
  files PASS. The one failure is the recorded pre-existing `e2e/terminal.mjs:338`
  ("The terminal area is not visible") in the start-mode chain, where the dev server holds
  `.next/dev/lock` — see the note above.
- Build note for this shell: `next build` needs `TURBOPACK`, `NODE_ENV`,
  `__NEXT_PRIVATE_ORIGIN` and `__NEXT_PRIVATE_STANDALONE_CONFIG` unset
  (`Multiple bundler flags set: TURBOPACK=1, --webpack`).

# Settings › General: one local notification (branch `fix/keyboard-msg-time-subagent`)

From a screenshot of the section: the title said "Local browser notification", two switches
offered two notifications for one finished task, and the **Test** button had no border. The
ask was to rename the title, delete the browser row, keep the computer row, move its
description under the title, and give the button a border. "Remove it completely" is taken
literally: the browser half is deleted, not hidden — a row the user cannot switch off would
keep sending the duplicate notice.

## What changed and why
* `components/SafariNotificationSection.tsx`: heading → `safariNotify.description` (the
  sentence the server row used to carry) → one row in the grey card, exactly the ntfy
  section's shape. The Test button is `variant="secondary"`, which is the shared
  `.config-button-secondary` (1 px `--border`); the ntfy section's ghost buttons sit in their
  own action row, where a borderless label reads fine, and this one did not.
* `lib/task-completion-notice.ts` + its test, **deleted**: the page's own banner.
  `components/AppShell.tsx`'s `handleAgentEnd` now only refreshes, and the
  `pi-web:safari-notify-on-complete` localStorage key is gone from `lib/app-prefs.ts` and
  `lib/safari-notification.ts` (with `safariNotificationsEnabled`,
  `setSafariNotificationsEnabled` and `getSafariNotificationSupport`).
* `components/ChatWindow.tsx`: `finishedRunFacts(messagesRef.current)` had exactly one
  reader — the page banner — so the merge and the write-only `messagesRef` are gone, and
  `lib/finished-run-facts.ts` (+ test) with them. `AgentEndInfo` keeps its span and
  `aborted` (the completion sound reads `aborted`); the two page-only fields went with it.
* i18n (`lib/i18n/locale-plugins.ts`, all three locales): `safariNotify.title` →
  "Local notification" / 本地通知 / 本地通知; `serverSwitch` → `switch`, `serverHint` →
  `description`; `body`/`hint` deleted; `unsupported`/`remote`/`testSent`/`testFailed`
  reworded, since they used to promise a page notification that no longer exists.
* Docs: `docs/agents/settings-ui.md`, `docs/agents/fork-files-security.md` (the announcer is
  now the only sender), `docs/agents/subagents.md`, `AGENTS.md`'s file map.

## What deliberately stayed
* `GET /api/sessions/[id]/last-run` and `lib/session-last-run.ts`: the server's announcer
  reads the span there; the HTTP route's only page caller was the deleted banner, and a
  read-only documented endpoint is not notification plumbing.
* `lib/browser-notifications.ts` and the notification permission: the extension UI's
  "needs you" notice and scheduled runs use them. The new test asserts the sender is still
  mounted, so removing the completion banner cannot orphan the permission.
* The file name and the `safariNotify.*` key prefix: renaming them touches the route's
  naming and three locales for no user-visible gain; the wording says computer, never Safari.

## Verified
- The full suite: 4574 pass, 0 fail, 0 cancelled (the deleted modules' 17 tests went with them).
- `tsc --noEmit` clean; `eslint` 0 errors, 5 pre-existing warnings in files untouched.
- Real browser at `127.0.0.1:30141`, Settings › General, desktop 1240 px and phone 390 px,
  dark and light: heading "Local notification", the description under it, one row,
  one switch, `Test` computed border `1px solid` in both themes; the two notification
  sections read alike in the same column.

# The notification format, and the ntfy buttons (branch `fix/keyboard-msg-time-subagent`)

Screenshots: the ntfy row's **Save** / **Send Test Notice** were two ghost labels; the ntfy
topic and Notification Center had rows titled "Session complete" with the body "Task
finished.", and rows titled "Session complete" carrying the real sentence. The agreed format
is fixed: **title = the session's name**, **content = "The task lasted `*h*m*s`, started at
hh:mm:ss, and ended at hh:mm:ss. This notification pops up at hh:mm:ss."** — and a run that
cannot be said that way is never sent.

## What changed and why
* `lib/web-push.ts`: `completionAnnouncement(sessionName, event)` is the one judge — the
  trimmed name and a real span, or `null`. `sessionPushPayload` keeps the name whenever the
  session has one (it lost it once, and two tests caught it) and keeps the plain fallback
  texts so the builder never throws.
* `lib/task-completion-server.ts`: `announceRunEnd` asks the judge after the span lookup and
  returns `skipped: "unnamed"` / `"no-span"` before the ledger claim, so the phone push, the
  ntfy message and the Mac's row all go silent together — and a run that gets its name a
  moment later is announced by the path that finds it (the skip spends no key). "a run with
  no span still speaks" is dead: the short "Task finished." is exactly the format the user
  refused.
* `notifySessionComplete` is **deleted** (interface, notifier, wrapper): the only API that
  could build a completion payload with no name and no span, i.e. the format the user asked
  never to see. `notifySessionEvent` is the sender, and the announcer is the only caller.
* `components/NtfyNotificationSection.tsx`: **Save** is `variant="primary"` and **Send Test
  Notice** is `variant="secondary"`, the pair `components/NetworkProxySection.tsx` uses
  (pic2). Ghost labels read as text.
* Docs: `docs/agents/fork-files-security.md` (the format is a rule, not a fallback),
  `docs/agents/client-platform.md` (the #1515 paragraph and the two "Task finished push"
  lines still described the page notification deleted in the last commit),
  `docs/agents/settings-ui.md` (the button pair).

## Verified
- `lib/web-push.test.mjs` + `lib/task-completion-server.test.mjs`: the format judge, the
  three channels saying the same sentence with the session's name as title, and the silence
  of `unnamed` / `no-span` (no channel gets the old text).
- Real Chromium at 1240 px, dark and light: `Save` computed `236,236,236` fill + dark bold
  label, `Send Test Notice` transparent with `1px` border — the Network proxy pair.
- `tsc --noEmit` clean; `eslint` 0 errors (5 pre-existing warnings in untouched files).

---

# Fix: a finished run announced nothing, and the phone's switch was dead (2026-02-02)

## The reports
* *"I ran a task and got no local notification and no ntfy notification"* (pic1: a 15 s run
  in a **brand new** session, answered normally in the chat).
* *"On the iPhone, added to the Home Screen, `Notify this device` is grey with 'This browser
  can't receive notifications. On iPhone, add Pi to the Home Screen…' — I should be able to
  turn it on"* (pic2, phone pointed at `npm run dev` over Tailscale Serve).

## Cause 1 — the announcement demanded a name that a fresh session cannot have
`lib/task-completion-server.ts` takes the title from `lib/rpc-manager.ts`'s
`sessionManager.getSessionName()`, which is **null for the first run of a new session**
(auto-naming answers after the turn, and the switch can be off entirely). The format judge of
the last commit then returned `skipped: "unnamed"`, and all three channels — phone push, ntfy,
Notification Center — went silent together. The rule was right ("Session complete" is the wrong
format); the name lookup was too narrow.

* `lib/session-prompt-title.ts` (new): the title the **sidebar** gives a row with no name — the
  session's first prompt, one line, capped at the same 80 characters a generated name gets
  (`MAX_TITLE_LENGTH` in `lib/session-title.ts`). A head read of 256 KB, never throws.
* `lib/task-completion-server.ts`: the env gained `sessionTitle(sessionId)`, asked **only** when
  the live name is missing (a named session never touches its file). Order: live name → first
  prompt → `skipped: "unnamed"`. A read that throws is swallowed into silence, never into a
  fallback title.
* Near-miss worth remembering: this module nearly shipped **as** `lib/session-title.ts`, which is
  auto-naming (asks a model for a summary; `app/api/sessions/[id]/auto-name`, `lib/rpc-manager.ts`
  import it). `tsc` caught the overwrite; the file and its test were restored from HEAD.

## Cause 2 — development had no service worker, and push needs one
`components/PwaRegistration.tsx` **unregistered** every worker outside production, so
`lib/push-client.ts:getPushDeviceState()` found no registration and reported `unsupported`,
which is the grey switch. An iPhone can only subscribe through a registration in the installed
web app, so a phone on `npm run dev` never had a way to turn notifications on — and `npm run dev`
over Tailscale is how the phone path gets exercised at all.

* Development registers the same worker as **`?v=dev`**, and `public/sw.js` reads that query as
  `OFFLINE_MODE = CACHE_VERSION !== "dev"`:
  - dev `install` precaches nothing (only `skipWaiting`),
  - dev `activate` deletes every `pi-web-*` cache a production run left on the origin (a worker
    is scoped to the origin and outlives the server that installed it — that was the reason for
    the old `forgetWorkers()`), and claims clients,
  - dev `fetch` returns immediately: every request goes to the dev server, so the page runs the
    code on disk and no unhashed chunk URL is ever cache-first.
* The desktop shell keeps `forgetWorkers()`; a plain iOS Safari tab (not installed) still reports
  the hint, which is true: iOS exposes push to installed web apps, not to the browser.

## Verified
- `lib/session-prompt-title.test.mjs` (new), `lib/task-completion-server.test.mjs` (the first
  prompt titles a nameless session; the live name wins and the file is not read; a throwing read
  is silence), `components/NtfyNotificationSection.test.mjs` (the announcer's title line).
- `public/sw.test.mjs`: a **second instance** of the worker loaded from a temp copy with
  `?v=dev` (Node caches a module by its resolved file, so the script is copied): no precache, no
  answered request, `pi-web-*` caches deleted, and a push still shows a notification.
  `components/PwaRegistration.test.mjs` pins the dev registration and the removal of the
  dev-side unregister.
- Full suite `4584` tests: 0 failures in the code (one `lib/relay/connector.test.mjs` timing test
  flaked under `--test-concurrency=4` and passes alone). `tsc --noEmit` clean. `eslint` 0 errors,
  5 pre-existing warnings (the ntfy `test` callback's missing `t` dependency, added by this
  branch, is fixed).
- Deploy note for the user: restart the dev server (the worker script changes), reload the
  Home Screen app, then turn "Notify this device" on; iOS asks for permission on the tap.

# iPhone: the terminal's keyboard never opened, however many taps (iOS Safari)

## Report
- 手机 Safari：打开 workspace 终端后面板里没有光标，点终端区域多次也不弹出系统键盘；
  点 “Restart terminal” 之后，第一次点终端就弹键盘。（“the on-screen keyboard does not
  pop out … clicking the terminal input repeatedly … after clicking the Restart terminal
  button, tapping the terminal input field now makes the keyboard pop out”）

## Cause
iOS opens a software keyboard only for a focus that **moves** to an **editable, rendered**
field during a user gesture, and opens nothing for the field that is already the active
element. The panel focused xterm's helper textarea on `events.onopen` and again when the
tab became active, so every tap in the panel found it focused: no focus event, no keyboard.
`Restart terminal` builds a fresh `Terminal` whose field nobody has focused, so the next
tap moved the focus and the keyboard appeared — the user's own diagnosis.

The first fix for this bug (the previous commit on the branch) blurred the field and
focused it **inside one gesture**; on the user's iPhone that reads as no net change, so
the report stayed exactly as it was.

## Changes
- `lib/terminal-focus.ts`: `isTouchFocusDevice()` (`(pointer: coarse)`).
  `focusTerminalInputFromTouch()` — the panel-toggle/Explorer path, one gesture that
  cannot be split — declines on a touch device: a focus it leaves behind is the state the
  following taps inherit, and the field is usually still read-only as the shell connects.
  The registry still serves pointers, blurs a focused field first, and refuses
  `readOnly`/detached fields.
- `components/TerminalPanel.tsx`:
  - connect (`events.onopen`) and tab activation focus the field **only on a mouse**
    (`!isTouchFocusDevice()`);
  - a tap is split across the gesture: `pointerdown`/`touchstart` → `releaseOnTouch`
    (blur when the field is the active element), `touchend`/`pointerup` → `raiseOnTouch`
    (focus). Capture phase, named listeners (the cleanup removes them), `pointerup` stands
    down when `touchend` focused, and a mouse pointerType does none of it.
- `components/TerminalComposer.tsx` (new): the path that depends on no focus rule. On
  `(pointer: coarse)` the panel shows a real `<input>` + Send in grid row 5, under the
  extra-keys strip. Never `readOnly` (not while the shell connects), `enterKeyHint="send"`,
  16px, `useId()`-bound label, Send prevents `pointerdown`/`mousedown` so the keyboard
  stays between commands, and a send into a shell that is not there is refused
  (`connectedRef`) so the row keeps the typed command. Panel CSS in `app/native-theme.css`
  (`.terminal-composer`, safe-area/keyboard rules like the extra keys); i18n keys
  `terminal.commandLabel` / `.commandPlaceholder` / `.commandSend`.
- Docs: `docs/terminal.md` (the three contracts + verification), `AGENTS.md` (the
  `terminal-focus.ts` line).
- Tests: `lib/terminal-focus.test.mjs` (the touch decline), `components/TerminalPanel.options.test.mjs`
  (the split handlers, mouse-only focus, composer wiring, the row's CSS),
  `components/TerminalComposer.test.mjs` (new), `e2e/terminal.mjs` (the touch pass:
  connect leaves the field unfocused; a tap focuses a 16px editable rendered field with a
  `focus` event; a **second** tap yields `blur` → `focus`; the command line takes the tap,
  reaches the shell, keeps the focus after Send).

## Verified
- Live Chromium, touch machine (`hasTouch`, 390×844), against the running dev server:
  after connect the active element is a button, not the xterm field; the first tap on the
  screen → activeElement `textarea.xterm-helper-textarea`, box 5×16, opacity 0.01, 16px,
  editable, events `["focus"]`; the **second** tap → events `["blur","focus"]`, same field.
  The command line: tap → `input` 316×34, opacity 1, 16px, editable; `echo
  KEYBOARD_CHECK_$((40+2))` and `printf 'A%sB\n' -z` reached the shell (the rows show
  `KEYBOARD_CHECK_42`, `A-zB`); after Send the focus is still the input. No page errors.
  Screenshots `/tmp/terminal-phone.png`, `/tmp/terminal-phone-keys.png` (light and dark,
  extra-keys row plus the command line).
- Not run: `npm run test:terminal` itself — it refuses a checkout whose `.next/dev/lock` is
  held by the user's dev server. Its assertions are the ones verified live above.
