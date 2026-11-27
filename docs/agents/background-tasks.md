# Background Tasks — the header's task monitor

A chip in the title row, right behind the subagent counts, opens one card under itself: this
conversation's background tasks, read from the `pi-background-tasks` extension. The extension is
the only task registry. Nothing in pi-desk keeps a task list, starts a task, kills a process or
decides what "finished" means; the panel reads, watches, and asks. A second registry is the
failure mode this whole design exists to avoid: a task in the panel that the conversation cannot
see, and a task in the conversation the panel cannot stop.

## The contract it reads

The extension publishes a host interface on the session's `EventBus`
(`node_modules/pi-background-tasks/docs/api/eventbus-host-v1.md`):

- `pi-background-tasks:host:request:v1` — `{schema_version, request_id, operation, payload}`.
- `pi-background-tasks:host:response:v1` — the same `request_id`, `ok`, and `result` **or** `error {code, message}`.
- `pi-background-tasks:host:changed:v1` — `{kind: "ready" | "changed" | "closed", activationId, sessionId, revision, observedAt, counts}`.

`lib/background-tasks/protocol.ts` is the typed copy of that contract, with the parsers that
accept a shape or answer `null`. It is the only place the channel names, the schema strings, the
operation names and the documented error codes are written.

Rules the interface imposes, all of them pinned in `lib/background-tasks/host-client.test.mjs`:

- **Leases.** Leased operations need a `leaseId` from `subscribe`, and `subscribe` answers
  `UNAVAILABLE` until the extension has a session context (its `ready` frame). The panel's
  availability probe is `capabilities`, which needs no lease.
- **Sequences.** Per lease, strictly increasing, never reused: a reused sequence is
  `CONFLICT`, a lower one `STALE_REQUEST`. One in-flight lease request at a time.
- **Retries.** `LEASE_INVALID` / `ACTIVATION_MISMATCH` / `STALE_REQUEST` / `CLOSED` are
  retryable: the client drops the lease, re-subscribes, and sends a **new** request id with a
  fresh sequence. It never replays the old one — a stop that already ran must not run twice.
- **`closed` is not "old news".** A change frame is de-duplicated by
  `(activationId, revision, kind)`. The `closed` frame rides the activation's last revision, so
  de-duplicating on `(activationId, revision)` alone swallows it and leaves the panel leasing an
  activation that no longer exists. After it, the client answers `CLOSED` until a fresh `ready`.
- **`stop_all` takes a frozen selection of 1…1000 ids.** An empty selection is
  `INVALID_REQUEST`, so the panel offers "Stop all" only when something runs and
  `lib/background-tasks/service.ts` refuses an empty one before the extension is asked.
- **`mark_seen` never acknowledges a running task** (`not_terminal`), and the seen set is the
  one the extension's TUI dock and `/bg-clear` share. Listing tasks acknowledges nothing.
- **`rerun` is a new task** with the source's exact command; the old id is never reused.
- **`detail` nests**: `{task: {task, kind, seen, canRerun, canReadResult, truncatedFields}}`.
- **`logs` is a byte window** of the task's output file, tail by default, capped at 65536 bytes
  (asking for more is answered `TOO_LARGE`, so the client clamps its own request).

## Which copy loads (`lib/background-tasks/extension.ts`)

A conversation gets exactly one `pi-background-tasks` activation, and it is picked per **working
directory**, in this order:

1. the plugin the user installed for pi — a non-filtered entry in the settings' `packages` whose
   source names the package (`npm:pi-background-tasks`, a git source), resolved through
   `DefaultPackageManager.listConfiguredPackages()`. Global (`user`) installs land under
   `~/.pi/agent/npm/node_modules/<pkg>`; that is the copy Settings › Plugins shows as Loaded, the
   one `/bg` runs, and the one the panel must talk to. A project-scoped install counts only in a
   trusted project — it is project code.
2. the copy this checkout ships as a dependency (`node_modules/pi-background-tasks`), so a plain
   `npm run dev` from the app's own directory works with nothing configured in pi.

The extension file is the manifest's `background-tasks` resource — by resource name, else by the
file's own name — never "the first extension the package lists": a package with several resources
and no such name is not loaded under a guess. A settings entry with resource filters, or switched
off in Settings, is skipped: that is the user's own decision about this package's resources. The
answer is cached per cwd for 30 seconds (`invalidateBackgroundTasksEntryCache()` drops it) so a
plugin installed while the app runs is picked up, and a removed one is noticed.

**Resolution order is the load-bearing part.** The app runs from any checkout: a linked worktree
ships no dependency of its own, and looking only at `node_modules` under `process.cwd()` made the
panel answer *"pi-background-tasks is not installed"* and left the session with no extension (so
`/bg` had no slash commands) while the Plugins page showed the package Loaded, globally. The
`not-installed` state now means what it says: no copy of the extension exists for this
conversation's directory, with the plugin install as the named remedy.

## Where the bridge lives (`lib/rpc-manager.ts`)

`lib/background-tasks/extension.ts` resolves the entrypoint as above and hands it to the session
as `additionalExtensionPaths`, together with an `extensionsOverride` that keeps **one**
activation. Two activations mean two registries and a panel that leases one of them: a task
started in the conversation would not appear, and a task in the panel would not be stoppable.
The user's own copy wins the dedupe — anything under `~/.pi/agent` (the plugin layout) or under
pi's package dir counts as the user's — because that is the copy `/bg`, `/tasks` and the
extension's update notice talk about.

`lib/background-tasks/bridges.ts` keeps one `BackgroundTaskHostClient` per live conversation,
keyed by session id and grouped by `cwd`. `lib/rpc-manager.ts` attaches it when the wrapper is
created and releases it in `destroy()`/`shutdown()` — a bridge outliving its session is a client
with two listeners on a bus whose extension is gone. The bridge is created on the **same
`EventBus` instance** the session's extensions were handed, before the session binds, which is
why the activation's `ready` frame is heard and not missed.

`lib/background-tasks/service.ts` reads **one conversation's registry**: the card shows the tasks
of the conversation the user is looking at, and its actions go to that conversation's activation
only. A task id belonging to a sibling conversation is answered with the extension's own
`NOT_FOUND` — that is the true news, and truer than a pi-desk index of task ids (a second
registry) or a probe of the project's other conversations, whose tasks the card does not show. An
activation that does not answer is reported in `sessions[].state` and contributes no tasks and no
counts — a partial answer is not "nothing is running".

`stop_all` acts on the frozen selection it is handed. The card hands it the running ids it is
showing; the composer's stop control has a count and no list, so it sends `allRunning: true` and
the service reads this conversation's registry once, freezes the running set at that instant, and
stops that. An empty selection never reaches the extension (`INVALID_REQUEST`).

`errorOf` reads the code off the error instead of using `instanceof`: Next can instantiate the
host client's module twice in the server, and a `NOT_FOUND` from the other copy would come back
as our `OPERATION_FAILED` — the panel would lie about who refused.

## The chip and the card

`components/TopbarBackgroundTasksButton.tsx` is the chip in the title row, under the session
title, behind the subagent counts. It wears that row's own pill class (`.app-topbar-subagents`,
the class the counts wear), so it is one control of the same shape and size as its neighbours,
and the card it opens hangs under it for the same reason the Agents card hangs under the counts.
Its head glyph breathes green while a task runs, turns warning when the newest news is a task that
failed and is unread, and lies dim when nothing runs. **The plate is the card's, not the state's:**
the chip fills itself (`.is-open`) only while its card is up, like the row's other chips, and only
the pointer washes it (the shared pill's hover). A chip that filled itself because work was running
read as pressed — highlighted — before it was ever clicked, and the number is the row's own ink:
the state lives in the head, in the number, and in the warning triangle of an unread failure.
It is a glyph and a number, never a word:
the row's other counts (the subagents) carry no word of their own, and a word is the first thing
that runs out of width at a narrow window — the card's name lives in the tooltip and the accessible
label, in every language. The numbers are the extension's own,
streamed (see the running feed below): a chip with no entry in the index shows a plain zero and
wears no marks, because a badge the app cannot back up is a claim.

`components/BackgroundTasksPanel.tsx` is the card, in **two pages in one track**: the list (counts,
the five status filters, one row per task, a stop on every running row), and the task's
own page, which slides in from the right with a back control in its upper-left corner —
the Settings dialog's navigation, on the card's surface. A row opens the page; Escape on the page
goes back to the list first (`lib/stacked-dialog.ts`), and the second Escape closes the card;
the hidden page is `inert`, so its controls are not in the tab order behind the visible one.
**Stop all is one of the head's three glyph buttons, in front of Refresh** (`StopAllIcon`, in the
danger colour); clicking it asks first, in a strip under the head that names the count of what is
about to be stopped (`role="alert"`) — it stops every running task of this conversation at once,
and a text button in the head was the widest control in a row of 13px glyphs. **Each page is the
box that clips** (`.bg-tasks-pages` is relative and `overflow: hidden`), and **the list page is the
box's content** (`position: relative`, in flow) while the detail page covers it (`inset: 0`): the
card's height is the task list's height, floored at 224px and capped by the shell's box, and the
list page keeps that height for the way back. Two absolutely positioned pages left the box with
nothing in flow, and a box with nothing in flow has no height: the card opened as a 500px strip of
menu surface about 18px tall, with its head, filters, rows and log all invisible — the empty
rectangle the user reported. The old
one-wide-track-of-two-pages slide is the other half of the history: the list's rows carry long
single-token text (a path, a pid), and that slide left the slid-out page's last pixels drawn inside
the card's padding — overflow clips at the *padding box*, not the content box — a strip of the list
beside the detail page. The
detail page carries the task's rows, its command, its exit and the bounded log tail that follows
while its bottom is in view, with the task's own actions (stop, rerun) in its bar. The card shows
one conversation's tasks, so it says nothing about the project's other conversations: no
conversation list, no "Started in" row.

Geometry is shared with the Agents card, exactly: `AppShell`'s `activeTopPanel` mechanism
(`"tasks"`) places it with `placeAgentsPanel(...)` at `BACKGROUND_TASKS_PANEL_WIDTH`
(`lib/top-panel-placement.ts`), and the shell hands the wrapper's limit down as
`--top-panel-max-height` so the card is **as tall as the Agents card's box**: the card fills that
box up to its cap, and is floored at its own 224px so a conversation with no tasks is a box that
says so, never a strip; its list, its detail
page and its log scroll in their own layers. It is a header card, not a side panel, and closes
with the shared Escape / outside-click rules. Its surface is `.app-menu`; every rule is in
`app/native-theme.css` under `.bg-tasks-*`. The name the extension gives a task (built from the
prompt that started it, and sometimes a paragraph long) is one clipped line in the row and in the
detail head; the bar's title is the section's word, never the wall of text.

Both reports about this card are geometry, and `e2e/background-tasks-card.mjs` measures them in a
browser with the app's real CSS, the real chip, the real card, the shell's own placement and the
panel's own client (the harness serves `/api/background-tasks*`): a closed chip has no wash at all
with two tasks running and a failure unread; an open one wears the plate; the card is a box with
its head, its filters and real rows inside it, capped to the viewport and floored at the monitor's
height; a task's page keeps that box with its rows and log tail inside; the same box is centred
under the header on a phone and stays on the screen; and with the two rules that caused the empty
rectangle put back (the floor at zero, both pages absolute), the measurement sees the collapse to
an 18px strip — so the assertions are not blind.

`hooks/useBackgroundTasks.ts` is the client: a snapshot on open, the change stream
(`/api/background-tasks/events`) while open, a slow poll as the safety net, a running task's log
followed on a short tick, monotonic request ids so a reply for a conversation the user left is
dropped, and a closed `EventSource` and cleared timers on unmount.

Availability is a resolution, not a guess: `disabled` (`PI_WEB_DISABLE_BACKGROUND_TASKS`),
`not-installed`, `not-ready`, `no-session`, `closed`. `not-installed` means no copy resolves for
this conversation's directory, and the card names `pi install npm:pi-background-tasks` as the way
to fix it. A session started before the package was installed keeps working and shows `not-ready`,
and the panel says so; the extension is never injected into a running session.

## The running feed (what is not the card)

Two controls need the running state without opening the card: the composer's send disc and the
sidebar's running mark. They read an index of the extension's counts, not a task list:

- `lib/background-tasks/running-index.ts` keeps `{ sessionId: { running, unseenFailed, observedAt } }`
  for the conversations the app is holding. It is written by the bridge as the extension pushes
  its change frames, and by the `subscribe` answer that takes the bridge's lease; a conversation
  whose work finished and was seen leaves it, and a released bridge drops it. It stores no
  commands, no ids, no rows.
- `app/api/background-tasks/running/route.ts` and `.../running/events/route.ts` publish it (a
  snapshot and an SSE of the whole map per change).
- `hooks/useBackgroundTasksRunning.ts` is the client: one shared stream per browser
  (`openSharedEventStreamHandle`, `pi-web:background-tasks-running`), a fetch for the first paint,
  a reconnect on return to the tab or to the network.
- `components/BackgroundTasksRunningContext.tsx` hands the map to the sidebar's rows — the row is
  five layers under the sidebar, and a row asks for its own conversation. A row with running tasks
  and no live run wears the task glyph in the running green; a live run keeps its spinner.
- `components/ChatInput.tsx` / `components/ChatWindow.tsx`: a session idle with running tasks shows
  the **stop** disc (the square), not the send arrow, and its Stop and Escape stop the
  conversation's running set (`allRunning: true`), the same work the disc names. A running turn
  keeps its own Stop, and a running subagent keeps the breathing head: the glyph names what is
  working, and the disc is one button.

Because the frames come from the extensions themselves, a task started with `/bg` in pi's own CLI
moves the disc and the sidebar mark within a frame, with no polling.

**The bridge takes its lease at once, and that is not an optimisation.** The service's `invalidate`
returns before publishing a frame while it holds no lease (`leases.size === 0`), so a client that
leases lazily — as the panel does, leasing on its first read — is a listener that never hears
anything. That was the bug: the header's chip sat at `0` until the card was opened, because
opening the card was the first read, and the first read was the first lease. `onChanges` therefore
leases (client `ensureLease`, never throwing), a `ready` frame retries a lease the activation
refused, and the `subscribe` answer — which carries the registry's counts — is handed to
`onCounts` listeners so the chip's first paint is what is running now, not zero until the next
change. A lease dies (a `closed` frame, a `LEASE_INVALID`) and the client drops its cached facts,
so the next lease reports the state as it is, and `dispose()` releases the lease.

## The finished task is announced by the card, not by the chat or a burst

`pi-background-tasks` appends a custom message when a task finishes (`customType:
"background-task-notification"`), aimed at a terminal's status line. In this app that news is
already in the card — the row moves, the exit and the log are there, the chip keeps an unread
failure — so the chat leaves that one message out: `lib/background-tasks/notification.ts` names
it, and `components/MessageView.tsx` returns nothing for it. Every other custom message (a
subagent's report, an extension's own card) renders as it always did. The extension's task record
is untouched; nothing in the registry, the logs, `mark_seen` or the dock changes.

A finished task also ends runs, and a run is what the app announces: on the desktop, over web push
and over ntfy (`lib/task-completion-server.ts`), in the sentence "The task lasted …, started …, and
ended …". A prompt that starts three shell tasks answers in fifteen seconds while the tasks run for
two minutes, and the task manager then starts a turn of its own for a task that finished. Announced
naively that is four rows in Notification Center about one job the user asked for once, some of
them quoting a fifteen-second run for work that took two minutes. The rule, in three places:

1. **Nothing is said while the conversation's work is running.** The announcer asks
   `backgroundTasksRunning(sessionId)` — the running index, so the extension's own counts — and a
   run that ends with tasks of this conversation still running is *kept* (`deferRunEnd`) and
   announced when the bridge reports the last one settled, with **the settlement as the run's end**:
   the number the user is waiting for, in one notice. A conversation whose tasks outlast the wait is
   announced at the cap (`DEFERRED_NOTICE_MAX_WAIT_MS`) rather than never, and a bridge released
   with its conversation drops the notice it was keeping.
2. **A turn the extension woke to hand in a result says nothing at all.** By its default the task
   manager asks the agent for a follow-up turn about a finished task; that turn is the news
   arriving, not the user's task ending, and the card already shows the task, its status, its exit
   code and its output. `lib/background-tasks/completion-gate.ts` keeps, per conversation, the
   moment the extension's own frames said a task left `running` and settled, and the session asks
   it at `agent_start` whether the run is that news arriving:
   - A run this conversation asked for is announced, always. `RUN_STARTING_COMMANDS` in
     `lib/rpc-manager.ts` stamps `localRunRequestedAt` (prompt, queue, steering, compact, fork,
     navigation); a request at or after the settlement is the user's task. The status reads are
     **not** in that set — the chat polls `get_state` every few seconds, and a poll is nobody's
     task, so marking it would silence the announcement the user is owed.
   - The note expires (30 s). A completion never silences a later task, and a completion that woke
     nothing leaves nothing behind.
   - A second `agent_start` while a run is already owed is that run continuing (an auto-retry) and
     keeps the first verdict, so a task settling mid-run cannot mute the user's own run end.
   - The bridge releases with the conversation and the note goes with it, as the running index does.
3. **One notice per session per window, where a task manager is producing the runs.**
   `COMPLETION_NOTICE_COOLDOWN_MS` applies only to a conversation the extensions have something to
   say about (`backgroundTasksObserved`): three tasks settling is one finished task to the user.
   A conversation with no background work keeps the older rule — every finished task is news,
   however quickly they follow — and the per-run key still answers a run that is settled twice
   through two paths (the key is claimed first, so a replay never spends the window).

The card is the announcer in every one of these cases: the row moves, a failure wears its mark
until the card is opened, and the log is there to read. Nothing here touches the extension's own
terminal notification: the plugin has no global switch for it (only `PI_BG_FEATURES` and
`PI_BG_DOCK_SHORTCUT`), and the per-task `notifyOnCompletion` / `triggerOnCompletion` are the
model's arguments, not the host's.

- `PI_WEB_DISABLE_BACKGROUND_TASKS=1` keeps the extension out of every session (the panel says so).
- `PI_WEB_BACKGROUND_TASKS_PATH=/abs/path/to/dist/extensions/background-tasks.js` loads a checkout
  instead of the installed package. A path that does not exist is reported as `not-installed`.

The installed package is pinned in `package.json` (as every pi package in this tree is). Its
published peer range (`^0.81 … ^0.84`) predates the pi this app runs, so `package.json` carries an
`overrides` entry that rebinds those three peer references to the app's own pi packages
(`"$@earendil-works/pi-coding-agent"`, and the same for `pi-ai` and `pi-tui`) — the same
`$reference` form the `katex` override uses. This is load-bearing, not cosmetic: every workflow in
`.github/workflows` runs a plain `npm ci`, and without the override that install fails on the
conflicting peer. A pi SDK bump needs no change here, because the references follow the tree.

The version compatibility of the seam — the extension's real answers, on a real session and a
real bus — is pinned by `lib/background-tasks/integration.test.mjs`, which fails loudly if the
published shapes move under this SDK. It resolves the copy for the current directory (the app's
dependency or the plugin pi installs) and skips with the install command in its name when neither
is present, so a checkout without the package reports a skip rather than a failure.

## Tests

| File | Pins |
| --- | --- |
| `lib/background-tasks/protocol.test.mjs` | channels, schemas, frames, task views, the documented result shapes, the error-code set |
| `lib/background-tasks/host-client.test.mjs` | lease and sequence rules, **the lease a change listener takes at once and the `subscribe` counts it hands to `onCounts`**, the single retry, timeouts, change de-duplication, the closed activation, dispose, bounds |
| `lib/background-tasks/integration.test.mjs` | the real extension on a real session: capabilities, an empty registry, a task the conversation started, the live feed, logs, stop, seen, `NOT_FOUND`, shutdown, no-extension; skips when no copy is installed |
| `lib/background-tasks/extension.test.mjs` | which copy loads (the user's plugin under the agent dir, the copy the checkout ships), the manifest resource rule, source matching, the per-cwd cache, the switches, the dedupe, the loader options |
| `lib/background-tasks/bridges.test.mjs` | the per-session registry: keying, project grouping, replacement, release, listeners |
| `lib/background-tasks/service.test.mjs` | the per-conversation registry, partial failures, the owner answer, the frozen `stop_all` (including `allRunning`), the ranked `mark_seen`, the log window, the unavailable states |
| `lib/background-tasks/running-index.test.mjs` | what the index keeps and drops, the edges it pushes, a released conversation's mark, an unacknowledged failure that stays |
| `lib/background-tasks/notification.test.mjs` | the completion notice is named exactly, and only it; the chat leaves it out and keeps every other custom message |
| `lib/background-tasks/completion-gate.test.mjs` | the baseline frame, the settlement that wakes a run, a prompt of the conversation winning, the window expiring, a frame that settles nothing, a released conversation, no news lent between conversations |
| `lib/task-completion-server.test.mjs` | the announcer: every channel of one finished run, nothing for an aborted, failed, stale or unnameable run, **nothing while the conversation's background tasks run and the settlement as the announced end**, the kept notice dropped with a released conversation, one notice per window only where background work is producing the runs, every finished task of a plain session still announced |
| `app/api/background-tasks/route.test.mjs` | the HTTP gate: required ids, the four actions, the byte window, 409 with the extension's code |
| `app/api/background-tasks/running/route.test.mjs` | the running snapshot is the index and nothing more; the stream's frames are the whole map, and an aborted request stops receiving |
| `components/BackgroundTasksPanel.test.mjs` | the rendered chip and card: the row's pill and its states (a glyph and a number, no word; a plate only while the card is open, and no accent wash for running work), the dialog and its names, the head's Stop-all icon in front of Refresh and its confirm strip, the two pages and the back control, the pages clipping to their boxes (the list page in flow, the detail page covering), the floor the card keeps, the failed row's warning triangle, the CSS classes and the Agents-card height, the header wiring, the composer and sidebar running wiring, the notification gate, the hook's cleanup |
| `e2e/background-tasks-card.mjs` | the chip and the card measured in a browser, in dark: no plate on a closed chip, the plate on the open one; the card a box (floor, viewport cap, the shell's width) with its head, filters, rows, detail rows and log tail inside; a task's page at the same height with the back control in the corner; the box centred on a phone; the empty conversation a box that says so; and the old rules put back, collapsing to a strip |
