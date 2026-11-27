/**
 * The wire contract of `pi-background-tasks`' host interface (EventBus API v1).
 *
 * pi-desk is a *host* of that extension: it never imports the package's code (its
 * `dist/src/**` chunks are private, and the extension docs say a natively loaded
 * extension must not import them), and it keeps no task list of its own. Everything
 * the panel shows is a frame the extension published on the session's shared EventBus.
 * These are the frame types of that contract, restated structurally so the app type-checks
 * without a compile-time dependency on a third-party package, plus the small validation
 * the app needs before it trusts a frame.
 *
 * Docs: `pi-background-tasks/docs/api/eventbus-host-v1.md`. The three channels are the
 * whole surface:
 *
 *   request   `pi-background-tasks:host:request:v1`   the host asks for something
 *   response  `pi-background-tasks:host:response:v1`  one frame per `request_id`
 *   changed   `pi-background-tasks:host:changed:v1`   a small invalidation, no task data
 *
 * A change frame carries only counts and a revision: the consumer re-reads with
 * `list`/`detail`. That is deliberate — a change frame is never a task snapshot, and a
 * client that treated one as one would show a task that no longer exists.
 */

export const BG_HOST_REQUEST_CHANNEL = "pi-background-tasks:host:request:v1";
export const BG_HOST_RESPONSE_CHANNEL = "pi-background-tasks:host:response:v1";
export const BG_HOST_CHANGED_CHANNEL = "pi-background-tasks:host:changed:v1";
export const BG_HOST_REQUEST_SCHEMA = "pi-background-tasks.host-request.v1";
export const BG_HOST_RESPONSE_SCHEMA = "pi-background-tasks.host-response.v1";
export const BG_HOST_CHANGED_SCHEMA = "pi-background-tasks.host-changed.v1";

/** Page and log bounds the service enforces; the client asks within them. */
export const BG_HOST_MAX_PAGE_SIZE = 50;
export const BG_HOST_MAX_LOG_BYTES = 65536;
export const BG_HOST_DEFAULT_LOG_BYTES = 32768;
export const BG_HOST_LIST_PREVIEW_CHARS = 512;

export type BgHostOperation =
  | "capabilities"
  | "subscribe"
  | "unsubscribe"
  | "list"
  | "detail"
  | "logs"
  | "stop"
  | "stop_all"
  | "rerun"
  | "result"
  | "mark_seen";

export const BG_HOST_OPERATIONS: readonly BgHostOperation[] = [
  "capabilities",
  "subscribe",
  "unsubscribe",
  "list",
  "detail",
  "logs",
  "stop",
  "stop_all",
  "rerun",
  "result",
  "mark_seen",
];

/**
 * The codes the service answers with. Callers branch on these, never on the message
 * text. `TIMEOUT` is pi-desk's own: the extension answered nothing within the deadline.
 */
export type BgHostErrorCode =
  | "INVALID_REQUEST"
  | "UNKNOWN_OPERATION"
  | "UNAVAILABLE"
  | "CLOSED"
  | "LEASE_INVALID"
  | "LEASE_LIMIT"
  | "ACTIVATION_MISMATCH"
  | "STALE_REQUEST"
  | "CONFLICT"
  | "BUSY"
  | "NOT_FOUND"
  | "INVALID_CURSOR"
  | "NOT_RERUNNABLE"
  | "NO_RESULT"
  | "RESULT_INVALID"
  | "LOG_UNAVAILABLE"
  | "TOO_LARGE"
  | "OPERATION_FAILED"
  | "TIMEOUT"
  | "DISPOSED";

/**
 * The documented codes, as a value. The panel answers the user with the extension's own code, so
 * a code that is not one of the extension's is reported as a failure of ours, and a code that is
 * one of the extension's is passed through — including across server chunks, where the host
 * client's class is not necessarily the same object (`instanceof` is false between copies).
 */
export const BG_HOST_ERROR_CODES = [
  "INVALID_REQUEST",
  "UNKNOWN_OPERATION",
  "UNAVAILABLE",
  "CLOSED",
  "LEASE_INVALID",
  "LEASE_LIMIT",
  "ACTIVATION_MISMATCH",
  "STALE_REQUEST",
  "CONFLICT",
  "BUSY",
  "NOT_FOUND",
  "INVALID_CURSOR",
  "NOT_RERUNNABLE",
  "NO_RESULT",
  "RESULT_INVALID",
  "LOG_UNAVAILABLE",
  "TOO_LARGE",
  "OPERATION_FAILED",
  "TIMEOUT",
  "DISPOSED",
] as const satisfies readonly BgHostErrorCode[];

export function isBgHostErrorCode(value: unknown): value is BgHostErrorCode {
  return typeof value === "string" && (BG_HOST_ERROR_CODES as readonly string[]).includes(value);
}


/** The codes that mean "this lease is dead": take a fresh one and ask once more. */
export const BG_HOST_RETRYABLE_CODES: readonly BgHostErrorCode[] = [
  "LEASE_INVALID",
  "ACTIVATION_MISMATCH",
  "STALE_REQUEST",
  "CLOSED",
];

/** A shell task's state. `killed` is the extension's word for stopped by request. */
export type BgTaskStatus = "running" | "completed" | "failed" | "killed";
export const BG_TASK_STATUSES: readonly BgTaskStatus[] = ["running", "completed", "failed", "killed"];
export const BG_TERMINAL_STATUSES: readonly BgTaskStatus[] = ["completed", "failed", "killed"];

export function isBgTerminalStatus(status: BgTaskStatus): boolean {
  return BG_TERMINAL_STATUSES.includes(status);
}

/** The task kinds the host interface reports. Only ordinary shell tasks rerun. */
export type BgTaskKind = "shell" | "agent-shell" | "delegate" | "fusion" | "attested" | "managed";

/**
 * One background task, as the extension reports it. The fields are its snapshot's;
 * everything beyond identity, command and status is optional, because a task that has
 * not finished has no exit code and a task the extension cannot observe reports no
 * telemetry.
 */
export interface BgTaskSnapshot {
  id: string;
  name?: string;
  command: string;
  description?: string;
  status: BgTaskStatus;
  outputPath: string;
  cwd: string;
  startTime: number;
  endTime?: number;
  exitCode?: number | null;
  signal?: string | null;
  pid?: number;
  bytesWritten: number;
  isAgent: boolean;
  surviveReload: boolean;
  error?: string;
  notified: boolean;
  notifyOnCompletion: boolean;
  triggerOnCompletion: boolean;
  timeoutSeconds?: number;
  model?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    costTotal?: number;
  };
  toolUsage?: { total: number; failed: number; byName: Record<string, number> };
  telemetryUnavailableReason?: string;
  shellPolicy?: { policy: string; executable: string; argvPrefix: string[]; dialect: string };
}

/** Counts over every task the activation retains. */
export interface BgTaskCounts {
  running: number;
  completed: number;
  failed: number;
  killed: number;
  unseenCompleted: number;
  unseenFailed: number;
  unseenKilled: number;
  total: number;
}

export function emptyBgTaskCounts(): BgTaskCounts {
  return {
    running: 0,
    completed: 0,
    failed: 0,
    killed: 0,
    unseenCompleted: 0,
    unseenFailed: 0,
    unseenKilled: 0,
    total: 0,
  };
}

export type BgTruncatedField = "command" | "description" | "error";

/** A task plus what the host may do with it. `canRerun` is the extension's answer, not a guess. */
export interface BgTaskView {
  task: BgTaskSnapshot;
  kind: BgTaskKind;
  seen: boolean;
  canRerun: boolean;
  canReadResult: boolean;
  truncatedFields: BgTruncatedField[];
}

/** The facts every leased result carries. */
export interface BgActivationFacts {
  activationId: string;
  sessionId: string;
  revision: number;
  observedAt: number;
  counts: BgTaskCounts;
}

export interface BgCapabilities {
  api_version: number;
  operations: BgHostOperation[];
  max_page_size: number;
  max_log_bytes: number;
  max_inline_result_bytes: number;
}

export interface BgSubscribeResult extends BgActivationFacts {
  leaseId: string;
}

export interface BgListResult extends BgActivationFacts {
  tasks: BgTaskView[];
  nextCursor: string | null;
}

export interface BgDetailResult {
  task: BgTaskView;
}

/**
 * One bounded window of a task's output. `tail` is the documented default, and the byte window
 * is the extension's own arithmetic: `windowStart`/`windowEnd` say where in the file the text
 * came from, so a panel can say "the last 8 kB of 400 kB" truthfully.
 */
export interface BgLogsResult {
  task: BgTaskSnapshot;
  path: string;
  text: string;
  tail: boolean;
  maxBytes: number;
  bytesRead: number;
  totalBytes: number;
  windowStart: number;
  windowEnd: number;
  truncated: boolean;
}

export interface BgStopResult {
  task: BgTaskSnapshot;
  alreadyTerminal: boolean;
}

export type BgStopAllOutcome = "stopped" | "already_terminal" | "not_found" | "failed";

/** One row of a `stop_all` answer: what happened to one id of the selection. */
export interface BgStopAllRow {
  taskId: string;
  outcome: BgStopAllOutcome;
  status?: BgTaskStatus;
  error?: string;
}

/**
 * `stop_all` answers one row per id of the frozen selection, plus the count of each outcome.
 * The selection is frozen by the caller — the extension never rescans the registry for this
 * operation, which is why a panel confirms a list of ids and not "everything running now".
 */
export interface BgStopAllResult {
  results: BgStopAllRow[];
  stopped: number;
  alreadyTerminal: number;
  notFound: number;
  failed: number;
}

/** `rerun` starts a new task with the source's exact command: a new identity, never a reused id. */
export interface BgRerunResult {
  sourceTaskId: string;
  task: BgTaskSnapshot;
}

/**
 * `mark_seen` acknowledges finished tasks, and the seen set is shared with the task's own dock.
 * A running task answers `not_terminal`: viewing it can never pre-acknowledge a completion that
 * has not happened, so its unseen mark stays.
 */
export interface BgMarkSeenResult {
  results: Array<{ taskId: string; outcome: "marked" | "already_seen" | "not_terminal" | "not_found" }>;
  revision: number;
  counts: BgTaskCounts;
}

export interface BgHostErrorFrame {
  schema_version: typeof BG_HOST_RESPONSE_SCHEMA;
  request_id: string;
  operation: string;
  ok: false;
  error: { code: BgHostErrorCode; message: string };
}

export interface BgHostSuccessFrame {
  schema_version: typeof BG_HOST_RESPONSE_SCHEMA;
  request_id: string;
  operation: string;
  ok: true;
  result: unknown;
}

export type BgHostResponseFrame = BgHostSuccessFrame | BgHostErrorFrame;

export type BgChangedKind = "ready" | "changed" | "closed";

export interface BgChangedFrame extends BgActivationFacts {
  schema_version: typeof BG_HOST_CHANGED_SCHEMA;
  kind: BgChangedKind;
}

export interface BgHostRequestFrame {
  schema_version: typeof BG_HOST_REQUEST_SCHEMA;
  request_id: string;
  operation: BgHostOperation;
  payload: Record<string, unknown>;
}

/** Builds one request frame. `payload` is the operation's, closed and validated by the service. */
export function bgHostRequestFrame(
  requestId: string,
  operation: BgHostOperation,
  payload: Record<string, unknown>,
): BgHostRequestFrame {
  return { schema_version: BG_HOST_REQUEST_SCHEMA, request_id: requestId, operation, payload };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function status(value: unknown): BgTaskStatus {
  return BG_TASK_STATUSES.includes(value as BgTaskStatus) ? (value as BgTaskStatus) : "running";
}

function counts(value: unknown): BgTaskCounts {
  const base = emptyBgTaskCounts();
  if (!record(value)) return base;
  const read = (key: keyof BgTaskCounts) => (typeof value[key] === "number" ? (value[key] as number) : base[key]);
  return {
    running: read("running"),
    completed: read("completed"),
    failed: read("failed"),
    killed: read("killed"),
    unseenCompleted: read("unseenCompleted"),
    unseenFailed: read("unseenFailed"),
    unseenKilled: read("unseenKilled"),
    total: read("total"),
  };
}

/**
 * Accepts a change frame, rejects anything else. A change frame is an invalidation, so
 * the fields the consumer needs are the activation, the revision and the counts; the
 * rest of the task data is fetched, never read out of this frame.
 */
export function parseBgChangedFrame(data: unknown): BgChangedFrame | null {
  if (!record(data)) return null;
  if (data.schema_version !== BG_HOST_CHANGED_SCHEMA) return null;
  if (data.kind !== "ready" && data.kind !== "changed" && data.kind !== "closed") return null;
  if (typeof data.activationId !== "string" || data.activationId.length === 0) return null;
  if (typeof data.sessionId !== "string" || data.sessionId.length === 0) return null;
  if (typeof data.revision !== "number" || !Number.isFinite(data.revision)) return null;
  return {
    schema_version: BG_HOST_CHANGED_SCHEMA,
    kind: data.kind,
    activationId: data.activationId,
    sessionId: data.sessionId,
    revision: data.revision,
    observedAt: typeof data.observedAt === "number" ? data.observedAt : 0,
    counts: counts(data.counts),
  };
}

/** Accepts a response frame for a request this client sent. */
export function parseBgResponseFrame(data: unknown): BgHostResponseFrame | null {
  if (!record(data)) return null;
  if (data.schema_version !== BG_HOST_RESPONSE_SCHEMA) return null;
  if (typeof data.request_id !== "string" || data.request_id.length === 0) return null;
  if (typeof data.operation !== "string") return null;
  if (data.ok === true) return { ...data, schema_version: BG_HOST_RESPONSE_SCHEMA, ok: true } as BgHostSuccessFrame;
  if (data.ok === false && record(data.error) && typeof data.error.code === "string") {
    return {
      schema_version: BG_HOST_RESPONSE_SCHEMA,
      request_id: data.request_id,
      operation: data.operation,
      ok: false,
      error: {
        code: data.error.code as BgHostErrorCode,
        message: typeof data.error.message === "string" ? data.error.message : "",
      },
    };
  }
  return null;
}

/** Reads a task view, keeping the fields the panel renders. Unknown shapes answer null. */
export function parseBgTaskView(value: unknown): BgTaskView | null {
  if (!record(value) || !record(value.task)) return null;
  const task = value.task;
  if (typeof task.id !== "string" || task.id.length === 0) return null;
  if (typeof task.command !== "string") return null;
  const truncatedFields = Array.isArray(value.truncatedFields)
    ? (value.truncatedFields.filter((field) =>
        field === "command" || field === "description" || field === "error") as BgTruncatedField[])
    : [];
  return {
    task: { ...task, status: status(task.status) } as BgTaskSnapshot,
    kind: (typeof value.kind === "string" ? value.kind : "shell") as BgTaskKind,
    seen: value.seen === true,
    canRerun: value.canRerun === true,
    canReadResult: value.canReadResult === true,
    truncatedFields,
  };
}

export function parseBgTaskViews(value: unknown): BgTaskView[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseBgTaskView).filter((view): view is BgTaskView => view !== null);
}
