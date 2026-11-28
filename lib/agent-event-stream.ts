import {
  AGENT_EVENT_HEARTBEAT_MS,
  isEventIncludedInSnapshot,
  toClientAgentEvent,
  type AgentEventLike,
} from "./agent-event-wire";
import { createToolUpdateEncoder } from "./tool-update-delta";
import { capEventPayloadJson, resolveMaxEventPayloadBytes } from "./event-payload-limit";
import { deferLiveMessageContent } from "./deferred-message-content";
import type { AgentMessage } from "./types";
import { isRecord } from "./is-record.ts";
import type { DebugEventStream } from "./debug-types";
import { errorMessage } from "./errors.ts";

/**
 * What the stream needs from a session. `leafEntry` is what Phase 5 uses to name
 * the entry a finished message became: the SDK appends a `message_end` message
 * to the session synchronously after its listeners run, so the leaf of the
 * branch one microtask later *is* that message. When it is not (a custom entry
 * landed in between, an older SDK), the message keeps its full payload: a card
 * that can never expand is worse than bytes on the wire.
 */
export interface AgentEventStreamSession {
  readonly isStreaming: boolean;
  readonly streamingMessage: unknown;
  isAlive?(): boolean;
  onEvent(listener: (event: AgentEventLike) => void): () => void;
  leafEntry?(): { id: string; type: string; role?: string } | null;
}

/** Per-connection stream options (the client negotiates the first two). */
export interface AgentEventStreamOptions {
  /** Send `tool_execution_update` as deltas (the client asked with `?toolUpdates=delta`). */
  deltaToolUpdates?: boolean;
  /** Per-event serialized budget; default `PI_WEB_MAX_EVENT_PAYLOAD_BYTES` or 1 MiB. */
  maxEventPayloadBytes?: number;
  /** Turn the live deferred projection off (the client asked with `?liveDefer=off`). */
  deferLiveContent?: boolean;
}

/**
 * Backpressure for one SSE connection. The client is often a phone: when it
 * stops reading (screen off, backgrounded tab, flaky network) every event we
 * keep enqueueing stays in this process.
 *
 *  - above STREAM_HIGH_WATER_MARK_BYTES we drop events a later event repairs
 *    (streaming deltas, partial tool output);
 *  - above the backlog limit we terminate the stream instead, so the client
 *    reconnects and re-snapshots.
 *
 * Measured before this: a single 24 MB command with a client that stopped
 * reading left 22.7 MB queued here, and that memory only comes back with a GC
 * this app never triggers (issue #923).
 *
 * The limit also has to absorb what a healthy client on a slow link has in
 * flight: one `read` of an image emits its base64 in the tool result's
 * `message_end` (its `message_start` goes as the role only), and that queues
 * up while earlier events are still being written to the socket.
 */
const STREAM_HIGH_WATER_MARK_BYTES = 512 * 1024;
const DEFAULT_BACKLOG_LIMIT_BYTES = 16 * 1024 * 1024;
const BACKPRESSURE_LOG_INTERVAL_MS = 60_000;
let lastBackpressureLogAt = 0;

/**
 * How long `tool_execution_update` events wait to be coalesced. Each update
 * carries the tool's whole partial result, so only the latest one per tool call
 * matters: a codemode script publishes a snapshot of every call it made each
 * time one starts or ends, and bash streams its output tail per chunk. A burst
 * inside the window reaches the client as one event per tool call.
 */
export const TOOL_UPDATE_COALESCE_MS = 150;

/**
 * Whether a later event repairs this one if it is dropped. A `*_delta` only
 * extends a block that its `*_end` replaces with the authoritative content, and
 * `tool_execution_update` carries the whole partial result, which the next update
 * or `tool_execution_end` supersedes. `*_start` / `*_end` are never dropped: the
 * client's stream reducer creates and finalizes blocks from them.
 */
function isDroppableEvent(event: AgentEventLike): boolean {
  if (event.type === "tool_execution_update") return true;
  if (event.type !== "message_update") return false;
  const update = event.assistantMessageEvent;
  return typeof update === "object"
    && update !== null
    && typeof (update as { type?: unknown }).type === "string"
    && (update as { type: string }).type.endsWith("_delta");
}
function resolveBacklogLimitBytes(): number {
  const raw = Number(process.env.PI_WEB_SSE_BACKLOG_LIMIT_BYTES);
  return Number.isFinite(raw) && raw >= 64 * 1024 ? raw : DEFAULT_BACKLOG_LIMIT_BYTES;
}

function logBackpressure(
  sessionId: string,
  queuedBytes: number,
  limitBytes: number,
  droppedEvents: number,
  closing: boolean,
): void {
  const now = Date.now();
  if (now - lastBackpressureLogAt < BACKPRESSURE_LOG_INTERVAL_MS) return;
  lastBackpressureLogAt = now;
  const queued = `${Math.round(queuedBytes / 1024)} KB`;
  console.warn(closing
    ? `[pi-web] Agent event stream for ${sessionId} closed: client backlog ${queued} exceeds ${Math.round(limitBytes / 1024)} KB; it reconnects and re-snapshots.`
    : `[pi-web] Agent event stream for ${sessionId} is behind (${queued} queued): dropping rebuildable deltas (${droppedEvents} so far).`);
}

/**
 * Registry of live SSE streams, closed from the SIGINT/SIGTERM hook in
 * instrumentation.ts.
 *
 * In production Next 16 handles those signals with `server.close()` and waits
 * for every connection to end, with no timeout and no `closeAllConnections`
 * (that call is dev-only in next/dist/server/lib/start-server.js). An SSE
 * stream only ends when the client disconnects, so without this the process
 * stops listening (502 upstream) but never exits.
 *
 * instrumentation.ts and the route handlers are bundled into separate module
 * graphs, each with its own copy of this module; a plain module-level Set
 * would be two disconnected registries. Symbol.for + globalThis shares one.
 */
const CLOSER_REGISTRY: symbol = Symbol.for("pi-web.agentEventStreamClosers");
type StreamCloser = (closeController: boolean | "error") => void;
const activeStreamClosers: Set<StreamCloser> =
  ((globalThis as Record<symbol, Set<StreamCloser>>)[CLOSER_REGISTRY] ??= new Set<StreamCloser>());

/**
 * What the debug panel lists of each live stream, keyed by its closer. A registry of its own:
 * older module copies share the closer Set's shape, and a stream opened before a hot reload of
 * this file is counted there but not listed here.
 */
const STREAM_INFO_REGISTRY: symbol = Symbol.for("pi-web.agentEventStreamInfos");
interface AgentEventStreamInfo {
  sessionId: string;
  holder: string | null;
  address: string | null;
  client: string | null;
  openedAt: number;
  connectedAt: number | null;
  lastWriteAt: number | null;
  droppedEvents(): number;
  queuedBytes(): number;
  /** Events cut to the per-event payload budget (Phase 7). */
  cappedEvents?(): number;
  /** Live messages projected to deferred thinking/media (Phase 5). */
  deferredAppends?(): number;
  /** Whether this connection negotiated delta tool updates (Phase 7). */
  deltaToolUpdates?: boolean;
}
const streamInfos: Map<StreamCloser, AgentEventStreamInfo> =
  ((globalThis as Record<symbol, Map<StreamCloser, AgentEventStreamInfo>>)[STREAM_INFO_REGISTRY] ??= new Map());

/** Close every live SSE stream (called on process shutdown signals). */
export function closeAllAgentEventStreams(): void {
  for (const close of [...activeStreamClosers]) {
    try { close("error"); } catch { /* stream already closed */ }
  }
}

/** The live streams, for the debug panel: times and counts, never the request or a payload. */
export function listAgentEventStreams(): (DebugEventStream & { sessionId: string })[] {
  const listed: (DebugEventStream & { sessionId: string })[] = [];
  for (const info of streamInfos.values()) {
    try {
      listed.push({
        sessionId: info.sessionId,
        holder: info.holder,
        address: info.address,
        client: info.client,
        openedAt: info.openedAt,
        connectedAt: info.connectedAt,
        lastWriteAt: info.lastWriteAt,
        droppedEvents: info.droppedEvents(),
        queuedBytes: info.queuedBytes(),
        cappedEvents: info.cappedEvents?.(),
        deferredAppends: info.deferredAppends?.(),
        deltaToolUpdates: info.deltaToolUpdates,
      });
    } catch {
      // An entry another version of this file left behind.
    }
  }
  return listed;
}

/** Every live agent event stream, those opened before a hot reload of this file included. */
export function countAgentEventStreams(): number {
  return activeStreamClosers.size;
}

/**
 * Open the SSE transport immediately, then publish the session snapshot only
 * after the agent is ready and its event listener has been installed.
 * `meta` (the page's id, the request's reported address and browser label) only labels the
 * stream for the debug panel.
 */
export function createAgentEventStream(
  req: Request,
  sessionId: string,
  sessionPromise: Promise<AgentEventStreamSession>,
  meta?: { holder?: string | null; address?: string | null; client?: string | null },
  options?: AgentEventStreamOptions,
): ReadableStream<Uint8Array> {
  let cancelStream: (closeController: boolean | "error") => void = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;
      let abortHandler: (() => void) | null = null;
      // Latest `tool_execution_update` per tool call id, waiting for the flush.
      const pendingToolUpdates = new Map<unknown, AgentEventLike>();
      let toolUpdateTimer: ReturnType<typeof setTimeout> | null = null;
      // Phase 7: this connection's delta baseline (what *this* browser was last given).
      const toolUpdateEncoder = options?.deltaToolUpdates ? createToolUpdateEncoder() : null;
      // Phase 7: the per-event serialized budget. 0 turns it off.
      const maxEventPayloadBytes = options?.maxEventPayloadBytes
        ?? resolveMaxEventPayloadBytes(process.env.PI_WEB_MAX_EVENT_PAYLOAD_BYTES);
      // Phase 5: project a finished live message the way history projects its entries.
      const deferLiveContent = options?.deferLiveContent !== false;
      let cappedEvents = 0;
      let deferredAppends = 0;
      let streamSession: AgentEventStreamSession | null = null;
      // A finished message is forwarded one microtask late: that is when the SDK
      // has appended it, so its entry id (the pointer the deferred content is
      // fetched by) is knowable. Events that arrive in the meantime wait too.
      const pendingAppends: { event: AgentEventLike; leafIdBefore: string | null; role: string }[] = [];
      const gatedEvents: AgentEventLike[] = [];
      let appendFlushQueued = false;

      // "error": hard-terminate the response (SSE client sees a broken
      // stream and reconnects). Used on process shutdown: a plain close() is
      // swallowed by the Next/Node response pipeline without emitting a
      // chunked termination, so the socket stays ESTABLISHED and Next's
      // server.close() drain never completes (the original zombie bug).
      // Also used when a client stops consuming: a graceful close() there
      // would leave the socket (and the queued backlog) alive.
      // "true": graceful close after we finished writing a final event.
      const cleanup = (closeController: boolean | "error", reason?: Error) => {
        if (closed) return;
        closed = true;
        activeStreamClosers.delete(cleanup);
        streamInfos.delete(cleanup);
        if (heartbeat !== null) clearInterval(heartbeat);
        if (toolUpdateTimer !== null) clearTimeout(toolUpdateTimer);
        pendingToolUpdates.clear();
        pendingAppends.length = 0;
        gatedEvents.length = 0;
        unsubscribe?.();
        unsubscribe = null;
        if (abortHandler) req.signal.removeEventListener("abort", abortHandler);
        if (closeController === "error") {
          try { controller.error(reason ?? new Error("pi-web server shutting down")); } catch { /* already closed */ }
        } else if (closeController) {
          try { controller.close(); } catch { /* stream already closed */ }
        }
      };
      cancelStream = cleanup;
      activeStreamClosers.add(cleanup);

      const backlogLimitBytes = resolveBacklogLimitBytes();
      let droppedEvents = 0;
      const info: AgentEventStreamInfo = {
        sessionId,
        holder: meta?.holder ?? null,
        address: meta?.address ?? null,
        client: meta?.client ?? null,
        openedAt: Date.now(),
        connectedAt: null,
        lastWriteAt: null,
        droppedEvents: () => droppedEvents,
        queuedBytes: () => Math.max(0, STREAM_HIGH_WATER_MARK_BYTES - (controller.desiredSize ?? STREAM_HIGH_WATER_MARK_BYTES)),
        cappedEvents: () => cappedEvents,
        deferredAppends: () => deferredAppends,
        deltaToolUpdates: Boolean(toolUpdateEncoder),
      };
      streamInfos.set(cleanup, info);
      const enqueueText = (text: string, options?: { droppable?: boolean; onDrop?: () => void }) => {
        if (closed) return;
        const desiredSize = controller.desiredSize;
        if (desiredSize === null) {
          cleanup(false);
          return;
        }
        const queuedBytes = STREAM_HIGH_WATER_MARK_BYTES - desiredSize;
        if (options?.droppable && queuedBytes > STREAM_HIGH_WATER_MARK_BYTES) {
          droppedEvents += 1;
          options.onDrop?.();
          logBackpressure(sessionId, queuedBytes, backlogLimitBytes, droppedEvents, false);
          return;
        }
        if (queuedBytes > backlogLimitBytes) {
          logBackpressure(sessionId, queuedBytes, backlogLimitBytes, droppedEvents, true);
          cleanup(
            "error",
            new Error(`pi-web agent event stream closed: client backlog exceeded ${Math.round(backlogLimitBytes / 1024)} KB`),
          );
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
          info.lastWriteAt = Date.now();
        } catch {
          cleanup(false);
        }
      };
      const encode = (
        data: unknown,
        options?: { droppable?: boolean; onDrop?: () => void; entryId?: string },
      ) => {
        const json = JSON.stringify(data);
        let text = `data: ${json}\n\n`;
        // Phase 7: one event is bounded, structurally, before it is allocated on
        // the socket. Cutting is recorded on the event, so the page can say so.
        if (maxEventPayloadBytes && text.length > maxEventPayloadBytes) {
          const capped = capEventPayloadJson(data, json, {
            limitBytes: maxEventPayloadBytes,
            sessionId,
            entryId: options?.entryId,
          });
          if (capped) {
            text = `data: ${capped.json}\n\n`;
            cappedEvents += 1;
          }
        }
        enqueueText(text, options);
      };
      const flushToolUpdates = () => {
        toolUpdateTimer = null;
        const updates = [...pendingToolUpdates.values()];
        pendingToolUpdates.clear();
        for (const update of updates) {
          // The delta is computed against what the client was last *given*, so it
          // is computed here, after coalescing, not when the event arrived.
          const wire = toolUpdateEncoder ? toolUpdateEncoder.encode(update) : update;
          encode(wire, {
            droppable: true,
            // A dropped delta leaves a hole: forget this call's baseline so the
            // next update goes out whole. Deltas stay droppable under backpressure.
            onDrop: () => toolUpdateEncoder?.invalidate((update as AgentEventLike).toolCallId),
          });
        }
      };
      const flushAppends = () => {
        appendFlushQueued = false;
        if (closed) {
          pendingAppends.length = 0;
          gatedEvents.length = 0;
          return;
        }
        const leafNow = streamSession?.leafEntry?.() ?? null;
        for (let index = 0; index < pendingAppends.length; index += 1) {
          const pending = pendingAppends[index];
          // Only a leaf that moved, is a message entry, and carries this message's
          // role names the entry. Anything else keeps the message whole.
          const entryId = index === pendingAppends.length - 1
            && leafNow
            && leafNow.id !== pending.leafIdBefore
            && leafNow.type === "message"
            && leafNow.role === pending.role
            ? leafNow.id
            : undefined;
          if (!entryId) {
            sendClientEvent(pending.event);
            continue;
          }
          const { message, deferred } = deferLiveMessageContent(pending.event.message as AgentMessage, {
            sessionId,
            entryId,
          });
          if (deferred.thinkingBlocks > 0 || deferred.imageBlocks > 0) deferredAppends += 1;
          sendClientEvent({
            ...pending.event,
            entryId,
            message,
            // Tells the page the message it is being handed is a projection: a
            // card that was showing streamed content re-reads it from the entry.
            ...(deferred.thinkingBlocks > 0 || deferred.imageBlocks > 0 ? { deferredContent: true } : {}),
          });
        }
        pendingAppends.length = 0;
        for (const event of gatedEvents.splice(0)) {
          const clientEvent = toClientAgentEvent(event);
          if (clientEvent) sendClientEvent(clientEvent);
        }
      };
      const sendClientEvent = (clientEvent: AgentEventLike) => {
        if (clientEvent.type === "tool_execution_update") {
          pendingToolUpdates.set(clientEvent.toolCallId, clientEvent);
          toolUpdateTimer ??= setTimeout(flushToolUpdates, TOOL_UPDATE_COALESCE_MS);
          return;
        }
        // The end supersedes a partial result still waiting here, and the client
        // would treat one arriving after the end as a tool that is running again.
        // agent_end does the same for any tool call whose end never came.
        if (clientEvent.type === "tool_execution_end") {
          pendingToolUpdates.delete(clientEvent.toolCallId);
          // The call is over: its delta baseline is worthless, and a long run of
          // short calls must not leave one baseline per call behind.
          toolUpdateEncoder?.invalidate(clientEvent.toolCallId);
        } else if (clientEvent.type === "agent_end") {
          pendingToolUpdates.clear();
        }
        // The entry id the append flush attached is what lets a payload-cut tool
        // result name the route that serves its full text (Phase 7 + Phase 5).
        encode(clientEvent, {
          droppable: isDroppableEvent(clientEvent),
          entryId: typeof clientEvent.entryId === "string" ? clientEvent.entryId : undefined,
        });
      };
      const forwardEvent = (event: AgentEventLike, snapshot: unknown) => {
        if (isEventIncludedInSnapshot(event, snapshot)) return;
        // A finished message is waiting for its entry id: keep the producer's order.
        if (pendingAppends.length > 0) {
          gatedEvents.push(event);
          return;
        }
        const clientEvent = toClientAgentEvent(event);
        if (!clientEvent) return;
        if (
          deferLiveContent
          && clientEvent.type === "message_end"
          && isRecord(clientEvent.message)
          && typeof clientEvent.message.role === "string"
          && clientEvent.message.role !== "system"
        ) {
          const leaf = streamSession?.leafEntry?.() ?? null;
          pendingAppends.push({
            event: clientEvent,
            leafIdBefore: leaf?.id ?? null,
            role: clientEvent.message.role as string,
          });
          if (!appendFlushQueued) {
            appendFlushQueued = true;
            queueMicrotask(flushAppends);
          }
          return;
        }
        sendClientEvent(clientEvent);
      };

      const publishSession = async () => {
        try {
          const session = await sessionPromise;
          if (closed) return;
          if (session.isAlive && !session.isAlive()) {
            cleanup(true);
            return;
          }

          const bufferedEvents: AgentEventLike[] = [];
          let snapshotPublished = false;
          const handleEvent = (event: AgentEventLike) => {
            if (event.type === "session_shutdown") {
              cleanup(true);
              return;
            }
            if (!snapshotPublished) {
              bufferedEvents.push(event);
              return;
            }
            forwardEvent(event, snapshot);
          };

          const stopListening = session.onEvent(handleEvent);
          if (closed) {
            stopListening();
            return;
          }
          if (session.isAlive && !session.isAlive()) {
            stopListening();
            cleanup(true);
            return;
          }
          unsubscribe = stopListening;
          streamSession = session;

          const snapshot = session.streamingMessage;
          encode({
            type: "connected",
            sessionId,
            isStreaming: session.isStreaming,
            // onEvent() has just replayed every request the session still holds,
            // so a reconnecting client can drop the ones closed while it was away.
            pendingExtensionUiIds: bufferedEvents
              .filter((event) => event.type === "extension_ui_request" && typeof event.id === "string")
              .map((event) => event.id as string),
          });
          info.connectedAt = Date.now();
          for (const event of bufferedEvents) forwardEvent(event, snapshot);
          if (snapshot !== undefined && snapshot !== null) {
            forwardEvent({ type: "message_start", message: snapshot }, undefined);
          }
          snapshotPublished = true;
        } catch (error) {
          if (closed) return;
          encode({
            type: "startup_error",
            errorMessage: `Failed to start agent: ${errorMessage(error)}`,
          });
          cleanup(true);
        }
      };

      // Attach the rejection handler before checking the request signal. The
      // route may already have started a shared cold-start promise.
      void publishSession();

      abortHandler = () => cleanup(true);
      if (req.signal.aborted) {
        cleanup(true);
        return;
      }
      req.signal.addEventListener("abort", abortHandler, { once: true });

      heartbeat = setInterval(() => encode({ type: "heartbeat" }, { droppable: true }), AGENT_EVENT_HEARTBEAT_MS);

      // Force the response headers through without claiming that the agent is
      // ready. The client waits for the later `connected` data event.
      enqueueText(":\n\n");
    },
    cancel() {
      cancelStream(false);
    },
  }, {
    highWaterMark: STREAM_HIGH_WATER_MARK_BYTES,
    size: (chunk) => chunk.byteLength,
  });
}
