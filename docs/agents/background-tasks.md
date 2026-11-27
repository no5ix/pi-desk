# Background Tasks — the header's task monitor

The header's task button opens one compact card under itself: the background tasks of this
project's live conversations, read from the `pi-background-tasks` extension. The extension is
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

## Where the bridge lives (`lib/rpc-manager.ts`)

`lib/background-tasks/extension.ts` resolves the installed package's host entrypoint from its
own `pi.extensions` manifest and hands it to the session as `additionalExtensionPaths`, together
with an `extensionsOverride` that keeps **one** activation. Two activations mean two registries
and a panel that leases one of them: a task started in the conversation would not appear, and a
task in the panel would not be stoppable. The user's own copy (under pi's package dir or
`~/.pi/agent/node_modules`) wins the dedupe over the copy pi-desk ships, because that is the
copy `/bg`, `/tasks` and the extension's update notice talk about.

`lib/background-tasks/bridges.ts` keeps one `BackgroundTaskHostClient` per live conversation,
keyed by session id and grouped by `cwd`. `lib/rpc-manager.ts` attaches it when the wrapper is
created and releases it in `destroy()`/`shutdown()` — a bridge outliving its session is a client
with two listeners on a bus whose extension is gone. The bridge is created on the **same
`EventBus` instance** the session's extensions were handed, before the session binds, which is
why the activation's `ready` frame is heard and not missed.

`lib/background-tasks/service.ts` reads: every live conversation of the same project is asked,
and the answers are merged into one list (one row per task id; a terminal state is never undone
by a later running snapshot of the same id). An activation that does not answer is reported in
`sessions[].state` and contributes no tasks and no counts — a partial answer is not "nothing is
running". Actions resolve the owning activation by `detail`, including when the owner is a
*different* conversation of the same project.

`errorOf` reads the code off the error instead of using `instanceof`: Next can instantiate the
host client's module twice in the server, and a `NOT_FOUND` from the other copy would come back
as our `OPERATION_FAILED` — the panel would lie about who refused.

## The panel

`components/TopbarBackgroundTasks.tsx` is the header button: the running count and the *unseen*
failure mark, both the extension's own numbers, both worn only when the extension answers. A
badge on a panel that can read nothing is a claim. `components/BackgroundTasksPanel.tsx` is the
card: counts, the five status filters, one row per task, the selected task's details, a bounded
log tail that follows while its bottom is in view, stop / stop-all (confirmed) / rerun, and the
unavailable states (disabled, not installed, not loaded, no session, closed).

It is a header card, not a side panel: `AppShell`'s `activeTopPanel` mechanism (`"tasks"`) places
it with `placeHeaderCard(...)` at `BACKGROUND_TASKS_PANEL_WIDTH` (`lib/top-panel-placement.ts`)
and closes it with the shared Escape / outside-click rules, the same as the Agents card. Its
surface is `.app-menu`; every rule is in `app/native-theme.css` under `.bg-tasks-*`.

`hooks/useBackgroundTasks.ts` is the client: a snapshot on open, the change stream
(`/api/background-tasks/events`) while open, a slow poll as the safety net, a running task's log
followed on a short tick, monotonic request ids so a reply for a conversation the user left is
dropped, and a closed `EventSource` and cleared timers on unmount.

Availability is a resolution, not a guess: `disabled` (`PI_WEB_DISABLE_BACKGROUND_TASKS`),
`not-installed`, `not-ready`, `no-session`, `closed`. A session started before the package was
installed keeps working and shows `not-ready`, and the panel says so; the extension is never
injected into a running session.

## Development switches

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
published shapes move under this SDK.

## Tests

| File | Pins |
| --- | --- |
| `lib/background-tasks/protocol.test.mjs` | channels, schemas, frames, task views, the documented result shapes, the error-code set |
| `lib/background-tasks/host-client.test.mjs` | lease and sequence rules, the single retry, timeouts, change de-duplication, the closed activation, dispose, bounds |
| `lib/background-tasks/integration.test.mjs` | the real extension on a real session: capabilities, an empty registry, a task the conversation started, the live feed, logs, stop, seen, `NOT_FOUND`, shutdown, no-extension |
| `lib/background-tasks/extension.test.mjs` | resolution, the switches, the dedupe, the loader options |
| `lib/background-tasks/bridges.test.mjs` | the per-session registry: keying, project grouping, replacement, release, listeners |
| `lib/background-tasks/service.test.mjs` | the merged snapshot, partial failures, owner resolution, the merged `stop_all`, the ranked `mark_seen`, the log window, the unavailable states |
| `app/api/background-tasks/route.test.mjs` | the HTTP gate: required ids, the four actions, the byte window, 409 with the extension's code |
| `components/BackgroundTasksPanel.test.mjs` | the rendered button and card: badge rules, the dialog and its names, the CSS classes, the header wiring, the hook's cleanup |
