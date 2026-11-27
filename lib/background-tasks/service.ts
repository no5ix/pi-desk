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
  parseBgTaskViews,
  type BgChangedFrame,
  type BgHostErrorCode,
  type BgTaskCounts,
  type BgTaskView,
} from "./protocol";
import { type BackgroundTaskHostClient } from "./host-client";
import {
  getBackgroundTasksBridge,
  subscribeBackgroundTasksBridgeRegistry,
  type BackgroundTasksBridge,
} from "./bridges";
import { clearBackgroundTasksRunning, recordBackgroundTasksRunning } from "./running-index";
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
  /**
   * `stop-all` without an explicit selection: the running ids are read from this conversation's
   * registry at that instant and frozen, which is what the documented `stop_all` acts on. The
   * composer's stop control uses it — it has the count, not the ids.
   */
  allRunning?: boolean;
}

export interface BackgroundTasksActionOutcome {
  ok: boolean;
  code?: BgHostErrorCode;
  message?: string;
  result?: unknown;
}

/** The conversations whose registries the panel reads: the live ones of the same project. */
/**
 * The registries the panel reads: this conversation's own activation, asked by id.
 *
 * One conversation, one registry. The project's other conversations run their own extension
 * activation with their own tasks, and folding them in made the card show tasks the user never
 * started here — nine rows for a conversation that ran none — while the commands that belong to
 * this conversation (`/bg`, the dock, `/bg-clear`) talk to its own registry. A task of another
 * conversation is that conversation's monitor's business.
 */
function sessionBridges(sessionId: string): BackgroundTasksBridge[] {
  const bridge = getBackgroundTasksBridge(sessionId);
  return bridge ? [bridge] : [];
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
  const bridges = sessionBridges(sessionId);
  if (bridges.length === 0) {
    // No bridge for this conversation at all: it is live but the extension is not in it
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
      // The composer's stop control and the sidebar's running mark read this index, so a card
      // that is open keeps the app's own numbers honest, not only its own rows.
      recordBackgroundTasksRunning(bridge.sessionId, { ...result.counts, observedAt });
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
    if (failure.code === "CLOSED") clearBackgroundTasksRunning(bridge.sessionId);
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
 * The client for a task: this conversation's activation. The host interface takes exact ids and
 * has no "who owns this" call, so an id the extension does not know is answered with its own
 * `NOT_FOUND` — which is the true news, and truer than a pi-desk index of task ids (a second
 * registry) or a probe of the project's other conversations, whose tasks this card does not show.
 */
async function resolveOwner(sessionId: string): Promise<BackgroundTaskHostClient | null> {
  return sessionBridges(sessionId)[0]?.client ?? null;
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
      const client = await resolveOwner(sessionId);
      if (!client) return { ok: false, code: "UNAVAILABLE", message: "This conversation has no background-task registry." };
      const result = payload.kind === "stop" ? await client.stop(taskId) : await client.rerun(taskId);
      return { ok: true, result };
    }
    let taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.filter((id) => typeof id === "string" && id.length > 0) : [];
    if (payload.kind === "stop-all" && payload.allRunning === true && taskIds.length === 0) {
      // No selection was sent, because the control that asked has a count and not a list. Read
      // this conversation's registry once, take what is running at that instant, and stop that
      // frozen set — the same contract the panel's "Stop all" follows.
      const bridge = sessionBridges(sessionId)[0];
      if (!bridge) return { ok: false, code: "UNAVAILABLE", message: "This conversation has no background-task registry." };
      const live = await bridge.client.list({});
      taskIds = parseBgTaskViews(live.tasks)
        .filter((view) => view.task.status === "running")
        .map((view) => view.task.id);
      if (taskIds.length === 0) {
        return { ok: true, result: { results: [], stopped: 0, alreadyTerminal: 0, notFound: 0, failed: 0 } };
      }
    }
    if (taskIds.length === 0) {
      return { ok: false, code: "INVALID_REQUEST", message: "taskIds must be a non-empty array of exact task ids" };
    }
    if (payload.kind === "mark-seen") {
      // The seen set is per activation and shared with its dock, so this conversation's
      // activation is asked. The answer the panel sees is the most informative one: a task
      // marked is "marked", and a `not_terminal` (the task is still running) is not hidden by
      // a `not_found` from somewhere else.
      const wrapper = getRpcSession(sessionId);
      if (!wrapper || !wrapper.isAlive()) return { ok: false, code: "UNAVAILABLE", message: "This conversation is not running." };
      const bridges = sessionBridges(sessionId);
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
      const client = await resolveOwner(sessionId);
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
    const client = await resolveOwner(sessionId);
    if (!client) return { ok: false, code: "NOT_FOUND", message: "This conversation has no task with that id." };
    return { ok: true, result: await client.logs(taskId, options) };
  } catch (error) {
    const failure = errorOf(error);
    return { ok: false, ...failure };
  }
}

/** The task the panel has selected, from the activation that owns it. */
export async function readBackgroundTaskDetail(sessionId: string, taskId: string) {
  try {
    const client = await resolveOwner(sessionId);
    if (!client) return { ok: false as const, code: "NOT_FOUND" as const, message: "This conversation has no task with that id." };
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
 * Fans this conversation's change frames out to one listener, and tells the listener when its
 * bridge joins or leaves (a conversation re-created, a plugin reloaded). Frames reach the client
 * through the SSE route; the client refetches and never trusts a frame's counts as the list.
 */
export function subscribeBackgroundTasksChanges(
  sessionId: string,
  listener: (change: BackgroundTasksChange) => void,
): () => void {
  const unsubscribers = new Set<() => void>();
  const attached = new Set<string>();
  const attach = () => {
    const bridges = sessionBridges(sessionId);
    for (const bridge of bridges) {
      if (attached.has(bridge.sessionId)) continue;
      attached.add(bridge.sessionId);
      const unsubscribe = bridge.client.onChanges((frame) => {
        listener({ type: "change", sessionId: bridge.sessionId, frame });
      });
      unsubscribers.add(unsubscribe);
    }
    for (const attachedId of [...attached]) {
      if (bridges.some((bridge) => bridge.sessionId === attachedId)) continue;
      attached.delete(attachedId);
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
