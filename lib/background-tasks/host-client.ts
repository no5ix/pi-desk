/**
 * The pi-desk side of `pi-background-tasks`' host interface.
 *
 * One client per live session's EventBus, because that is the bus the extension's
 * activation listens on. The client owns exactly what the contract makes the host own:
 *
 * - a **lease** (`subscribe` with a stable `clientId`), taken lazily and retaken when the
 *   service says the lease is dead;
 * - a **strictly increasing sequence** per lease, handed out by one queue so two concurrent
 *   React refreshes can never publish the same sequence (a reused sequence is a `CONFLICT`,
 *   and a sequence at or below the high-water mark is a `STALE_REQUEST` that is never
 *   executed again — so a client that raced would silently get nothing);
 * - **`request_id` correlation**: exactly one response frame is matched per request, and a
 *   frame for a request this client is not waiting on is dropped;
 * - **change-feed de-duplication**: a `(activationId, revision)` pair is delivered once, so a
 *   burst of registry changes coalesced by the service into one 100 ms frame — and any frame
 *   redelivered after a resubscribe — refreshes the list once;
 * - **bounded requests**: a deadline per operation, and no request at all after `dispose()`.
 *
 * `capabilities` is answered at any time while the activation is open; every other operation
 * needs the session context the extension's first `session_start` supplies, and answers
 * `UNAVAILABLE` before that. A successful extension load therefore does not mean the host
 * interface is ready — the ready state here comes from the `ready` frame, and `UNAVAILABLE`
 * is reported as "not ready yet", never as a broken panel.
 */

import {
  BG_HOST_CHANGED_CHANNEL,
  BG_HOST_MAX_LOG_BYTES,
  BG_HOST_MAX_PAGE_SIZE,
  BG_HOST_REQUEST_CHANNEL,
  BG_HOST_RESPONSE_CHANNEL,
  BG_HOST_RETRYABLE_CODES,
  bgHostRequestFrame,
  parseBgChangedFrame,
  parseBgResponseFrame,
  type BgCapabilities,
  type BgChangedFrame,
  type BgDetailResult,
  type BgHostErrorCode,
  type BgListResult,
  type BgLogsResult,
  type BgMarkSeenResult,
  type BgHostOperation,
  type BgRerunResult,
  type BgStopAllResult,
  type BgStopResult,
  type BgSubscribeResult,
} from "./protocol";

/** The SDK's `EventBus`, restated so this module stays free of a runtime SDK import. */
export interface EventBusLike {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export class BackgroundTaskHostError extends Error {
  constructor(
    readonly code: BgHostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BackgroundTaskHostError";
  }
}

export const BG_HOST_REQUEST_TIMEOUT_MS = 5000;
/** The `logs` read is a file read; it gets a longer deadline than a registry read. */
export const BG_HOST_LOG_REQUEST_TIMEOUT_MS = 10_000;

export interface BackgroundTaskHostClientOptions {
  /** Stable per client, at most 128 chars: the service answers a repeat `subscribe` with the same lease. */
  clientId: string;
  requestTimeoutMs?: number;
  logRequestTimeoutMs?: number;
  logger?: { warn: (message: string) => void };
}

interface Lease {
  leaseId: string;
  activationId: string;
  /** The per-lease sequence; a fresh lease starts again at 1. */
  sequence: number;
}

interface Pending {
  requestId: string;
  operation: BgHostOperation;
  resolve: (result: unknown) => void;
  reject: (error: BackgroundTaskHostError) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ChangeListener = (frame: BgChangedFrame) => void;

/**
 * True for a change frame the consumer has not seen: a higher revision in the same
 * activation, or any frame of a *different* activation (a fresh activation's `ready`
 * carries revision 0, which is not "older" than the activation it follows).
 *
 * Exported for tests and for the server's own de-duplication of the frames it forwards.
 */
export function isNewBgChangeFrame(
  seen: { activationId: string; revision: number; kind: string } | null,
  frame: BgChangedFrame,
): boolean {
  if (!seen) return true;
  if (seen.activationId !== frame.activationId) return true;
  if (frame.revision > seen.revision) return true;
  // A frame at a revision already seen is a duplicate of that news, not of the whole
  // activation: `closed` at the `ready` frame's revision is new news, and swallowing it leaves
  // a panel leasing an activation that no longer exists.
  return frame.revision === seen.revision && frame.kind !== seen.kind;
}

export class BackgroundTaskHostClient {
  private readonly bus: EventBusLike;
  private readonly clientId: string;
  private readonly requestTimeoutMs: number;
  private readonly logRequestTimeoutMs: number;
  private readonly logger: { warn: (message: string) => void };
  private readonly pending = new Map<string, Pending>();
  private readonly changes = new Set<ChangeListener>();
  private unsubscribeResponse: (() => void) | null = null;
  private unsubscribeChanged: (() => void) | null = null;
  private lease: Lease | null = null;
  private lastChange: { activationId: string; revision: number; kind: string } | null = null;
  /** A monotonically increasing request counter; `request_id` must be unique per activation. */
  private requests = 0;
  /** One request at a time, so sequence order is publish order. */
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** The activation the last `ready` frame announced, and the `closed` frame's reason. */
  private readyActivationId: string | null = null;
  private closedActivationId: string | null = null;

  constructor(bus: EventBusLike, options: BackgroundTaskHostClientOptions) {
    this.bus = bus;
    this.clientId = options.clientId.slice(0, 128);
    this.requestTimeoutMs = options.requestTimeoutMs ?? BG_HOST_REQUEST_TIMEOUT_MS;
    this.logRequestTimeoutMs = options.logRequestTimeoutMs ?? BG_HOST_LOG_REQUEST_TIMEOUT_MS;
    this.logger = options.logger ?? console;
    this.subscribe();
  }

  /** The listeners are the whole cost; opening the panel is what starts them. */
  private subscribe(): void {
    this.unsubscribeResponse = this.bus.on(BG_HOST_RESPONSE_CHANNEL, (data) => {
      const frame = parseBgResponseFrame(data);
      if (!frame) return;
      const entry = this.pending.get(frame.request_id);
      // A frame for a request this client already gave up on (or never sent) is not news:
      // answering it would let a late success resolve a request the caller was told failed.
      if (!entry || entry.operation !== frame.operation) return;
      this.pending.delete(frame.request_id);
      clearTimeout(entry.timer);
      if (frame.ok) entry.resolve(frame.result);
      else entry.reject(new BackgroundTaskHostError(frame.error.code, frame.error.message));
    });
    this.unsubscribeChanged = this.bus.on(BG_HOST_CHANGED_CHANNEL, (data) => {
      const frame = parseBgChangedFrame(data);
      if (!frame) return;
      if (frame.kind === "ready") this.readyActivationId = frame.activationId;
      if (frame.kind === "closed") this.closedActivationId = frame.activationId;
      if (!isNewBgChangeFrame(this.lastChange, frame)) return;
      this.lastChange = { activationId: frame.activationId, revision: frame.revision, kind: frame.kind };
      // The activation this client leased is gone: drop it, so the next operation takes a
      // fresh lease from the activation that replaced it.
      if (frame.kind === "closed" && this.lease && this.lease.activationId === frame.activationId) {
        this.lease = null;
      }
      for (const listener of this.changes) {
        try {
          listener(frame);
        } catch (error) {
          this.logger.warn(`[pi-web] a background-task change handler threw: ${String(error)}`);
        }
      }
    });
  }

  /** Subscribes to change frames. The frames are de-duplicated; the data is fetched. */
  onChanges(listener: ChangeListener): () => void {
    if (this.disposed) return () => {};
    this.changes.add(listener);
    return () => this.changes.delete(listener);
  }

  /** The last `ready` frame's activation, and the last `closed` one. For the panel's states. */
  getState(): { ready: boolean; activationId: string | null; closedActivationId: string | null; leased: boolean } {
    return {
      ready: this.readyActivationId !== null,
      activationId: this.lease?.activationId ?? this.readyActivationId,
      closedActivationId: this.closedActivationId,
      leased: this.lease !== null,
    };
  }

  /** The lease is dead on our side too — the next operation re-subscribes. */
  invalidateLease(): void {
    this.lease = null;
  }

  /**
   * The activation the panel last heard of is closed — the session it belonged to ended. A
   * request now would sit on a service that is gone and come back as a timeout, so the client
   * answers `CLOSED` and the panel says so. A fresh `ready` frame reopens the interface: that is
   * the only thing that clears this, which is why a new activation is never "older" than the
   * activation it follows.
   */
  private assertActivationOpen(): void {
    if (this.closedActivationId === null) return;
    if (this.readyActivationId !== null && this.readyActivationId !== this.closedActivationId) return;
    throw new BackgroundTaskHostError(
      "CLOSED",
      "the background-task host interface closed with its session; it announces a new activation on the change channel",
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new BackgroundTaskHostError("DISPOSED", "the background-task host client was closed"));
    }
    this.pending.clear();
    this.changes.clear();
    try {
      // The service releases the lease on shutdown; asking is polite and cheap.
      if (this.lease) {
        const lease = this.lease;
        this.emitRequest("unsubscribe", {
          leaseId: lease.leaseId,
          activationId: lease.activationId,
          sequence: ++lease.sequence,
        }, this.nextRequestId("unsubscribe"));
      }
    } catch (error) {
      this.logger.warn(`[pi-web] background-task lease release failed: ${String(error)}`);
    }
    this.lease = null;
    this.unsubscribeResponse?.();
    this.unsubscribeChanged?.();
    this.unsubscribeResponse = null;
    this.unsubscribeChanged = null;
  }

  private nextRequestId(operation: BgHostOperation): string {
    this.requests += 1;
    return `${this.clientId}:${operation}:${String(this.requests)}`;
  }

  /** Publishes one request frame on the bus. */
  private emitRequest(operation: BgHostOperation, payload: Record<string, unknown>, requestId: string): void {
    this.bus.emit(BG_HOST_REQUEST_CHANNEL, bgHostRequestFrame(requestId, operation, payload));
  }

  /** Awaits the response frame for one request, with a deadline. */
  private awaitResponse(
    operation: BgHostOperation,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.disposed) return Promise.reject(new BackgroundTaskHostError("DISPOSED", "the background-task host client was closed"));
    const requestId = this.nextRequestId(operation);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(new BackgroundTaskHostError("TIMEOUT", `${operation} did not answer within ${String(timeoutMs)} ms`));
      }, timeoutMs);
      // Registered before the emit: the bus delivers synchronously.
      this.pending.set(requestId, { requestId, operation, resolve, reject, timer });
      try {
        this.emitRequest(operation, payload, requestId);
      } catch (error) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(new BackgroundTaskHostError("OPERATION_FAILED", String(error)));
      }
    });
  }

  private leaseFields(lease: Lease): Record<string, unknown> {
    lease.sequence += 1;
    return { leaseId: lease.leaseId, activationId: lease.activationId, sequence: lease.sequence };
  }

  private async acquireLease(): Promise<Lease> {
    if (this.lease) return this.lease;
    const result = (await this.awaitResponse(
      "subscribe",
      { clientId: this.clientId },
      this.requestTimeoutMs,
    )) as BgSubscribeResult;
    const lease: Lease = { leaseId: result.leaseId, activationId: result.activationId, sequence: 0 };
    this.lease = lease;
    this.readyActivationId = result.activationId;
    return lease;
  }

  /**
   * Serializes requests so the sequence the service sees is the order they were published.
   * A leased operation is retried once after a fresh lease when the service reports the lease
   * dead — the retry carries a new `request_id` and a new sequence on a new lease, so it is a
   * new request, never a replay of a stale one.
   */
  private leased<T>(
    operation: BgHostOperation,
    payload: (fields: Record<string, unknown>) => Record<string, unknown>,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      this.assertActivationOpen();
      const lease = await this.acquireLease();
      const fields = this.leaseFields(lease);
      try {
        return (await this.awaitResponse(operation, payload(fields), timeoutMs)) as T;
      } catch (error) {
        const code = error instanceof BackgroundTaskHostError ? error.code : null;
        if (code && BG_HOST_RETRYABLE_CODES.includes(code)) {
          this.lease = null;
          this.assertActivationOpen();
          const fresh = await this.acquireLease();
          return (await this.awaitResponse(operation, payload(this.leaseFields(fresh)), timeoutMs)) as T;
        }
        throw error;
      }
    };
    // The tail keeps the order; a failed request must not wedge the queue.
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Answers at any time while the activation is open, so it is the availability probe. */
  capabilities(): Promise<BgCapabilities> {
    const run = async (): Promise<BgCapabilities> =>
      (await this.awaitResponse("capabilities", {}, this.requestTimeoutMs)) as BgCapabilities;
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  list(options: { cursor?: string; limit?: number } = {}): Promise<BgListResult> {
    const limit = Math.max(1, Math.min(BG_HOST_MAX_PAGE_SIZE, Math.round(options.limit ?? BG_HOST_MAX_PAGE_SIZE)));
    return this.leased<BgListResult>("list", (fields) => ({
      ...fields,
      limit,
      ...(options.cursor ? { cursor: options.cursor } : {}),
    }));
  }

  detail(taskId: string): Promise<BgDetailResult> {
    return this.leased<BgDetailResult>("detail", (fields) => ({ ...fields, taskId }));
  }

  /** One bounded window. `tail: true` (the default) reads the end, which is what a live task needs. */
  logs(taskId: string, options: { maxBytes?: number; tail?: boolean } = {}): Promise<BgLogsResult> {
    const maxBytes = Math.max(1, Math.min(BG_HOST_MAX_LOG_BYTES, Math.round(options.maxBytes ?? 16384)));
    return this.leased<BgLogsResult>(
      "logs",
      (fields) => ({ ...fields, taskId, maxBytes, tail: options.tail ?? true }),
      this.logRequestTimeoutMs,
    );
  }

  stop(taskId: string): Promise<BgStopResult> {
    return this.leased<BgStopResult>("stop", (fields) => ({ ...fields, taskId }));
  }

  /** The documented selection: the exact ids, never a fresh registry scan. */
  stopAll(taskIds: string[]): Promise<BgStopAllResult> {
    const ids = [...new Set(taskIds)].slice(0, 1000);
    return this.leased<BgStopAllResult>("stop_all", (fields) => ({ ...fields, taskIds: ids }));
  }

  rerun(taskId: string): Promise<BgRerunResult> {
    return this.leased<BgRerunResult>("rerun", (fields) => ({ ...fields, taskId }));
  }

  markSeen(taskIds: string[]): Promise<BgMarkSeenResult> {
    const ids = [...new Set(taskIds)].slice(0, 1000);
    return this.leased<BgMarkSeenResult>("mark_seen", (fields) => ({ ...fields, taskIds: ids }));
  }
}
