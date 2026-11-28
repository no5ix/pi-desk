# Sessions, events and the chat client — fork notes

## Generated session titles

Generate title makes a separate bounded request with the current conversation's
model and credentials. A stored key is not proof that the provider accepts it.
AppShell keeps progress and results in the global notice shelf after More closes;
authentication errors explain that the key/model needs attention and link to Models.
It never silently switches providers. A synchronous per-session guard prevents
duplicate submissions; results refresh the sidebar but only update the active
header when they still belong to that conversation.

Settings › General › "Name sessions automatically" (`autoTitle` in Pi Web's `settings.json`, `lib/session-title-settings.ts`, `/api/session-title/settings`; off by default because it is one more request to the session's model) has the server run the same generator once: `AgentSessionWrapper.autoTitleAfterRun()` fires from `notifyAgentRunCompleteIfIdle()` after the first run that ends `done`, and only for a session with no name. It never renames a named session, re-checks the name before writing (the user may have renamed it meanwhile), and skips wrappers with suppressed completion notifications (subagents). A failure is logged and retried after the next run. The rename goes out as `session_info_changed`, which refreshes every sidebar and the topbar.

## Editable composer outbox

`lib/composer-queue.ts` owns individually identified pending composer messages, including images.
`queue_composer` accepts into this outbox, `take_composer_message` claims one for edit/delete,
and `send_composer_message` claims one and submits it through the existing prompt admission
with `streamingBehavior: "steer"`. Already claimed IDs return a successful no-op with the latest
queue snapshot, without sending/restoring the message again. Every queue mutation increments
`pendingVersion`; clients ignore older polling, SSE or action snapshots so delayed responses
cannot resurrect consumed rows. Lock row actions immediately with a ref, before React renders.
Never clear/rebuild SDK
queues to emulate individual operations. SDK queues remain available to extensions.

After `agent_settled` and prompt-promise cleanup, the outbox checks `isRunning()` and admits
one next message through the existing MCP/preflight path. Rejection restores that entry and
pauses automatic delivery. Stop also pauses delivery, preserving entries for edit/delete or
explicit Send now; it must not stop one run only to start the next queued task immediately.
`composer_queue_update` and `get_state.queuedMessages.pending` keep views synchronized.
The process-global outbox survives page reloads and idle wrapper eviction, but not application
exit. Outbox data must not enter model context before delivery. Queue tests include real wrapper
admission and mocked run lifecycles; they do not call paid models or use user sessions.

Fork-owned notes moved out of `AGENTS.md` to keep it short. The upstream doc on the same topic (`docs/agents/*.md` without the `fork-` prefix) may describe the same area in other words; where they disagree, these notes describe this fork. Hard rules that must survive a merge are also listed in `AGENTS.md` under **Hard rules**.

## Branch summaries (pi's "Summarize branch?")
pi can summarize the branch being left onto the one entered (`navigateTree(id, { summarize, customInstructions })`, a `branch_summary` entry that becomes the new leaf). In BranchNavigator a plain row click stays a plain switch — rows are also how branches are browsed, and a dialog on every click would be in the way — while rows of other branches offer "Summarize & switch" (hover; always shown on touch) with an optional focus line. That switch is server-first (`summarizeAndNavigate` in `useAgentSession`): the transcript to show only exists once pi has written the summary, so the view does not switch optimistically like a plain switch. It blocks like an LLM call, locks branch switching and the composer, and shows a progress strip in the composer whose Stop sends `abort_branch_summary` (pi answers `{ cancelled: true, aborted: true }` and the leaf stays put). `branch_summary` entries render as a summary card (`CompactionMessageView kind="branch_summary"`) and start a displayed turn; they used to be projected as a fake user bubble that offered Edit / Fork. `branchSummary.skipPrompt` has nothing to skip here, since the GUI never prompts.

## Session files can be fully rewritten
`parentSession` in the header is **display metadata only** — has zero effect on chat content. Safe to rewrite the entire file (pi does this itself during migrations). Used when cascade-reparenting children on delete and by continue-in-project; both go through `replaceFileAtomicSync()` (`lib/atomic-file.ts`: temp file beside the real path, then rename), never an in-place `writeFileSync`, so a crash or a full disk cannot truncate a transcript. The same helper rewrites `settings.json`, `auth.json` and `SKILL.md`; it keeps a symlinked file's link and its mode.

## A new session has no file until pi flushes it
Pi delays the first flush of a new session until an assistant message exists, so a run that just started is invisible to the disk scan behind `/api/sessions`. The sidebar list is derived purely from `.jsonl` files, so without help the session the user is actively watching cannot be found in the list until the turn ends.
- `/api/sessions` merges live runtime rows via `getRpcSessionInfos()` (`lib/rpc-manager.ts`) with `mergeSessionLists()` (`lib/session-reader.ts`); the disk row wins for a persisted id, and a runtime row is suppressed until a user message exists (otherwise an untouched "new chat" runtime renders a row that later vanishes). `ensure_session`-created idle runtimes are also suppressed. Once a prompt is submitted the wrapper's `pendingPromptPreview` (`getPendingPromptPreview()`) stands in for the missing user entry, so the row shows during MCP preparation and SDK preflight; `finishPrompt` clears it on completion, rejection and abort, and `notifyRunningChange()` dedupes on the running ids *and* `sessionListVersion` so every window refetches (see `docs/agents/sessions.md`).
- Sessions created by subagents carry a `relation: { kind: "subagent", ... }`; sidebar rows for subagents are hidden and their state aggregates into the parent row (`listSessionFamilies` in `lib/session-family.ts`).
- The disk scan behind the list is upstream's incremental scanner (`lib/session-list-scanner.ts`, `listSessionsIncremental`), fingerprinted per file on size+mtime in a persisted index (`globalThis.__piWebScanIndex`), so post-turn refreshes only re-parse the session that changed. `invalidateSessionListCache()` drops the merged list. Include symlinked project directories when touching the directory walk.
- `GET /api/sessions` returns a `sessionListVersion` counter; the sidebar's SSE handler refetches the list (reusing the invalidated server cache, no forced scan) whenever the version moves — that is how edits from another window/process appear.
- The sidebar refetches the list once per running id it has no row for, because a session can start running between list fetches.

## Event pipeline: SDK → wire → client (`lib/agent-event-stream.ts`, `lib/agent-event-wire.ts`)
- Per-agent SSE goes through `createAgentEventStream(req, id, sessionPromise)`: the session starts **asynchronously** (the route never `await`s `startRpcSession`), the stream filters events through `toClientAgentEvent()` and forwards them with one shared `TextEncoder`. Cancellation is `cancelStream(closeController)`; closing with `false` keeps the session's own listeners alive.
- The sidebar's running-id stream (`/api/agent/running/events`) keeps the older inline `dispose` pattern and must stay registered in `app/api/agent/events-route.test.mjs`.
- `subscribeRunningSessions()`/`notifyRunningChange()` in `rpc-manager.ts` broadcast the running-id set; `SessionSidebar` treats the stream as authoritative for running state (`sseAuthoritativeRef`) once connected, and a `sessionListVersion` bump on any SSE frame triggers a cache-reusing list refetch.

## Opening very large session files (`lib/session-slim-load.ts`)
`openSessionManager()` (read-only, non-`mutable`) opens files of 16 MiB or more through `openSlimSessionManager()` instead of `SessionManager.open()`. Browser-automation tools store a DOM outline in a tool result's `details` (120 of 129 MB in one real file) that the UI never reads (`lib/tool-result-details.ts`); the loader cuts that span out of oversized (≥256 KiB) `toolResult` lines as bytes before decoding, so it is never turned into a string or object graph. Measured on a 129 MB session: 654 ms → 93 ms.
- Every shortcut is verified and falls back to a full parse of the line: no `details` anchor, a `patch`/`diff`/`preview`/`result` key or a `pi-web-subagent` marker inside the span, unknown message keys after the strip.
- The manager is built with `persist=false` through the SDK's private constructor, so slimmed entries can never be written over the real file. Mutable opens (`{ mutable: true }`, live wrappers) still use the SDK. `session-slim-load.test.mjs` pins the constructor shape against `SessionManager.open()`; after an SDK bump, a failure there means the constructor changed.
- `KEPT_DETAIL_MARKERS` must stay in step with `KEPT_DETAIL_KEYS` in `lib/tool-result-details.ts`.

## Session listing: incremental scanner vs upstream catalogue
- `lib/session-list-scanner.ts` is the live scanner behind `SessionManager.listAll()`'s replacement: per-file info minus `allMessagesText`, re-parsed only when a file's size/mtime fingerprint changes; `invalidateSessionListCache()` drops the merged list cache. The fork's older scanner (`lib/session-scan.ts`) was deleted: nothing read its cache.
- `resolveSessionPath()` tries a targeted header read (bounded to 4 KiB) before falling back to a full scan; `readSessionHeader()` never parses the whole file.
- `GET /api/sessions` sends `firstMessage` through `sessionListFirstMessage()` (`lib/slash-display.ts`): the `/skill:` command for a skill expansion, then at most 200 code points. Every list reader shows one line of it; on a real home the untrimmed field was 84% of a 1 MB list fetched three times per cold start. The scanner and `GET /api/sessions/[id]` keep the full text.
- Never reintroduce a literal `homedir()` into an fs call in these paths — route it through `userHome()` or the scanner walks the whole user profile at build time and Windows releases fail.

## Client session hook: guards you must keep when merging upstream (`hooks/useAgentSession.ts`)
- **Monotonic request ids**: `contextLoadIdRef`/`toolsLoadIdRef`/`sessionGenerationRef` — checking only the session id is not enough when the user switches A→B→A before a request settles. `loadContext`/`loadTools`/the `agent_end` refresh all capture and re-verify identity.
- **Session-load deadline**: `loadSession` fetches through `fetchWithRetry` (one retry with a longer deadline); a hung first attempt must not leave "loading session" forever.
- **Streaming seed**: `seedStreamingSnapshot()` re-hydrates the streaming bubble from `get_state.streamingMessage` on reconnect paths (page refresh mid-run).
- **Render-phase scroll save**: the departing session's scroll position is saved inside the `sessionIdentity !== appliedIdentity` render block, not in an effect cleanup — the browser clamps scrollTop to 0 before cleanup runs. `pendingInitialScrollTopRef` is consumed by the first-messages layout effect; upstream's `pendingScrollRestore` visibility gate hides the container until an in-page viewport restore lands.

## ToolCall field normalization
Pi stores toolCall blocks as `{type:"toolCall", id, name, arguments}` but `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts` handles this — called in both `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

## SSE reconnect on page refresh mid-stream
On `ChatWindow` mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE is reconnected automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

## The stream's readiness wait is a silence window under a ceiling (`lib/agent-event-connection.ts`)

`connected` is the server's proof that the session exists, and the page's send waits for it. The
wait is `readinessTimeoutMs` of **silence**, re-armed by every piece of data the stream delivers
(above all the app's own 30 s heartbeat, whose whole job is to say "alive, still starting"), under
`readinessCeilingMs` counted from the socket opening (the page: 60 s of silence, a 300 s ceiling;
omitted, five times the window, never under `READINESS_CEILING_FLOOR_MS`). A countdown from the
socket was the old rule, and it lied: a cold start — a dev route compile, extensions and MCP
servers loading, a large transcript, a phone on a slow link — is slow work, and the page called it
"Timed out starting the agent session. Please try again." while the stream sat open and answered
every 30 s, then closed that healthy stream and restarted the start from zero. Keep the two
failures worded apart: silence and a stream that never opened say to retry, a ceiling says the
session is slow. The `AgentEventConnectionError.detail` field carries what the stream did, and
`snapshot()`'s `lastError` keeps the reason (`ready_timeout`) for the Debug panel.

## Compaction & summarization-retry SSE events
pi 0.86 emits `compaction_start`/`compaction_end` (the legacy `auto_compaction_*` names are gone — do not re-add their cases) plus `summarization_retry_scheduled/attempt_start/finished` when summary generation enters backoff. `handleAgentEvent` keeps `isCompacting` in sync and mirrors the retry counter into `summarizationRetry`, shown as "Compacting… (retry n/m)" on the compact control. `compaction_end.willRetry` deliberately leaves the counter in place so the countdown stays visible between compaction passes. Manual compact is a blocking POST — the button stays disabled until the response returns. Starting one lives in the composer's `+` menu (`components/ComposerPlusMenu.tsx`), offered while `canCompactNow` (`onCompact && !isStreaming && !isCompacting`); a running compaction gets its own row in that menu, guarded only by `isCompacting && onAbortCompaction`, because an auto-compaction mid-run must stay visible and abortable, which is exactly when `isStreaming && isCompacting` — the `+` itself wears `data-compacting` so the control is findable with the menu closed.

## A finished report cancels the compaction that opens after it (`lib/rpc-manager.ts`)

`agent_end` fires before the post-run pipeline (`agent-session.js` `_startRun` → `_handlePostAgentRun` → `_checkCompaction`), and `_isAgentRunActive` stays true until `agent_settled`. So a threshold compaction that pi starts after a completed answer is a live summarization request — minutes of "Compacting…" and a running sidebar dot beside an answer the user already has, and a second round when the summary hits its retry backoff. `canSkipPostRunCompaction()` arms a per-wrapper guard at the `agent_end` whose last assistant message ended with `stopReason === "stop"`, no `willRetry`, and no tool call left; `cancelPredictedPostRunCompaction()` spends it on the next `compaction_start`, calling `inner.abortCompaction()` only when the run is still live (`isStreaming`) and nothing is queued behind the answer (steering/follow-up, the composer outbox, parked prompts, a prompt waiting on MCP). The guard is cleared at `agent_start`, `agent_settled`, Stop and teardown, so a manual `/compact` and the next prompt's own pre-run compaction are never touched, and it is per-session — a session never cancels another's compaction.

What the SDK does with the abort is what makes this safe: the summarization request is cut, `compaction_end { aborted: true }` is emitted with no `errorMessage` (the client clears `isCompacting` and keeps the transcript), nothing is appended to the session file, and the next prompt's `_prepareRun` re-runs `_checkCompaction` — so the deferred compaction happens when a request actually needs it, which `lib/rpc-manager-post-run-compaction.integration.test.mjs` pins against the real SDK (a cancelled compaction consumes no model reply, a completed one consumes exactly one: how the tests tell them apart). Runs that need compaction to finish are excluded at the arm: a context overflow, a `length` truncation (overflow recovery compacts and calls `agent.continue()`), an API error, a `willRetry` run, a run that ended on a tool call, and a stopped run.

## 0.86 event surface — the wire forwards everything, the client switch must keep up
`agent-event-wire.ts` whitelists by omission (only `turn_start/turn_end` dropped), so any new SDK event reaches the browser and is silently ignored unless `handleAgentEvent` has a case. Currently handled beyond the message lifecycle: `bash_execution_update` (live `!command` output, tail-capped by `PENDING_BASH_OUTPUT_CAP`), `thinking_level_changed` (immediate selector sync), `session_info_changed` (server invalidates the list cache), `entry_appended` (throttled idle-only transcript refresh — the SDK fires it for extension custom entries and cache warming, never for normal streaming). `executeBash` must `ensureEventsConnected(sid)` *before* dispatching the bash command, or the chunks have no stream to arrive on.

## `isRunning()` must consult the SDK's `isIdle`
pi ≥ 0.86 `isIdle` stays false through auto-retry backoff, branch summaries, and queued continuations — states where `isStreaming/isCompacting/isBashRunning` are all false between events. `AgentSessionWrapper.isRunning()` therefore ORs `inner.isIdle === false` into the flag check; dropping it re-introduces mid-retry wrapper eviction (`evictIfDiskAhead`) and premature idle shutdown. `IDLE_RESET_EVENT_TYPES` includes the retry-backoff events for the same reason.

## Idle-session cap (`lib/idle-session-cap.ts`)
Every session the user opens starts a wrapper that the 10-minute idle timer keeps loaded after they leave it; on a real home, opening one 135 MB transcript held ~160 MB of heap for those 10 minutes, and each large session browsed in that window added its own. On top of the timer, `enforceIdleSessionCap()` (`lib/rpc-manager.ts`) runs whenever a wrapper registers and 31 s after one loses its last SSE listener, and shuts down the oldest *unused* wrappers beyond 256 MiB of session-file bytes. The most recently left one is always kept. There is deliberately no session-count limit: 0.8.1 also capped the count at 4, which evicted ordinary small sessions while the user switched among a handful, so each switch back cold-started a wrapper (slower than 0.8.0). Do not re-add a count; the 10-minute idle timer bounds small sessions. `idleCapCandidate()` decides what is unused, and refuses anything that is running (`isRunning()`, so the `isIdle` rule above still holds), has an SSE listener (the selected session keeps one, plus a liveness lease), shows an extension dialog or custom UI, has queued composer messages, is held by a liveness provider, was used in the last 30 s, or has no file on disk yet. `PI_WEB_IDLE_TIMEOUT_MS=0` turns the cap off along with the timer. A capped session reopens on the next request like one the timer shut down.

## Running-state and cross-window propagation
`notifyRunningChange()` fires on `agent_start` as well as `agent_end` (idle → running was never pushed, so other windows' sidebars missed starts), and every `/api/agent/running/events` frame carries `sessionListVersion` — the sidebar refetches the list when the version moves. `session_info_changed` (renames from any window/extension) invalidates the list cache *and* broadcasts a running frame, because that frame is the version's only delivery channel; the running set itself is unchanged.

## Session automation surface (0.86)
`get_state` reports `autoCompactionEnabled`, `autoRetryEnabled`, `steeringMode`, `followUpMode`; the composer's gear popover toggles them through `set_auto_compaction` / `set_auto_retry` / `set_steering_mode` / `set_follow_up_mode`, and `abort_retry` backs the "Cancel retry" link in the retry banner. `useAgentSession.automation` mirrors the four values inside `syncLiveModel` — every get_state path updates them automatically; a new session shows no gear until a wrapper exists (values null). Thinking levels come from `getSupportedThinkingLevels` per model; do not reintroduce a manual DeepSeek xhigh clamp — 0.86 `setThinkingLevel` clamps to `getAvailableThinkingLevels()` itself and a manual `state.thinkingLevel` write bypasses the append/emit path.

## A run that ends on a tool call printed as text is continued (`lib/unparsed-tool-call.ts`, `lib/unparsed-tool-call-extension.ts`)

A small model served from a GGUF file writes the XML tool-call grammar of its chat template badly — the `antml:` namespace gone, `<parameter=path>` closed by `</parameter>`, the call opened by `<tool_call>` and closed by `</function>`. Nothing parses that, so the call stays a `text` block: the assistant message carries **zero** tool calls, the provider reported a normal `stop`, and pi ends the run. The user watches the agent stop mid-thought with its next tool call printed as prose and no explanation (session `2026-11-25T11-25-45Z` is the captured sample the tests pin).

`agent_before_settle` is pi's last actionable boundary — it may append session entries and request one continuation — so the fork extension appends a displayed `pi-web:unparsed-tool-call` custom message naming what the model wrote and asks for one more request. The rules, all in the pure detector:

- The text must *open* with a call marker (`<tool_call`, `<antml:invoke`, `<invoke`, `<function=`, the collapsed `<=read>` a quantized Qwen template emits) **and** carry a `<parameter…>` row, outside any code fence. A message that quotes the format starts with prose and keeps the grammar in a fence, so it never matches — a reply documenting tool calls must not trigger a continuation.
- Only a `completed` outcome is continued. `aborted` is the user's Stop, `error` the provider's; answering either invents work.
- Skip when another handler already asked to continue, and when `context.canContinue` is false (pi reports an invalid boundary continuation otherwise).
- Two continuations per session between two real tool calls (`UNPARSED_TOOL_CALL_BUDGET`); `tool_call` and `agent_start` buy the budget back. A model that keeps printing calls is broken, not unlucky, and a third ask only spends the user's tokens.

The note is `display: true`, so the chat shows *why* the run carried on: a silent continuation reads as the agent ignoring its own stop. `components/MessageView.tsx` names that card through `headerTitle` (`chat.unparsedToolCallTitle`) — not through `formatCustomType`, whose call site `components/MessageView.subagent-report.test.mjs` pins byte-for-byte — and `lib/message-display.ts` makes it a turn anchor, so the printed call stays in the turn it ended. Registered for normal sessions and subagent runs in `lib/rpc-manager.ts`, never for a chat: a chat has no file or shell tool to print (CHAT_DELEGATION policy keeps those tools away).

## Composer send path is single-shot and guarded

The prompt-anchor spacer must subtract the floating composer's separate trailing spacer (`composerOverlaySpacerRef`). Both contribute to the same scroll height; counting the composer clearance twice makes the first streaming tail-follow scroll push the sent message above the viewport.

`ChatInput.handleSend` routes slash commands through `runBuiltinCommand` (the pending-guard wrapper) and sends exactly one `onSend` with the `#session`-mention-resolved text. A merge once left a second raw `onSend(msg, …)` behind it: the first send flips `agentRunningRef`, the second hits the running guard and *restores the just-sent text back into the composer* — every message appeared to "stick". `components/ChatInput.test.mjs` runs the extracted handler in a VM to pin one-send semantics.

## `!command` output renders live, then collapses
The pending bash bubble accumulates `bash_execution_update` deltas into `pendingBash.output` and renders them through `BashExecutionView` as a synthesized partial result, default-expanded while running (`ToolCallBlock defaultExpanded`). When the run finishes the persisted message mounts collapsed like any other tool call — live-watched, then folded, is intentional.

## Stats count standalone usage entries
pi 0.86 cache warming appends `type:"usage"` entries (`kind: "cache_warm"`); `lib/session-stats.ts` folds them in exactly like the SDK's `getSessionStats()`. Skipping them under-reported tokens/cost against the TUI.

## Transcript system messages, usage entries and context edits (pi >= 0.86)
- Every new session's first request persists a `message` entry with `role: "system"` holding the prompt sections and tool declarations; later prompt or tool changes append more. The agent loop announces them with `message_start` / `message_end` like any message. They are provider input, never conversation: `toClientAgentEvent()` drops them before the SSE stream (they carry every tool schema), `handleAgentEvent` skips any that slip through, `entryToUiMessage()` returns null for them, and `BranchNavigator` / `lib/project-tree.ts` never label or preview a branch with one. They still count toward `messageCount` and `totalMessages`, exactly as the SDK counts them.
- `usage` entries (`kind: "cache_warm"`) record prompt-cache warming that is billed but never enters model context. `computeSessionStats()` adds them like compaction usage so the token/cost counters match `/session` in the TUI.
- `context_edit` entries omit or replace an earlier entry's model context without changing raw history; the UI ignores them. A retain-none compaction stores its own id in `firstKeptEntryId`.
- `SessionManager.listAll()` now reads files newest-mtime first (then reverse filename) so `--resume` can render progressively; its stable sort keeps that order for sessions with equal activity time, and `listSessionsIncremental()` reproduces it from the stat fingerprints it already keeps.

## Running state polling + reconciliation
- The sidebar does not poll running state: it subscribes to `/api/agent/running/events` (SSE) and reconnects on `visibilitychange`/`online` and after the stream closes. The session-list response is only the initial fallback until the first SSE frame arrives (`sseAuthoritativeRef`).
- `invalidateSessionListCache()` bumps the generation but **keeps** the previous scan, and the cache is fresh only while its recorded generation matches. Ordinary agent activity invalidates it constantly, and rebuilding costs hundreds of milliseconds because `loadAllSessions()` re-reads every forked and subagent session. Callers that only need metadata — mapping search hits to sidebar rows — pass `listAllSessions({ allowStale: true })` to read the previous scan and let the rebuild happen in the background. A stale scan is a complete catalogue apart from sessions created seconds ago, so those callers accept a brief window where a brand-new session is not yet listed.
- `useAgentSession` treats per-session SSE as primary for chat events and opens it before each prompt. `prompt_done` completes the current UI stage and notification immediately, but the idle SSE stays open for a 30-second grace window and is reused by the next prompt. `agent_start` cancels that close timer; `agent_settled` finishes extension-injected runs that have no wrapper-level `prompt_done` and starts a fresh grace window. Do not close on the first `agent_end`: retries, compaction, and extension-queued messages can continue the same logical prompt.
- While a run is active, `useAgentSession` periodically calls `GET /api/agent/[id]` and also reconciles on `visibilitychange`/`online`. This fixes missed terminal events from background tabs or half-open connections.
- Prompt runs use a monotonic run id; late SSE or slow reconciliation responses from an old run must be ignored so they cannot resurrect stale streaming bubbles.
- Every SSE (re)connection in `useAgentSession` is gated on `sessionHookMountedRef`. React Strict Mode (on by default in `next dev`) re-runs effects in declaration order after a simulated unmount: the mount-only effect's cleanup sets that ref to `false`, and it is only restored when that effect re-runs, *after* the warm-session effect. The warm-session effect therefore re-asserts the ref before `maintainEventsConnected()`. Without it a dev-server tab never opened the event stream on mount or when switching back to a running session, so streamed output and new messages stayed invisible until the 15-second reconcile poll or a page refresh (`next start` was unaffected).

## Per-session scroll restore must be saved before the render-phase reset
Switching sessions resets chat state *during render* (`sessionIdentity !== appliedIdentity` in `useAgentSession`), so the message list is emptied in the same commit — the browser clamps the container's `scrollTop` to 0 before any effect cleanup runs. Saving the position from an effect cleanup therefore records 0 for every switch (which restores as "top of the chat"). The save lives inside the render-phase reset block; an unmount-only cleanup covers ChatWindow remounts (there the DOM is still intact when cleanup runs). Positions and the lazy-load `visibleCount` are cached per session in module-level LRUs (`lib/scroll-memory.ts`): `scrollTop` is a pixel offset into the render window that existed at save time, so `visibleCount` must be restored with it or the offset lands on the wrong message. A viewport at the bottom is deliberately not saved — the restore path then falls back to scroll-to-bottom so users following the tail keep following it.

## The session load must have a deadline
Switching chats does **not** remount `ChatWindow` — `AppShell.handleSelectSession` deliberately keeps `sessionKey` stable so the input dock does not flash. That makes the single `GET /api/sessions/[id]` in `loadSession()` the only thing that ever clears `loading`, and the retry button only appears once the load *fails*. A bare `fetch` there is a hang away from leaving "loading session" on screen permanently, which is exactly what desktop users hit on the first switches after a cold start. It goes through `fetchWithRetry()` (`lib/fetch-timeout.ts`): a hung first attempt is abandoned, then retried once with a longer deadline — the server finishes its cold-start work regardless of the client giving up, so the retry usually lands warm.

## Extension command session actions (`ctx.newSession` / `ctx.fork` / `ctx.switchSession`)
The pi CLI's `AgentSessionRuntime` replaces its single session in place; Pi Web hosts many, so `createExtensionCommandContextActions()` in `lib/rpc-manager.ts` gives the target its own wrapper instead: `newSession` starts one through `startRpcSession()` (with `parentSession`, the source's model/thinking/tool selection, then `setup()` + `refreshContext()`), `fork` writes the file through the same `writeForkedSession()` the browser's Fork uses, and `switchSession` resolves the file's id. The source wrapper is not torn down — it finishes the command that asked for the move — and emits `session_replaced { sessionId }`, which `useAgentSession` follows through `onSessionForked`. `session_before_switch` / `session_before_fork` handlers still cancel, and `withSession` receives the target's `createReplacedSessionContext()`. These used to be stubs returning `{ cancelled: true }`, so commands built on them silently did nothing; `lib/rpc-manager-extension-session-actions.test.mjs` pins the behaviour.

## Exported session HTML
- `/api/sessions/[id]/export` delegates to pi's export helper and returns its HTML unmodified. Since pi 1.5.0 the template walks the session tree iteratively, so very deep linear sessions no longer overflow the browser call stack; do not bring back string patches on the generated HTML, they turn every export into a 500 when the template changes. `app/api/sessions/[id]/export/route.test.mjs` pins this.

## Process details and a compaction card open collapsed, always (`components/ChatWindow.tsx`)
Every `ProcessDetailsGroup` call site passes `defaultExpanded={false}`: a stopped task, a stopped
session and a running turn's older work all fold, and nothing expands them by itself. The turn's
group is keyed on its start index (`process-group-<key>`), so opening it mid-run survives the turn
finishing, and a leaf switch to another group remounts it. A search hit inside still opens it
(`reveal`, which counts as a click). `lib/message-display.ts`'s `collapsesProcessDetails()` (#906,
"stay open under an error notice alone") is no longer used for the decision and has no caller in
the chat — the fork's rule wins over it. The compaction card (`CompactionMessageView`) starts
collapsed and auto-expands nowhere.

A running turn keeps its newest work unfolded: `LIVE_PROCESS_TAIL_BLOCKS = 8` blocks counting from
the end of the turn's process list stay themselves, a compaction card counts as one of them, and
everything older folds into the card (`foldCount`). Only the last group of a running session is a
live tail (`liveTail`), so a finished turn folds all of its process blocks. An unfolded block
carries its own ref (`attachRef = index >= foldCount`), so the turn rail and the search jump keep
finding it; the folded ones' ref lives on the group wrapper.

## One Edited files card per turn, and a live one above the composer (`ChatWindow.tsx`, `TurnWrittenFiles.tsx`)
While a turn runs, the card docked above the composer (`.chat-live-files`) is the turn's file list:
`liveWrittenFiles` gathers the writes of the running turn's messages plus the streaming entry, so
its count and rows grow as the agent works, and it is folded by default. The reply shows no card
while the turn is live (`writtenFiles = liveTail ? undefined : …`); when the turn ends the live
card goes empty and the turn's own card takes over, so a running turn shows one card and a
finished turn shows one. The card sits inside the composer overlay, which the
`--chat-composer-inset` ResizeObserver measures, so the scroll spacer grows with it.

A row opens the file's **diff**, not its content: `onOpenFile(filePath, sessionId)` carries the
session that wrote it. `TurnWrittenFiles` passes its `sessionId`; `AppShell.handleOpenSessionFileDiff`
opens the tab with `modeHint: "diff"` and `diffSessionId` (in `components/file-tab-state.ts`,
carried by `TabBar`).

**The header is a band, and the fold moves.** The header carries the count and the totals and is
the control that opens and closes everything under it, so it is painted as one: the card's own
surface is a 48% wash under the transcript, the rows stay transparent on it, and the header takes
the app's plate recipe (a mostly-opaque `--surface` base with the palette's `--bg-selected` wash
laid over it as a flat gradient — never a `color-mix()` of two colours, which leaves a
half-transparent layer the page shows through). A hover takes `--bg-hover` over a stronger base,
so the control answers.

The rows are **not** added to and removed from the DOM any more: the list stays mounted inside
`.turn-files-list` (`display: grid`) whose `grid-template-rows` animates `0fr → 1fr`, with
`.turn-files-list-inner` clipping (`overflow: hidden; min-height: 0`) and the rows fading with
the track. That mechanism is chosen for the runtime, not taste: `interpolate-size: allow-keywords`
and `calc-size()` are the newer way to animate a height to `auto` and are **Chromium-only**, so on
the desktop's WKWebView and on a phone the card would jump; `grid-template-rows` animates on
Chromium and WebKit, measured mid-flight on both by `e2e/turn-files-animation.mjs`. Folded, the
list is `inert`, so the clipped rows leave the tab order and the accessibility tree
(`components/TurnWrittenFiles.open-diff.test.mjs` now pins "folded" as clipped + inert, not
absent); `prefers-reduced-motion: reduce` drops the height motion and keeps the two end states and
the hover tint.

## An assistant reply's content list is dense (`lib/assistant-content.ts`)
Much of the chat walks a reply's blocks with `for…of`, `.some`, spread — loops that do **not** skip
holes in a sparse array — so one slot with no block in it throws `undefined is not an object
(evaluating 'block.type')` and takes the window down; `.filter`/`.map` skip holes, which is why
only some screens broke. Holes are reachable: pi's provider builders and this app's streaming
reducer assign `content[contentIndex]`, so a block met late (a stream resumed mid-run, a `*_end`
that lands after `message_start` reset the bubble) grows the array past its end, and a JSON round
trip turns such a hole into `null`. `fillContentGaps` returns a dense copy at the same length, with
`emptyTextBlock()` (what a `*_start` already puts in a block before its first delta: it renders and
scans as nothing) in every empty slot; positions are kept because the wire numbers its deltas by
content index. `normalizeToolCalls` runs it on every message entering client state (session reads,
`message_end`, a reconnect seed) and `updateContentBlock` keeps the streaming entry dense;
`extractTurnWrittenFiles`, `getTurnWrittenFiles`/`liveWrittenFiles` and `MessageView` apply it as a
guard, since a session file is not ours to fix.

## The diff of a file as one session made it (`lib/session-file-diff.ts`, `GET /api/sessions/[id]/file-diff`)
The card counts what the session's own `write` / `edit` / `apply_patch` calls changed, and a change
the agent committed (or that the session made and the working tree no longer carries) has no git
diff, so the panel used to show the file with no diff at all. The route reads the session (a live
`AgentSessionWrapper` first, then the file) and rebuilds one file section: an `edit`'s
`details.patch` verbatim, pi's numbered `details.diff` as context/added/removed lines, an `edit`
with no details from its `oldText` / `newText` (context trimmed to the change), a `write` as an
added file, an `apply_patch` through `applyPatchPreviewToFiles` (the parser the tool card uses), in
call order, one `--- / +++` header, one hunk per call. Counts come from the hunks
(`countPatchLines`), and a synthesized hunk's header says `@@ session change +N @@` because the
line numbers of a chain of edits are not knowable from the records. A call with no result, an
errored result, or a path that resolves to another file is skipped; the path must be absolute and
the session's `cwd` resolves a call's relative path.
`FileViewer` takes `diffSessionId`: its diff view shows that patch under a sticky
`.file-diff-source-note` naming the count, and when the working tree has its own diff the toolbar
switches between **Working-tree changes** and **Changes in this session** (`preferGitDiff`, reset
with the file). The session record is the default: it is the number the row was built from.

## A long prompt is a scroll box, and Expand shows it whole (`CollapsibleUserText`, `components/MessageView.tsx`)
Collapsed, the prompt is `maxHeight: USER_TEXT_COLLAPSE_HEIGHT` (660px — three times the 220px it
started at: the box exists so a long prompt is readable without pressing **Expand**, and 220px
showed a task's first four lines and a fade) with `overflowY: "auto"` — readable
through its cap without pressing anything; the bottom fade only marks a box that is not scrolled to
its end (`scrolledToEnd`). The bubble's own cap (`USER_BUBBLE_MAX_HEIGHT`, 900px) stays above the
text cap, because a bubble shorter than the box scrolls the bubble and leaves the text capped.
**Expand** removes the cap and the scroll, and tells the bubble
(`onExpandedChange` → `promptExpanded`), because the bubble owns `USER_BUBBLE_MAX_HEIGHT` and
`overflowY`: a scroll box inside a capped bubble cannot grow, so the cap has to be lifted where it
lives. **Collapse** puts the box back. The toggle stays visible while expanded: the measurement is
`scrollHeight > cap + 60` on the content, which stays true with no cap.

### An Expand/Collapse anchors the row it grows (`handleContentToggle`, `components/ChatWindow.tsx`)
A row that grows does it under the finger, and the reader was left in two bad places: the bubble
opening mid-conversation moved out of the viewport, and a reader near the tail handed the
viewport to the stream's tail-follow (`useAgentSession`'s `isNearBottom` → `scrollToBottom`),
which snapped the conversation to its end — "clicking Expand sends the page to the bottom".
So every Expand/Collapse (a long prompt, a slash command, a compaction note, a subagent report)
calls `onContentToggle(control, entryId)` **before** it flips its own state, and ChatWindow
anchors the tapped row with the prepend's own mechanism (`scrollAnchorRef`, `applyScrollAnchor`,
the shared `CHAT_SCROLL_ANCHOR_WINDOW_MS`), re-applying at 200 ms and 450 ms because a bubble
whose cap is lifted keeps settling. The prop from ChatWindow is one stable callback and the row's
`entryId` is bound per row (`notifyContentToggle`) — an inline arrow there re-renders every
message on every ChatWindow render, which the memo comparator is written to prevent. Two rules:
never `scrollIntoView` a control from this handler (it fights the anchor over `scrollTop` and
lands the reader at the tail), and return early when the control is off screen — the finger
cannot have pressed it, and moving the page from there is the app moving the page. Pinned by
`components/ChatWindow.content-toggle.test.mjs`.

## No RegExp lookbehind may reach a bundle (`lib/gfm-autolink-email-loader.cjs`, #753)
`mdast-util-gfm-autolink-literal` (through `remark-gfm`, from `lib/markdown.ts`) gates
autolinking with lookbehind, which Safari parses only from 16.4; a regex literal Safari
cannot parse is a SyntaxError for the whole chunk, and this module is in the first load of
`/`, so old iOS showed a blank page. `next.config.ts` runs the loader over the package's
`lib/index.js` (Turbopack's `webpackLoaders` rule and the webpack rule). The loader rewrites
**every** regex literal in that module that contains a lookbehind — 2.0.1 ships one, 2.1.x
ships four (the URL regex and the `xmpp:` / `mailto:` / bare email regexes) — replacing each
with a runtime construction: the modern regex is built from its source string (a browser
without lookbehind fails at construction, which is catchable, not at parse time), and the
fallbacks are the same pattern with its lookbehind groups removed, keeping the flags. Dropping
a lookbehind only widens where a match may start; `findAndReplace` and the handlers reject what
they do not want. The loader throws when a lookbehind literal survives its own rewrite, so the
build fails loudly instead of shipping a chunk old Safari cannot parse: an app that opens is
the requirement, and `npm run dev` dying with "Error evaluating Node.js code" is the symptom
this guard prevents. When the installed tree resolves a newer 2.x than the lockfile's 2.0.1,
the loader follows the package, not the lockfile — check the package's lookbehinds, do not
pin the loader to one version's text.

## A turn's length, and the time on each reply
`lib/turn-duration.ts` measures a finished turn from its anchor (the user's message, a
compaction summary, a subagent completion) to the last response or tool result in it, and
`ChatWindow` keys the result to the reply that closes the turn (`turnDurationByIndex`);
`MessageView` shows it in the footer between Copy and the timestamp as
`[clock] 1h50m` (`formatTurnDurationCompact` — the compact shape a footer is read at;
the tooltip keeps the notification's full `0h50m12s`, `formatDurationHms`). Two rules
keep it honest and always present:
- A background subagent's report is the task working, **not** an idle wait. A custom
  message from an extension that started a later run (`triggerTurn`) is a gap and is
  subtracted; `pi-web:subagent-notification` is not, and it extends the turn. A turn that
  spent an hour waiting for a subagent reports the hour.
- The anchor's timestamp is all a turn needs. A reply with no `durationMs` (a provider
  that reports none, a session written before pi 1.1) ends where it started — the honest
  floor, so the footer carries the task's length instead of nothing. Only an anchor with
  no time leaves the footer blank.
Every assistant reply also carries its own time next to its model name
(`.message-assistant-model-time`, `formatTime`), so a run read in Process details is dated
line by line; the footer's sparser `showTimestamp` rule is unchanged.
Pinned by `lib/turn-duration.test.mjs`, `components/MessageView.turn-duration.test.mjs`
and `components/MessageView.subagent-report.test.mjs`.

## Run liveness: a stuck run says so, and a long one does not (`lib/agent-run-liveness.ts`)

A session can report itself busy forever, correctly. The SDK keeps `isStreaming` true and the
wrapper's prompt promise outstanding while the provider request that was to answer never does
(a socket the provider stopped feeding, a stdio MCP server hung in `before_agent_start`, an
extension awaiting a promise nobody resolves). SSE heartbeats keep flowing — they are this
app's own 30 s timer, not the model's — so the browser reconnects happily, reconciles against
`get_state`, is told "busy", and prints `Waiting for model…` for hours. Nothing in the flags
separates that from a slow request; **the run's own events do**, and only they are counted.

- **Progress** is an SDK event in `AGENT_PROGRESS_EVENT_TYPES` (message, tool, bash, compaction,
  retry, turn). `agent_start` / `agent_end` / `agent_settled` / `prompt_done` are boundaries, not
  progress, and a heartbeat is a transport keep-alive that counts nowhere.
- **Phase** (`agentRunPhase`) is read from the wrapper's live flags: `awaiting_input` (a blocking
  extension dialog), `bash`, `tool`, `compaction`, `retry_backoff`, `mcp_wait`, `waiting_model`,
  `prompt_admission`. A tool outranks the streaming turn it lives in; a dialog outranks everything.
- Only `waiting_model`, `mcp_wait` and `prompt_admission` are **stall-eligible**: the wait belongs
  to a request the app cannot see inside. A command, a compaction, a retry backoff, an unanswered
  dialog and a subagent's report are untouched however long they last — their length is not
  evidence of a hang, and a command is bounded by its own timeout (next section).
- After `PI_WEB_RUN_STALL_NOTICE_MS` (default 5 min) of silence the wrapper emits
  **`agent_stalled`** `{ phase, noProgressMs, at }` once per run and logs a `console.warn`. The wire
  forwards it (whitelist-by-omission), `useAgentSession` mirrors it into `runStall`, and the
  composer's status line names the phase with the silence attached (`chat.stalledModel` …) in the
  palette's warning ink with the running pulse stopped (`.chat-phase-stalled`). It is cleared at
  `agent_start`, `agent_end`, `agent_settled`, `prompt_done` and on a session switch, and a state
  read that reports movement clears it — so a reconnecting page learns the stall from
  `get_state.runLiveness` alone. It changes no run state and emits no lifecycle event.
- `PI_WEB_RUN_STALL_ABORT_MS` (default **0** — off) additionally stops the run through the session's
  own `abort` command, i.e. the browser's Stop: the composer outbox pauses, parked prompts return,
  extension UI unwinds, the SDK's own `agent_end`/`agent_settled` close the run, and exactly one
  completion notification goes out. Never a second abort for the same run; the clock resets at the
  next `agent_start`, so a recovered session answers the next prompt.
- `get_state.runLiveness` and `getDebugSnapshot().liveness` carry `{ phase, lastProgressAt,
  noProgressMs, stalledMs, noticeMs, abortMs }`; the Debug panel is where a stall is read after the fact.

A silent half-open event stream is the client's half of the same failure. `AgentEventConnection`
has always had `staleAfterMs`, and `useAgentSession` now passes `AGENT_EVENT_HEARTBEAT_MS * 3`:
a ready stream that delivered nothing at all for three heartbeats is dead (half-open TCP, a proxy
that dropped it, a phone whose tab the browser froze — `EventSource` reports none of those), so it
reconnects and re-snapshots. The 15 s reconciliation stays the net for missed terminal events.

Pinned by `lib/agent-run-liveness.test.mjs` (phases, progress, thresholds, one-escalation) and
`lib/rpc-manager-run-liveness.test.mjs` (normal run, hung request, six hours of streaming, an
hour-long tool, a parked dialog, the opt-in stop and the run after it, a lost `agent_end`, a lost
`agent_settled`, late events, Stop mid-request, a compaction).

## Commands are bounded (`lib/command-timeout.ts`, `lib/project-command-env.ts`)

pi's shell tool has **no default timeout**: a command that never returns (a test runner waiting
on a server it started, a browser it never closed, a `watch` mode) holds the agent run, the
composer and the window. Measured in a real session: one hung `node e2e/…` occupied a run for
**7849 seconds**. So the fork's shell tool names a default in the `timeout` parameter description
the model reads (pi's own text promises the opposite, and a model that believes it never passes
one) and applies it when the model left `timeout` out — `PI_WEB_COMMAND_TIMEOUT_MS`, default 30
minutes, `0` restores pi's behaviour. The default goes *into* the spawn, so pi kills the process
tree at the deadline; the operations' existing grace (`#647`) then bounds a descendant the kill
missed, and its grace timer is `unref`ed so it can never hold a quitting process. The model's own
timeout always wins, longer or shorter: a long build is not a hang. Both entry points are covered
— the tool (`createProjectCommandBashExtension`) and the composer's `!command`
(`createProjectCommandBashOperations`). Pinned by `lib/command-timeout.test.mjs` and the added
cases in `lib/project-command-env.test.mjs`.
