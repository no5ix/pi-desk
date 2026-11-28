# Memory: what the server holds, and when it gives it back

pi-web runs the agent **in the server process**: a loaded session is a parsed
transcript, an SDK `AgentSession` with its extensions and MCP host, the SSE
backlog of every stream, and the caches that make browsing instant. This fork
runs that process for hours — desktop sidecar, dev server, a phone's tunnel to
the same server — so the question is not "can it be smaller" but "who releases
what, and when". Every rule below came from a measured leak.

## The heap ceiling is a policy, not a flag in a script

`bin/server-flags.js` decides the old-space ceiling and every entry point asks it:

| Entry point | How it applies |
| --- | --- |
| `npm run dev` (`scripts/dev-server.mjs`) | child argv `--max-old-space-size` |
| `scripts/web-dev.mjs`, `scripts/lan-server.mjs` | `NODE_OPTIONS` |
| `bin/pi-web.js` (`next start`) | `NODE_OPTIONS` on re-exec |
| `desktop/server-launcher.cjs` | `v8.setFlagsFromString` (its own worker) |

Defaults: **2048 MB dev, 1536 MB production and desktop**.
`PI_WEB_MAX_OLD_SPACE_SIZE` sets it in MB; `0`, `off`, `none`, `default` leave V8
alone; a ceiling already in `NODE_OPTIONS` wins; absurd values are clamped
(256 MB – 32 GB) and warned about. `scripts/server-flags.test.mjs` and
`scripts/prod-server-flags.test.mjs` pin the policy against every entry point,
so a new launcher that forgets it fails.

The reason it exists: `next dev` forks its server child with
`--max-old-space-size` = half of physical RAM (`next/dist/cli/next-dev.js`). On a
128 GB machine that is a 64 GB licence to grow, and the server grew to an 18.62 GB
peak. `next start` and the sidecar get V8's default (~4 GB), which is why
production never looked as bad as development while being just as unreleased.

A ceiling is a **collection trigger**, not a fix: V8 returns pages to the OS only
when its heap is tight. Measured, with a 1 GB ceiling and a 268 MB live set, the
process gave back **0 MB** of RSS when idle. So the ceiling travels together with
the budgets below: a ceiling far above the live set is a licence to keep pages.

## Metering, so a report names a store

`lib/server-memory.ts` samples the process (`rss`, heap, `heap_size_limit` from
`v8.getHeapStatistics`, peak RSS) and every long-lived store in the order that
answers "where": live wrappers, the read-only `SessionManager` cache, SSE
backlogs, MCP servers, the artifact index, file listings, the calendar prompt
cache, the session scan, composer queues, terminals. It reads `globalThis`
directly — no import cycle, no app-module side effects — and bounds its walks.

- `GET /api/agent/debug?memory=1` answers with it (kept off the debug panel's
  two-second poll; the panel's default snapshot stays small).
- `&pressure=1` runs the valve first, `&gc=1` collects (only with `--expose-gc`).
  The route is local-only, so the knobs are not a remote control.
- The page reports itself: `lib/client-memory.ts` samples the browser heap,
  DOM nodes and loaded messages, sent on the lease renewal the page already makes
  every 30 s (`app/api/agent/[id]/lease/route.ts` coerces it, never trusts it).
- `scripts/memory-bench.mjs` (`npm run memory:bench`) drives the browsing path of
  a running server over the largest sessions on disk and samples the process the
  whole run: peak, retained, **given back**.

`PI_WEB_MEMORY_BUDGET_MB` is the RSS the valve works against: default **1024** in
production, **2560** in dev (a healthy dev server is 1.5–2 GB of Turbopack module
graph, so a budget inside that range fires every minute and finds nothing to
release; over the heap ceiling is the signal). Clamped 256–32768, `0` off.

## What releases, and when

| Store | Release | Tunable |
| --- | --- | --- |
| Wrapper with no page, no run | idle timeout, default 10 min (dev: 2 min) | `PI_WEB_IDLE_TIMEOUT_MS` |
| Page leaves the session | `POST /api/agent/[id]/release` → grace, default 5 s | `PI_WEB_RELEASE_GRACE_MS` |
| Wrapper the page only read | viewer release, default 10 s | `PI_WEB_VIEWER_RELEASE_MS` |
| Warm unwatched wrappers, summed | byte budget, default 64 MiB of session files | `PI_WEB_IDLE_CAP_BYTES` |
| Read-only view cache | 8 entries / 96 MiB / 32 MiB per file | `SM_CACHE_LIMITS` (tests shrink it) |
| Every cache, under pressure | the valve: each to half | `PI_WEB_MEMORY_BUDGET_MB` |
| MCP host per session | 3 min idle | `PI_WEB_MCP_IDLE_MS` |

Invariants, each of which undoes a regression if dropped:

- **A running session is never evicted.** `isRunning()` (with `inner.isIdle ===
  false`) gates every path; the idle timer re-arms while a session runs, so a
  release shortens the countdown of an idle wrapper and does nothing to a run.
- **Stop's forced deadline is never shortened** (`forceShutdownOnIdle` +
  `forcedIdleTimerArmed`): a release is a page leaving, not permission to reap a
  run Stop cannot unwind.
- **A release with an event stream attached is not a release.** Another tab, a
  phone, an open panel is a reason to stay loaded (`hasEventListeners()`).
- **The newest session is always kept** by the byte cap, so the session you just
  left is instant; a session you *ran* keeps the long grace, a session you only
  read goes at the viewer release (the read-only view cache makes its reopen a
  map hit).
- **No count cap on warm sessions.** 0.8.1 capped the count at 4 and every switch
  back cold-started a wrapper. Bytes is the axis that measures a 5 MB and a
  135 MB transcript alike (`lib/idle-session-cap.ts`).
- **A live wrapper is never built from slimmed entries.** `lib/session-slim-load.ts`
  is `persist=false` on purpose: pi's `_rewriteFile()` (version migration, session
  replacement) writes the manager's entries over the file, so slimmed entries
  would silently delete payloads from the real transcript.

## A cache that cannot name its bytes cannot be released

`lib/cache-registry.ts` is the contract: a pruner is `{ name, bytes(),
prune(targetBytes) }`, registered by the module that owns the store
(session views, calendar prompts, artifact index, composer queues, terminals,
file listings). `applyMemoryPressure()` runs the stores in order — sessions
first (a read from disk is the refetch), then each cache to half of what it
holds, then `global.gc()` if the process has it — at most once a minute, from
the sampler when RSS is over budget, or on request.

Halving is deliberate: emptying the artifact index forces a rescan of every
session file on the next Artifacts page, and emptying the listings forces a
`git ls-files` per project. `lib/cache-registry.test.mjs` fails when a store the
debug meter names has no pruner, so a new cache is noticed at the moment it is
added.

A pruner drops **whole entries, coldest first**, and never a running resource:
the terminal pruner removes exited shells and trims a live shell's scrollback, it
does not kill a shell a person is typing into.

## The live append path is the same projection history uses (Phase 5)

A run's bytes arrive twice: once streamed, once read back from the session file.
Before Phase 5 the streamed copy was the heavy one — the transcript's own
reasoning text, its screenshots, its 2 MB tool logs — appended straight into the
page's message array, where it stayed for the rest of the tab's life. History had
already solved this (`deferThinking`, `deferMedia`): the entry's content is
projected to a preview plus a URL, and the card that wants the rest fetches it.
`lib/deferred-message-content.ts` is that projection with a session id and an
entry id attached, and both paths call it.

The entry id is the whole problem, and the reason the mechanism is where it is:

- The stream gates `message_end` for **one microtask**. That is when the SDK has
  appended the entry, so `leafEntry()` (lib/rpc-manager.ts, id/type/role only —
  never the entry's content) names the entry the message became. Events that
  arrive in the meantime are gated too, so the producer's order survives; the
  flush releases the append and the events behind it together.
- A leaf that has not moved, an entry of another type, a message whose role is
  not the leaf's, a session that exposes no `leafEntry`, a stream opened with
  `?liveDefer=off`: in every one of those the message goes through **whole, with
  every byte**. A projection with no fetchable pointer is data loss with a
  spinner, so the rule is that deferral requires an entry id, and the code has
  one path that has one.
- `entryIds[i]` is the session entry of `messages[i]`. The reducer queues the ids
  the stream names (`pendingEntryIdsRef`) and one effect keeps the two arrays the
  same length, filling a slot with `""` when no id is known — an empty slot is
  the card's signal to show the inline content it was given.

Retrieval is the routes the collapsed cards already call:
`/api/sessions/[id]/entries/[entryId]/thinking?blockIndex=N`,
`…/tool-result-image?blockIndex=N` (it answers a `toolResult` **or** a `user`
message: attachments are user entries), and the new
`…/tool-result-content?blockIndex=N` for a tool result the payload budget cut.

## A tool update is the growth, not the snapshot (Phase 7)

A long shell command is the same string, re-sent, growing: at 20 updates a second
the stream is mostly bytes the page already had. `lib/tool-update-delta.ts`
encodes each update against **this connection's** baseline (a second browser
joining mid-call gets a whole frame), and the modes are the shapes a growing tool
card actually has: `textAppend`, `contentAppend`, `callsAppend` (codemode's call
list), `detailsReplace`. Unchanged `details` are omitted; a frame the delta
cannot describe goes out whole.

The rules that keep a hole from becoming a wrong card:

- `rev`/`base` are checked on both sides. A delta whose `rev` is not the next one,
  whose `base` the client does not have, or for a call the client never saw, is
  **refused**: the card keeps the frame it has (`applyToolUpdateDelta` → `ok:
  false`) rather than splicing text it cannot place.
- A delta dropped under backpressure invalidates that call's baseline
  (`onDrop`), so the next update is whole. `tool_execution_end` and `agent_end`
  invalidate too: a long run of short calls must not leave one baseline per call.
  A new stream is a new encoder, and the client clears its reconstructions on
  `connected` and `agent_end`.
- Both sides are bounded LRU maps (`TOOL_UPDATE_BASELINE_CAP`,
  `TOOL_UPDATE_STATE_CAP`).

Deltas are **opt-in per connection** (`?toolUpdates=delta`); a client that did not
ask gets the snapshots it can render alone, which is what keeps an old tab and a
relay shell working.

## Every event has a budget, and says when it hit it (Phase 7)

`lib/event-payload-limit.ts` gives one serialized event 1 MiB
(`PI_WEB_MAX_EVENT_PAYLOAD_BYTES`, clamped to ≥ 64 KiB; `0`/`off` disables). The
cut is structural — the tree is walked, the biggest cuttable site goes first, and
the JSON is re-measured — never a slice of a JSON string, because a frame that
cannot be parsed is a frame the page drops.

- `ESSENTIAL_KEYS` are never cut: `type`, `toolCallId`, `role`, `entryId`,
  `isError`, `timestamp`, `usage`, `rev`, `mode`, a url, a path. A card must stay
  addressable and answerable.
- A long string keeps as much of its head as the budget allows (not a fixed 4 KB)
  and says what fell off; a long array keeps its leading `PAYLOAD_KEEP_ITEMS`
  items and counts the tail; a base64 image becomes a counted note.
- The event carries `payloadTruncated` — chars, items, images, the fields cut, and
  `contentUrl` when the session entry holds the full text. **A shortened value must
  never render as if it were complete**: `ToolCallBlock` shows the notice and
  offers the entry's real text.

## The loaded window slides; a collapsed card gives its content back (Phase 6)

Two rules, both about what a tab keeps when nobody is looking at it.

**The window.** `MAX_LOADED_MESSAGES` used to be a wall: at 600 rows the
"load earlier" sentinel went quiet, so the page a person could read was 600 rows
and the rest of the session was unreachable — and the rendered window followed the
loaded count, so a session's transcript became React state, DOM, highlighted code.
Now the window slides (`trimLoadedWindow` in lib/chat-lazy-load.ts): eviction is
from the **head** only, because the rendered window is the tail, so the rows the
reader stands on, the rows they are reading and the streaming tail are never
touched; the cap is the live window plus `LOADED_WINDOW_SLACK`, so a trim can
never cut a row that is on screen; rows named by `keepEntryIds` (a search target,
an anchor the viewport is attached to) are protected and eviction stops in front
of them. `hasEarlierAfterPrepend` follows the server, not the cap.

The cursor is the **fetch watermark** — the oldest entry the page has asked for —
and not the oldest row it happens to be holding. A cursor that followed the kept
rows re-requested the same page forever the moment a protected row pinned the
head; `lib/chat-lazy-load.test.mjs`'s sliding walk is the test that found it. The
rendered side is clamped by `MAX_NAVIGATED_LOADED_MESSAGES` in `ChatWindow` (both
where the window follows the loaded count and where a search jump sizes it), so
the two halves cannot ratchet each other.

**Collapsed content.** A card's fetched payload — a reasoning block, the full
output behind "view full output", the text behind a payload cut — is a thing the
page can refetch. Collapsing the card hands it back once it is over
`RELEASE_ON_COLLAPSE_CHARS` (`shouldReleaseOnCollapse`), and the caches that make
re-expanding cheap are bounded by **bytes** and entries, not entries alone
(`RetainedTextCache` in lib/content-retention.ts, registered with
`registerContentCache` so `announceContentPressure()` can empty them when the
meter asks). A plain `Map` of thinking strings is the regression this replaces.

## Measuring the live path (Phase 8)

`npm run memory:bench` is the server. `node scripts/memory-bench.mjs --wire` is
the live path: it runs a synthetic tool-heavy run (growing shell logs, a
screenshot per call, a long reasoning block per reply, an oversized log every
tenth call) through the app's own modules and prints the same run under `full`
(the path the phases replaced), `phases`, and `phases-64k` (the budget floor).
Wire MB, p50/p95/max frame bytes, delta/deferred/capped counts, and the bytes of
page state and of the loaded window. Reference run (120 calls): 132 MB → 51 MB on
the wire (max frame 3.37 MB → 1.02 MB, 64 KB at the floor), and 100 MB of page
state → 34 MB. Columns are bytes, not heap: process RSS and heap are the server
bench's subject. `--json` for a diff between branches.

## Files

`bin/server-flags.js`, `scripts/dev-server.mjs`, `scripts/web-dev.mjs`,
`scripts/lan-server.mjs`, `bin/pi-web.js`, `desktop/server-launcher.cjs`,
`next.config.ts`, `lib/server-memory.ts`, `lib/client-memory.ts`,
`lib/cache-registry.ts`, `lib/idle-session-cap.ts`, `lib/rpc-manager.ts`
(`everPrompted`, `releaseIdleTimer`, `idleCapCandidate`, `enforceIdleSessionCap`),
`lib/session-reader.ts` (`SM_CACHE_LIMITS`, `shrinkSessionManagerCache`),
`lib/session-prompts.ts`, `lib/artifact-index.ts`, `lib/composer-queue.ts`,
`lib/terminal-manager.ts`, `app/api/file-index/route.ts`,
`app/api/agent/debug/route.ts`, `app/api/agent/[id]/lease/route.ts`,
`app/api/agent/[id]/release/route.ts`, `hooks/useAgentSession.ts`,
`instrumentation-node.ts`, `scripts/memory-bench.mjs`,
`lib/deferred-message-content.ts`, `lib/tool-update-delta.ts`,
`lib/event-payload-limit.ts`, `lib/content-retention.ts`, `lib/chat-lazy-load.ts`,
`lib/agent-event-stream.ts` (the gated append, the delta encoder, the budget),
`lib/rpc-manager.ts` (`leafEntry`), `lib/session-reader.ts` (the history
projection), `app/api/agent/[id]/events/route.ts` (the query switches),
`app/api/sessions/[id]/entries/[entryId]/{thinking,tool-result-image,tool-result-content}/route.ts`,
`components/MessageView.tsx` (the fetch on expand, the release on collapse, the
truncation notice), `components/ChatWindow.tsx` (the window's size),
`hooks/useAgentSession.ts` (the pairing, the reconstruction, the trim).
Tests: `scripts/server-flags.test.mjs`, `scripts/prod-server-flags.test.mjs`,
`lib/server-memory.test.mjs`, `lib/cache-registry.test.mjs`,
`lib/idle-session-cap.test.mjs`, `lib/rpc-manager-idle-timeout.test.mjs`,
`app/api/agent/release-route.integration.test.mjs`,
`app/api/agent/debug-route.integration.test.mjs`, `lib/next-config.test.mjs`,
`lib/deferred-message-content.test.mjs`, `lib/tool-update-delta.test.mjs`,
`lib/event-payload-limit.test.mjs`, `lib/agent-event-stream-phases.test.mjs`
(the wire: deferral, order, deltas, the budget), `lib/chat-lazy-load.test.mjs`
(the sliding window, the cursor, the protected row),
`components/memory-live-path.test.mjs` (the client half no unit test can reach).
