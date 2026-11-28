import type { AgentEventLike } from "./agent-event-wire";
import type { DebugEventConnectionSnapshot, DebugStreamCloseReason } from "./debug-types";
import { errorMessage } from "./errors.ts";

export interface AgentEventSourceLike {
  readonly readyState: number;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
}

export type AgentEventConnectionStatus = "ready_timeout" | "startup_error" | "closed";

export class AgentEventConnectionError extends Error {
  /**
   * What the stream actually did, in the words a log line needs. The readiness
   * failure separates a stream that never opened from a stream that stayed open
   * and kept answering while the session took its time: a retry is the right
   * advice for one and not the other, so the message the notice prints carries
   * this and the field keeps it readable programmatically.
   */
  readonly detail: string | null;

  constructor(public readonly status: AgentEventConnectionStatus, message?: string, detail?: string) {
    super(message ?? (
      status === "ready_timeout"
        ? "Timed out starting the agent session. Please try again."
        : "Failed to connect to the agent event stream. Please try again."
    ));
    this.name = "AgentEventConnectionError";
    this.detail = detail ?? null;
  }
}

type Attempt = {
  promise: Promise<void>;
  ready: boolean;
  succeed(): void;
  fail(error: AgentEventConnectionError): void;
};

type Connection = {
  sessionId: string;
  source: AgentEventSourceLike;
  attempt: Attempt;
  watchdog: ReturnType<typeof setInterval> | null;
  openedAt: number;
  connectedAt: number | null;
  /** Last data of any kind, heartbeats included; null before the first. */
  lastSeenAt: number | null;
  lastHeartbeatAt: number | null;
  events: number;
};

type FailReason = NonNullable<DebugEventConnectionSnapshot["lastError"]>["reason"];

export interface AgentEventConnectionOptions {
  createSource(sessionId: string): AgentEventSourceLike;
  onEvent(event: AgentEventLike): void;
  shouldMaintain(sessionId: string): boolean;
  /**
   * How long the stream may stay silent before the readiness wait gives up. This
   * is a *silence* window, not a countdown from the socket: every piece of data
   * the stream delivers re-arms it, and the server's heartbeat
   * (AGENT_EVENT_HEARTBEAT_MS) is data sent for exactly that purpose — "alive,
   * still starting". A cold start (a dev route compile, extensions and MCP
   * servers loading, a large transcript, a phone on a slow link) is slow work,
   * not a dead stream: failing at a fixed 60s from the socket told the user to
   * retry a session that was about to be ready, and threw away the start in
   * progress together with a healthy stream.
   */
  readinessTimeoutMs: number;
  /**
   * The absolute ceiling on the readiness wait, counted from the socket opening:
   * what stops a session that starts forever, heartbeats and all. Omitted: five
   * times the silence window, at least READINESS_CEILING_FLOOR_MS.
   */
  readinessCeilingMs?: number;
  reconnectDelayMs: number;
  /**
   * A ready stream that delivers nothing for this long, heartbeats included
   * (AGENT_EVENT_HEARTBEAT_MS), is dead and reconnects. Omitted: never.
   */
  staleAfterMs?: number;
  onUnexpectedError?(error: unknown): void;
}

const EVENT_SOURCE_OPEN = 1;

/** The shortest absolute ceiling on the readiness wait, however short the silence window is. */
export const READINESS_CEILING_FLOOR_MS = 300_000;

/** The readiness failure's words, from what the stream actually did. */
function readinessFailure(
  connection: Connection,
  kind: "silent" | "ceiling",
  windowMs: number,
): AgentEventConnectionError {
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  const opened = connection.source.readyState === EVENT_SOURCE_OPEN;
  const answered = connection.lastHeartbeatAt !== null || connection.events > 0;
  if (kind === "ceiling") {
    return new AgentEventConnectionError(
      "ready_timeout",
      `The agent session took more than ${seconds}s to start, although its stream stayed open and the server kept answering. Send again \u2014 the session is usually ready by then.`,
      `stream open for ${seconds}s and answering, no connected`,
    );
  }
  return new AgentEventConnectionError(
    "ready_timeout",
    `Timed out starting the agent session: ${opened ? "the stream stayed silent for " : "the stream never opened and nothing arrived for "}${seconds}s. Please try again.`,
    `${opened ? "stream open, silent" : "stream never opened"} for ${seconds}s`
      + `${answered ? ", earlier data did arrive" : ", nothing has arrived"}`,
  );
}

/** Owns the EventSource, agent-readiness handshake, and passive reconnect. */
export class AgentEventConnection {
  private current: Connection | null = null;
  private retry: { sessionId: string; timer: ReturnType<typeof setTimeout>; dueAt: number } | null = null;
  private retryGeneration = 0;
  // Bookkeeping for snapshot() only: nothing here decides what the connection does.
  private opens = 0;
  private retries = 0;
  private lastError: DebugEventConnectionSnapshot["lastError"] = null;
  private lastClose: DebugEventConnectionSnapshot["lastClose"] = null;

  constructor(private readonly options: AgentEventConnectionOptions) {}

  /**
   * `reason` only labels the close in snapshot(). An idle connection left by an error no close has
   * ended yet (a startup error, a retry nobody wanted) is stamped too: the close ends that outage.
   */
  close(reason?: DebugStreamCloseReason): void {
    const openError = this.lastError !== null && !(this.lastClose && this.lastClose.at >= this.lastError.at);
    if (this.current || this.retry || openError) this.lastClose = { reason: reason ?? null, at: Date.now() };
    this.stopRetrying();
    if (this.current) this.discard(this.current, new AgentEventConnectionError("closed"));
  }

  /** What the connection holds now, as a plain copy. Reads fields only: it opens, closes and arms nothing. */
  snapshot(): DebugEventConnectionSnapshot {
    const connection = this.current;
    const retry = this.retry;
    return {
      sessionId: connection?.sessionId ?? retry?.sessionId ?? null,
      state: connection ? (connection.attempt.ready ? "connected" : "connecting") : retry ? "retrying" : "idle",
      readyState: connection ? connection.source.readyState : null,
      openedAt: connection?.openedAt ?? null,
      connectedAt: connection?.connectedAt ?? null,
      lastSeenAt: connection?.lastSeenAt ?? null,
      lastHeartbeatAt: connection?.lastHeartbeatAt ?? null,
      events: connection?.events ?? 0,
      opens: this.opens,
      retries: this.retries,
      retryDueAt: retry?.dueAt ?? null,
      watchdogArmed: Boolean(connection && connection.watchdog !== null),
      staleAfterMs: this.options.staleAfterMs ?? null,
      lastError: this.lastError ? { ...this.lastError } : null,
      lastClose: this.lastClose ? { ...this.lastClose } : null,
    };
  }

  maintain(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    const retryGeneration = this.retryGeneration;
    void this.ensureConnected(sessionId).catch((error) => {
      if (retryGeneration !== this.retryGeneration) return;
      if (error instanceof AgentEventConnectionError) {
        if (error.status === "startup_error") this.stopRetrying();
        else this.scheduleRetry(sessionId);
      } else {
        this.options.onUnexpectedError?.(error);
      }
    });
  }

  async ensureConnected(sessionId: string): Promise<void> {
    while (true) {
      let connection = this.current;
      if (!connection || connection.sessionId !== sessionId) {
        connection = this.open(sessionId);
      } else if (
        connection.attempt.ready
        && connection.source.readyState === EVENT_SOURCE_OPEN
      ) {
        return;
      }

      await connection.attempt.promise;
      if (this.current !== connection) {
        if (this.current?.sessionId === sessionId) continue;
        throw new AgentEventConnectionError("closed");
      }
      if (connection.source.readyState === EVENT_SOURCE_OPEN) return;

      // A once-ready EventSource may otherwise remain CONNECTING indefinitely.
      this.lastClose = { reason: "stuck", at: Date.now() };
      this.discard(connection, new AgentEventConnectionError("closed"));
    }
  }

  private open(sessionId: string): Connection {
    if (this.current) {
      this.lastClose = { reason: "replaced", at: Date.now() };
      this.discard(this.current, new AgentEventConnectionError("closed"));
    }

    let source: AgentEventSourceLike;
    try {
      source = this.options.createSource(sessionId);
    } catch (error) {
      const message = errorMessage(error);
      this.lastError = { reason: "error", message, at: Date.now() };
      throw new AgentEventConnectionError("closed", message);
    }
    this.opens += 1;

    let settled = false;
    let resolve!: () => void;
    let reject!: (error: AgentEventConnectionError) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const openedAt = Date.now();
    // The readiness wait is a silence window under an absolute ceiling. Data of any
    // kind — above all the server's heartbeat — re-arms the window, because a stream
    // that keeps answering is a server that is alive and still starting the session.
    // The ceiling is what ends a start that only ever heartbeats. See
    // AgentEventConnectionOptions.readinessTimeoutMs for why the window is not a
    // countdown from the socket.
    const silenceMs = this.options.readinessTimeoutMs;
    const ceilingMs = this.options.readinessCeilingMs ?? Math.max(READINESS_CEILING_FLOOR_MS, silenceMs * 5);
    const readiness = {
      silence: null as ReturnType<typeof setTimeout> | null,
      ceiling: null as ReturnType<typeof setTimeout> | null,
    };
    const clearReadiness = () => {
      if (readiness.silence !== null) clearTimeout(readiness.silence);
      if (readiness.ceiling !== null) clearTimeout(readiness.ceiling);
      readiness.silence = null;
      readiness.ceiling = null;
    };
    const failReadiness = (kind: "silent" | "ceiling", windowMs: number) => {
      clearReadiness();
      this.fail(connection, readinessFailure(connection, kind, windowMs), "ready_timeout");
    };
    const armSilence = () => {
      if (readiness.silence !== null) clearTimeout(readiness.silence);
      readiness.silence = setTimeout(() => failReadiness("silent", silenceMs), silenceMs);
    };
    readiness.ceiling = setTimeout(() => failReadiness("ceiling", ceilingMs), ceilingMs);
    armSilence();
    const attempt: Attempt = {
      promise,
      ready: false,
      succeed() {
        if (settled) return;
        settled = true;
        clearReadiness();
        resolve();
      },
      fail(error) {
        if (settled) return;
        settled = true;
        clearReadiness();
        reject(error);
      },
    };
    const connection: Connection = {
      sessionId,
      source,
      attempt,
      watchdog: null,
      openedAt,
      connectedAt: null,
      lastSeenAt: null,
      lastHeartbeatAt: null,
      events: 0,
    };
    this.current = connection;

    source.onmessage = (message) => {
      if (this.current !== connection) return;
      connection.lastSeenAt = Date.now();
      // The server is answering: the silence window starts again from now. Once
      // `connected` has arrived the watchdog (staleAfterMs) owns this job.
      if (!attempt.ready) armSilence();
      let event: AgentEventLike;
      try {
        event = JSON.parse(message.data) as AgentEventLike;
      } catch {
        return;
      }

      if (event.type === "heartbeat") {
        connection.lastHeartbeatAt = connection.lastSeenAt;
        return;
      }
      if (event.type === "connected") {
        connection.connectedAt ??= connection.lastSeenAt;
        attempt.ready = true;
        attempt.succeed();
        this.stopRetrying();
        const staleAfterMs = this.options.staleAfterMs;
        if (staleAfterMs && connection.watchdog === null) {
          // Checked against the clock, so a background tab's throttled timer
          // only reconnects later, never wrongly.
          connection.watchdog = setInterval(() => {
            if (Date.now() - (connection.lastSeenAt ?? openedAt) > staleAfterMs) {
              this.fail(connection, new AgentEventConnectionError("closed"), "stale");
            }
          }, Math.max(1_000, Math.floor(staleAfterMs / 3)));
        }
      } else if (event.type === "startup_error") {
        const message = typeof event.errorMessage === "string" ? event.errorMessage : undefined;
        this.fail(connection, new AgentEventConnectionError("startup_error", message), "startup_error");
        return;
      }
      connection.events += 1;
      this.options.onEvent(event);
    };
    source.onerror = () => {
      this.fail(connection, new AgentEventConnectionError("closed"), "error");
    };

    return connection;
  }

  private fail(connection: Connection, error: AgentEventConnectionError, reason: FailReason): void {
    if (this.current !== connection) return;
    this.lastError = { reason, message: reason === "startup_error" ? error.message : null, at: Date.now() };
    this.discard(connection, error);
    if (error.status === "startup_error") this.stopRetrying();
    else this.scheduleRetry(connection.sessionId);
  }

  private discard(connection: Connection, error: AgentEventConnectionError): void {
    if (connection.watchdog !== null) clearInterval(connection.watchdog);
    connection.watchdog = null;
    connection.attempt.fail(error);
    connection.source.close();
    if (this.current === connection) this.current = null;
  }

  private scheduleRetry(sessionId: string): void {
    if (!this.options.shouldMaintain(sessionId)) return;
    if (this.retry?.sessionId === sessionId) return;
    this.clearRetry();

    const timer = setTimeout(() => {
      if (this.retry?.timer !== timer) return;
      this.retry = null;
      this.retries += 1;
      this.maintain(sessionId);
    }, this.options.reconnectDelayMs);
    this.retry = { sessionId, timer, dueAt: Date.now() + this.options.reconnectDelayMs };
  }

  private stopRetrying(): void {
    this.retryGeneration += 1;
    this.clearRetry();
  }

  private clearRetry(): void {
    if (this.retry) clearTimeout(this.retry.timer);
    this.retry = null;
  }
}

/** What `POST /api/agent/[id]/lease` answers besides keeping the session alive. */
export interface SessionLeaseReply {
  running?: boolean;
  awaitingInput?: boolean;
  subagentsActive?: boolean;
}

/**
 * How long a page waits for a lease reply. Over HTTP/1.1 a request queued behind six open
 * streams never leaves the browser, so no answer in time reads as a starved pool.
 */
export const SESSION_LEASE_TIMEOUT_MS = 5_000;

/**
 * Whether the server reports anything under way in the session: a run, a queued prompt, a `!`
 * command, a compaction, an extension dialog waiting for an answer, or a subagent left to finish
 * (its end starts a turn there). A hidden page keeps or reopens the session's stream while it does.
 */
export function sessionLeaseShowsActivity(reply: SessionLeaseReply | "unanswered" | null | undefined): boolean {
  if (!reply || reply === "unanswered") return false;
  return Boolean(reply.running || reply.awaitingInput || reply.subagentsActive);
}

/**
 * Whether a page hidden past its grace may close the selected session's stream (#1283): only when
 * the lease reply shows nothing under way. `"unanswered"` (no reply within SESSION_LEASE_TIMEOUT_MS,
 * or no network) releases: the pool is starved, which is what the release is for, or the stream
 * is down anyway. `null` (the server answered with an error) keeps the stream until the next check.
 */
export function canReleaseHiddenEventStream(reply: SessionLeaseReply | "unanswered" | null | undefined): boolean {
  if (reply === "unanswered") return true;
  if (!reply) return false;
  return !sessionLeaseShowsActivity(reply);
}
