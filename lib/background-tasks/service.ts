/**
 * The server half of the Background Tasks panel.
 *
 * Every number and row in the panel is an answer from `pi-background-tasks`, read through the
 * session's host client (lib/background-tasks/host-client.ts). Two rules shape this module:
 *
 * - **The extension is the source of truth.** No task is stored, cached across requests,
 *   invented or completed here. A Stop is reported only from the extension's `stop` result —
 *   which resolves after the process actually settled — and a task that the extension no
 *   longer has is shown as gone, not as running.
 * - **The project group is the honest scope.** A task belongs to the activation that started
 *   it, so the panel reads every live session of the *same project* in this process: a task
 *   started in conversation A shows while A stays live, and it is gone when A is disposed.
 *   Nothing from another project or another Pi process is ever mixed in.
 *
 * A merge de-duplicates by task id, so a task reported by two activations (an extension
 * reloaded into two live wrappers of one conversation) is one row, and it is never
 * stoppable twice.
 */

import { getRpcSession } from "../rpc-manager";
import {
  compareBackgroundTaskViews,
  mergeBackgroundTaskViews,
  sumBackgroundTaskCounts,
} from "./session-view";
import {
  emptyBgTaskCounts,
  isBgHostErrorCode,
  type BgStopAllRow,
  isBgTerminalStatus,
  parseBgTaskView,
  parseBgTaskViews,
  type BgChangedFrame,
  type BgHostErrorCode,
  type BgTaskCounts,
  type BgTaskView,
} from "./protocol";
import { type BackgroundTaskHostClient } from "./host-client";
import {
  listBackgroundTasksBridgesForCwd,
  subscribeBackgroundTasksBridgeRegistry,
  type BackgroundTasksBridge,
} from "./bridges";
import { resolveBackgroundTasksExtension } from "./extension";

export type BackgroundTasksState =
  /** The extension answered and its session context is ready. */
  | "ready"
  /** Loaded, but the extension's first `session_start` has not supplied its context yet. */
  | "not-ready"
  /** The selected conversation is not live in this process, so no registry is reachable. */
  | "no-session"
  /** The package is not installed, so no session has the extension. */
  | "not-installed"
  /** `PI_WEB_DISABLE_BACKGROUND_TASKS` keeps it out of every session. */
  | "disabled"
  /** The activation closed (the session is shutting down); tasks are being killed. */
  | "closed";

export interface BackgroundTasksSessionReport {
  sessionId: string;
  cwd: string;
  state: "ready" | "not-ready" | "closed";
  counts: BgTaskCounts;
  /** The conversation the panel was opened from; its tasks come first. */
  primary: boolean;
}

export interface BackgroundTasksSnapshot {
  state: BackgroundTasksState;
  available: boolean;
  /** A short reason for an unavailable state, for the panel's notice. */
  reason?: string;
  tasks: BgTaskView[];
  counts: BgTaskCounts;
  sessions: BackgroundTasksSessionReport[];
  observedAt: number;
  /** The primary activation, for the panel's "connected to this conversation" line. */
  activationId: string | null;
  revision: number;
  /** Per-activation paging cursors: a cursor is scoped to the activation that made it. */
  nextCursors: Record<string, string>;
}

export interface BackgroundTasksActionPayload {
  kind: "stop" | "stop-all" | "rerun" | "mark-seen";
  taskId?: string;
  taskIds?: string[];
}

export interface BackgroundTasksActionOutcome {
  ok: boolean;
  code?: BgHostErrorCode;
  message?: string;
  result?: unknown;
}

/** The conversations whose registries the panel reads: the live ones of the same project. */
function projectBridges(cwd: string): BackgroundTasksBridge[] {
  return listBackgroundTasksBridgesForCwd(cwd);
}

function errorOf(error: unknown): { code: BgHostErrorCode; message: string } {
  // The code is the contract. It is read off the error rather than checked with `instanceof`,
  // because Next can instantiate the host client's module twice in the server, and a
  // `BackgroundTaskHostError` from the other copy is not this copy's instance: the extension's
  // `NOT_FOUND` would come back as our `OPERATION_FAILED`, and the panel would lie about who
  // refused.
  const code = (error as { code?: unknown } | null)?.code;
  if (isBgHostErrorCode(code)) {
    const message = (error as { message?: unknown } | null)?.message;
    return { code, message: typeof message === "string" && message.length > 0 ? message.slice(0, 512) : code };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "OPERATION_FAILED", message: message.slice(0, 512) };
}

/**
 * The panel's snapshot: the merged task list, the counts, and the honest availability state.
 *
 * `cursors` pages each activation separately (a cursor is scoped to the activation that made
 * it, and the docs say so); the response carries one per activation that has more.
 */
export async function readBackgroundTasksSnapshot(
  sessionId: string,
  options: { limit?: number; cursors?: Record<string, string> } = {},
): Promise<BackgroundTasksSnapshot> {
  const observedAt = Date.now();
  const wrapper = getRpcSession(sessionId);
  // Resolved for THIS conversation's working directory: the extension is a plugin the user
  // installed for pi, and the app may be running from a checkout that ships no copy of it (a
  // linked worktree). A fixed process.cwd() said "not installed" over a real global install.
  const source = resolveBackgroundTasksExtension(process.env, wrapper?.cwd ?? process.cwd());
  if (source.reason === "disabled") {
    return emptySnapshot("disabled", "PI_WEB_DISABLE_BACKGROUND_TASKS is set", observedAt);
  }
  if (source.reason === "not-installed" || !source.entryPath) {
    return emptySnapshot("not-installed", "pi-background-tasks is not installed", observedAt);
  }
  if (!wrapper || !wrapper.isAlive()) {
    return emptySnapshot("no-session", "This conversation is not running, so its background tasks are gone with it.", observedAt);
  }
  const cwd = wrapper.cwd;
  const bridges = projectBridges(cwd);
  if (bridges.length === 0) {
    // No bridge for this project at all: the session is live but the extension is not in it
    // (it was started before the package was installed, or a loader error kept it out).
    return emptySnapshot("not-ready", "The extension is not loaded in this conversation.", observedAt);
  }
  const limit = options.limit;
  const settled = await Promise.allSettled(
    bridges.map(async (bridge) => {
      const cursor = options.cursors?.[bridge.sessionId];
      const result = await bridge.client.list(cursor ? { cursor, limit } : { limit });
      return { bridge, result };
    }),
  );
  const groups: BgTaskView[][] = [];
  const reports: BackgroundTasksSessionReport[] = [];
  const nextCursors: Record<string, string> = {};
  const counts: BgTaskCounts[] = [];
  let revision = 0;
  let activationId: string | null = null;
  const failures: { code: BgHostErrorCode; message: string }[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      const { bridge, result } = outcome.value;
      const views = parseBgTaskViews(result.tasks);
      groups.push(views);
      reports.push({
        sessionId: bridge.sessionId,
        cwd: bridge.cwd,
        state: bridge.client.getState().ready ? "ready" : "not-ready",
        counts: result.counts,
        primary: bridge.sessionId === sessionId,
      });
      counts.push(result.counts);
      revision = Math.max(revision, result.revision);
      if (bridge.sessionId === sessionId) {
        activationId = result.activationId;
        if (result.nextCursor) nextCursors[bridge.sessionId] = result.nextCursor;
      } else if (result.nextCursor) {
        nextCursors[bridge.sessionId] = result.nextCursor;
      }
      return;
    }
    const failure = errorOf(outcome.reason);
    failures.push(failure);
    const bridge = bridges[index];
    if (!bridge) return;
    reports.push({
      sessionId: bridge.sessionId,
      cwd: bridge.cwd,
      state: failure.code === "CLOSED" ? "closed" : "not-ready",
      counts: emptyBgTaskCounts(),
      primary: bridge.sessionId === sessionId,
    });
  })
  const primaryReport = reports.find((report) => report.primary);
  const state: BackgroundTasksState = primaryReport
    ? primaryReport.state === "ready" ? "ready" : primaryReport.state === "closed" ? "closed" : "not-ready"
    : "not-ready";
  // Every activation said the host interface is not there: that is the panel's message.
  const allUnavailable = failures.length > 0 && failures.length === settled.length;
  const tasks = mergeBackgroundTaskViews(groups);
  return {
    state: allUnavailable && failures.every((failure) => failure.code === "UNAVAILABLE") ? "not-ready" : state,
    available: state === "ready",
    reason: allUnavailable ? failures[0]?.message : undefined,
    tasks,
    counts: sumBackgroundTaskCounts(counts),
    sessions: reports,
    observedAt,
    activationId,
    revision,
    nextCursors,
  };
}

function emptySnapshot(state: BackgroundTasksState, reason: string, observedAt: number): BackgroundTasksSnapshot {
  return {
    state,
    available: false,
    reason,
    tasks: [],
    counts: emptyBgTaskCounts(),
    sessions: [],
    observedAt,
    activationId: null,
    revision: 0,
    nextCursors: {},
  };
}

/**
 * Finds the activation that owns a task, by asking each of them for its `detail`. The host
 * interface takes exact ids and has no "who owns this" call, and a `detail` read is an
 * in-memory lookup — cheaper and truer than keeping a pi-desk index of task ids, which would
 * be a second registry.
 */
async function resolveOwner(sessionId: string, taskId: string): Promise<BackgroundTaskHostClient | null> {
  const wrapper = getRpcSession(sessionId);
  if (!wrapper || !wrapper.isAlive()) return null;
  const bridges = projectBridges(wrapper.cwd);
  const ordered: BackgroundTasksBridge[] = [];
  const primary = bridges.find((bridge) => bridge.sessionId === sessionId);
  if (primary) ordered.push(primary);
  for (const bridge of bridges) if (bridge !== primary) ordered.push(bridge);
  const answers = await Promise.allSettled(ordered.map(async (bridge) => ({ bridge, detail: await bridge.client.detail(taskId) })));
  for (const answer of answers) {
    if (answer.status === "fulfilled" && parseBgTaskView(answer.value.detail.task)) return answer.value.bridge.client;
  }
  // Nobody has it: ask the primary, so the user reads the extension's own `NOT_FOUND`.
  return primary?.client ?? null;
}

/**
 * Runs one task operation and reports the extension's answer. Nothing here claims a task
 * stopped, reran or was acknowledged before the extension said so; a failure carries the
 * documented code (`NOT_RERUNNABLE`, `NOT_FOUND`, `LOG_UNAVAILABLE`, …) so the panel can say
 * what happened in the extension's terms.
 */
export async function runBackgroundTasksAction(
  sessionId: string,
  payload: BackgroundTasksActionPayload,
): Promise<BackgroundTasksActionOutcome> {
  try {
    if (payload.kind === "stop" || payload.kind === "rerun") {
      const taskId = payload.taskId;
      if (typeof taskId !== "string" || taskId.length === 0) {
        return { ok: false, code: "INVALID_REQUEST", message: "taskId must be a non-empty string" };
      }
      const client = await resolveOwner(sessionId, taskId);
      if (!client) return { ok: false, code: "UNAVAILABLE", message: "No running conversation of this project has a background-task registry." };
      const result = payload.kind === "stop" ? await client.stop(taskId) : await client.rerun(taskId);
      return { ok: true, result };
    }
    const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((id) => typeof id === "string" && id.length > 0) : [];
    if (taskIds.length === 0) {
      return { ok: false, code: "INVALID_REQUEST", message: "taskIds must be a non-empty array of exact task ids" };
    }
    if (payload.kind === "mark-seen") {
      // The seen set is per activation and shared with its dock, so every activation of the
      // project that has the task is asked. The answer the panel sees is the most informative
      // one: a task marked in the activation that owns it is "marked", and one activation
      // reporting `not_found` must not hide the activation that owns it saying "not_terminal".
      const wrapper = getRpcSession(sessionId);
      if (!wrapper || !wrapper.isAlive()) return { ok: false, code: "UNAVAILABLE", message: "This conversation is not running." };
      const bridges = projectBridges(wrapper.cwd);
      const answers = await Promise.allSettled(bridges.map((bridge) => bridge.client.markSeen(taskIds)));
      const outcomes = answers.flatMap((entry) => (entry.status === "fulfilled" ? entry.value.results : []));
      const rank: Record<string, number> = { marked: 3, already_seen: 2, not_terminal: 1, not_found: 0 };
      const best = new Map<string, string>();
      for (const entry of outcomes) {
        const current = best.get(entry.taskId);
        if (current === undefined || (rank[entry.outcome] ?? 0) > (rank[current] ?? 0)) best.set(entry.taskId, entry.outcome);
      }
      const results = taskIds.map((taskId) => ({ taskId, outcome: (best.get(taskId) ?? "not_found") as "marked" | "already_seen" | "not_terminal" | "not_found" }));
      return {
        ok: answers.some((entry) => entry.status === "fulfilled"),
        result: { results, marked: results.filter((entry) => entry.outcome === "marked").length },
      };
    }
    // stop_all: the documented selection is a frozen list, so each activation gets the ids it
    // owns and the answers are merged into one report. A conversation that is not running has no
    // activations at all, and "your ids were not found" is not the news: the panel is open on a
    // conversation that has ended.
    const live = getRpcSession(sessionId);
    if (!live || !live.isAlive()) {
      return { ok: false, code: "UNAVAILABLE", message: "This conversation is not running, so its background tasks are gone with it." };
    }
    const owners = new Map<string, BackgroundTaskHostClient>();
    for (const taskId of taskIds) {
      const client = await resolveOwner(sessionId, taskId);
      if (client) owners.set(taskId, client);
    }
    const groups = new Map<BackgroundTaskHostClient, string[]>();
    for (const [taskId, client] of owners) {
      const list = groups.get(client) ?? [];
      list.push(taskId);
      groups.set(client, list);
    }
    const perClient = await Promise.all(
      [...groups.entries()].map(async ([client, ids]) => {
        try {
          return { ids, result: await client.stopAll(ids) };
        } catch (error) {
          const failure = errorOf(error);
          const rows: BgStopAllRow[] = ids.map((taskId) => ({ taskId, outcome: "failed" as const, error: failure.message }));
          return { ids, result: { results: rows, stopped: 0, alreadyTerminal: 0, notFound: 0, failed: ids.length } };
        }
      }),
    );
    const results = perClient.flatMap((entry) => entry.result.results);
    const notFound = taskIds.filter((taskId) => !owners.has(taskId)).map((taskId) => ({ taskId, outcome: "not_found" as const }));
    const merged = [...results, ...notFound];
    return {
      ok: true,
      result: {
        results: merged,
        stopped: merged.filter((entry) => entry.outcome === "stopped").length,
        alreadyTerminal: merged.filter((entry) => entry.outcome === "already_terminal").length,
        notFound: merged.filter((entry) => entry.outcome === "not_found").length,
        failed: merged.filter((entry) => entry.outcome === "failed").length,
      },
    };
  } catch (error) {
    const failure = errorOf(error);
    return { ok: false, code: failure.code, message: failure.message };
  }
}

/** One bounded log window, read from the activation that owns the task. */
export async function readBackgroundTaskLogs(
  sessionId: string,
  taskId: string,
  options: { maxBytes?: number; tail?: boolean } = {},
): Promise<{ ok: true; result: Awaited<ReturnType<BackgroundTaskHostClient["logs"]>> } | { ok: false; code: BgHostErrorCode; message: string }> {
  try {
    const client = await resolveOwner(sessionId, taskId);
    if (!client) return { ok: false, code: "NOT_FOUND", message: "No running conversation of this project has that task." };
    return { ok: true, result: await client.logs(taskId, options) };
  } catch (error) {
    const failure = errorOf(error);
    return { ok: false, ...failure };
  }
}

/** The task the panel has selected, from the activation that owns it. */
export async function readBackgroundTaskDetail(sessionId: string, taskId: string) {
  try {
    const client = await resolveOwner(sessionId, taskId);
    if (!client) return { ok: false as const, code: "NOT_FOUND" as const, message: "No running conversation of this project has that task." };
    return { ok: true as const, result: await client.detail(taskId) };
  } catch (error) {
    return { ok: false as const, ...errorOf(error) };
  }
}

export interface BackgroundTasksChange {
  type: "change" | "bridges";
  sessionId: string;
  frame?: BgChangedFrame;
}

/**
 * Fans the project group's change frames out to one listener, and tells the listener when a
 * bridge joins or leaves (opening another conversation of the same project). Frames reach the
 * client through the SSE route; the client refetches and never trusts a frame's counts as the
 * list.
 */
export function subscribeBackgroundTasksChanges(
  sessionId: string,
  listener: (change: BackgroundTasksChange) => void,
): () => void {
  const wrapper = getRpcSession(sessionId);
  const cwd = wrapper && wrapper.isAlive() ? wrapper.cwd : null;
  const unsubscribers = new Set<() => void>();
  const attached = new Set<string>();
  const attach = () => {
    const bridges = cwd ? listBackgroundTasksBridgesForCwd(cwd) : [];
    for (const bridge of bridges) {
      if (attached.has(bridge.sessionId)) continue;
      attached.add(bridge.sessionId);
      const unsubscribe = bridge.client.onChanges((frame) => {
        listener({ type: "change", sessionId: bridge.sessionId, frame });
      });
      unsubscribers.add(unsubscribe);
    }
    for (const sessionId of [...attached]) {
      if (bridges.some((bridge) => bridge.sessionId === sessionId)) continue;
      attached.delete(sessionId);
    }
  };
  attach();
  const unsubscribeRegistry = subscribeBackgroundTasksBridgeRegistry(() => {
    listener({ type: "bridges", sessionId });
    attach();
  });
  return () => {
    unsubscribeRegistry();
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.clear();
    attached.clear();
  };
}

export interface BackgroundTasksBadge {
  running: number;
  unseenFailed: number;
  unseenKilled: number;
  unseenCompleted: number;
}

/** The numbers the header's button wears: live work, and finished work nobody has looked at. */
export function backgroundTasksBadge(counts: BgTaskCounts): BackgroundTasksBadge {
  return {
    running: counts.running,
    unseenFailed: counts.unseenFailed,
    unseenKilled: counts.unseenKilled,
    unseenCompleted: counts.unseenCompleted,
  };
}

export { compareBackgroundTaskViews, mergeBackgroundTaskViews, sumBackgroundTaskCounts, isBgTerminalStatus };
