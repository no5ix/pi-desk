/**
 * What the Background Tasks panel shows, computed from the extension's own task views.
 *
 * Nothing here invents a task, a status or a duration: every value is read out of a
 * `BgTaskView` the extension published. What this module owns is presentation-only — the
 * filter buckets, the labels, the durations, the byte windows — so the panel's component
 * stays layout and the rules are testable in Node.
 *
 * The panel is a monitor of the extension's registry, so its bounds are the extension's
 * bounds: one page of tasks per activation (50), one bounded log window per read
 * (`logs` answers at most 64 KiB, and a following view re-reads at most once a second —
 * the extension's own rule for a following detail view), and no request at all while the
 * panel is closed.
 */

import {
  BG_HOST_MAX_LOG_BYTES,
  isBgTerminalStatus,
  type BgTaskCounts,
  type BgTaskStatus,
  type BgTaskView,
} from "./protocol";

export type BackgroundTaskFilter = "all" | BgTaskStatus;

/**
 * The panel's snapshot, as `/api/background-tasks` answers it: the merged task list of this
 * project's live conversations, the extension's counts, and the availability state.
 * `sessionNames` is the app's own label for each conversation (a task's owning conversation
 * is the one that started it, and the panel says which). `nextCursors` pages each activation
 * separately, because a cursor is scoped to the activation that made it.
 */
export interface BackgroundTasksView {
  state: "ready" | "not-ready" | "no-session" | "not-installed" | "disabled" | "closed";
  available: boolean;
  reason?: string;
  tasks: BgTaskView[];
  counts: BgTaskCounts;
  sessions: Array<{
    sessionId: string;
    cwd: string;
    state: "ready" | "not-ready" | "closed";
    counts: BgTaskCounts;
    primary: boolean;
  }>;
  sessionNames?: Record<string, string>;
  observedAt: number;
  activationId: string | null;
  revision: number;
  nextCursors: Record<string, string>;
}

/** Newest first, the extension's own ordering: start time, then id. */
export function compareBackgroundTaskViews(a: BgTaskView, b: BgTaskView): number {
  if (a.task.startTime !== b.task.startTime) return b.task.startTime - a.task.startTime;
  return a.task.id < b.task.id ? 1 : a.task.id > b.task.id ? -1 : 0;
}

/**
 * Merges task views by task id, newest state first. A task reported by two activations — the
 * same conversation live twice across a reload — is one row, and it is never stoppable twice.
 * The first group wins a collision, so callers pass the group whose state they want to show.
 */
export function mergeBackgroundTaskViews(groups: BgTaskView[][]): BgTaskView[] {
  const byId = new Map<string, BgTaskView>();
  for (const group of groups) {
    for (const view of group) {
      const existing = byId.get(view.task.id);
      if (!existing) {
        byId.set(view.task.id, view);
        continue;
      }
      // A terminal state observed once is not replaced by a running snapshot of the same id
      // from a second activation: the row must not flip back to "running" after it ended.
      if (existing.task.status === "running" && view.task.status !== "running") {
        byId.set(view.task.id, view);
      }
    }
  }
  return [...byId.values()].sort(compareBackgroundTaskViews);
}

/** Sums the per-activation counts, which each cover every task that activation retains. */
export function sumBackgroundTaskCounts(counts: BgTaskCounts[]): BgTaskCounts {
  const totals: BgTaskCounts = {
    running: 0,
    completed: 0,
    failed: 0,
    killed: 0,
    unseenCompleted: 0,
    unseenFailed: 0,
    unseenKilled: 0,
    total: 0,
  };
  for (const entry of counts) {
    totals.running += entry.running;
    totals.completed += entry.completed;
    totals.failed += entry.failed;
    totals.killed += entry.killed;
    totals.unseenCompleted += entry.unseenCompleted;
    totals.unseenFailed += entry.unseenFailed;
    totals.unseenKilled += entry.unseenKilled;
    totals.total += entry.total;
  }
  return totals;
}

export const BACKGROUND_TASK_FILTERS: readonly BackgroundTaskFilter[] = [
  "all",
  "running",
  "completed",
  "failed",
  "killed",
];

/** One log window per read; a following view re-reads at most this often (the extension's rule). */
export const BACKGROUND_TASK_LOG_WINDOW_BYTES = 16384;
export const BACKGROUND_TASK_LOG_FULL_WINDOW_BYTES = 65536;
export const BACKGROUND_TASK_LOG_FOLLOW_INTERVAL_MS = 1000;
/** A change frame is the refresh trigger; this is the safety net for a stream that went quiet. */
export const BACKGROUND_TASK_POLL_INTERVAL_MS = 20_000;
/** A burst of change frames (a task starting, its output, its terminal state) is one refresh. */
export const BACKGROUND_TASK_REFRESH_DEBOUNCE_MS = 150;
/** The list page. The extension's own cap; more than a monitor shows at once. */
export const BACKGROUND_TASK_PAGE_SIZE = 50;

/** The filter buckets, over the tasks the panel has. */
export function filterBackgroundTasks(tasks: BgTaskView[], filter: BackgroundTaskFilter): BgTaskView[] {
  if (filter === "all") return tasks;
  return tasks.filter((view) => view.task.status === filter);
}

/** The counts of what the panel is showing, per bucket, for the filter chips. */
export function countBackgroundTaskFilters(tasks: BgTaskView[]): Record<BackgroundTaskFilter, number> {
  const counts: Record<BackgroundTaskFilter, number> = { all: tasks.length, running: 0, completed: 0, failed: 0, killed: 0 };
  for (const view of tasks) counts[view.task.status] += 1;
  return counts;
}

/**
 * The header's badge: a running count, and the mark of finished work nobody has acknowledged.
 * `unseen*` is the extension's seen set — shared with its TUI dock, `/bg-clear` and the detail
 * views — so opening a task here clears the same badge the dock wears, and nothing is
 * acknowledged by merely listing it.
 */
export function backgroundTasksBadge(counts: BgTaskCounts): {
  running: number;
  unseenFailed: number;
  unseenKilled: number;
  unseenCompleted: number;
  total: number;
} {
  return {
    running: counts.running,
    unseenFailed: counts.unseenFailed,
    unseenKilled: counts.unseenKilled,
    unseenCompleted: counts.unseenCompleted,
    total: counts.total,
  };
}

/** The task's own name, falling back to what it runs. A nameless shell task is its command. */
export function backgroundTaskTitle(view: BgTaskView): string {
  const name = view.task.name?.trim();
  if (name) return name;
  const command = view.task.command.trim();
  if (command) return command.split("\n")[0].slice(0, 120);
  return view.task.id;
}

/** The command, on one line, shortened in the middle: the tail of a pipeline matters more than its tail's tail. */
export function shortenBackgroundTaskCommand(command: string, maximum = 160): string {
  const line = command.replace(/\s+/g, " ").trim();
  if (line.length <= maximum) return line;
  const head = Math.ceil((maximum - 1) * 0.62);
  const tail = Math.floor((maximum - 1) * 0.38);
  return `${line.slice(0, head)}…${line.slice(line.length - tail)}`;
}

/** Milliseconds a task has been, or was, running. A running task has no end, so `now` is its clock. */
export function backgroundTaskDurationMs(view: BgTaskView, now: number = Date.now()): number {
  const end = isBgTerminalStatus(view.task.status) && typeof view.task.endTime === "number"
    ? view.task.endTime
    : now;
  const start = view.task.startTime;
  if (typeof start !== "number" || !Number.isFinite(start)) return 0;
  return Math.max(0, end - start);
}

/** `48s`, `7m12s`, `2h04m` — a duration a monitor row can be scanned at. */
export function formatBackgroundTaskDuration(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  if (total < 60) return `${String(total)}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

/** A wall-clock time, for a finished task's row. */
export function formatBackgroundTaskTime(epochMs: number, locale = "en-US"): string {
  if (!Number.isFinite(epochMs)) return "";
  const date = new Date(epochMs);
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date);
}

/** A date/time for a detail row, in the user's format. */
export function formatBackgroundTaskDateTime(epochMs: number, locale = "en-US"): string {
  if (!Number.isFinite(epochMs)) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(epochMs));
}

/** `exit 1`, `SIGTERM`, `running` — one short line for the row's status cell. */
export function backgroundTaskExitLabel(view: BgTaskView): string | null {
  const task = view.task;
  if (task.status === "running") return null;
  if (typeof task.exitCode === "number") return `exit ${String(task.exitCode)}`;
  if (task.signal) return String(task.signal);
  return task.status;
}

/** Whether the row is worth a red mark: a failure nobody has read. */
export function isUnseenFailure(view: BgTaskView): boolean {
  return view.task.status === "failed" && view.seen === false;
}

/** The log window's byte bound, kept inside the extension's own cap. */
export function backgroundTaskLogWindowBytes(value: number | undefined): number {
  const requested = typeof value === "number" ? Math.round(value) : BACKGROUND_TASK_LOG_WINDOW_BYTES;
  return Math.max(1, Math.min(BG_HOST_MAX_LOG_BYTES, requested));
}

/**
 * True when a viewer pinned to the bottom should follow new output.
 *
 * A monitor that yanks the viewport down while the user scrolls up through a log is a
 * monitor the user cannot read, so the rule is the TUI dock's: follow while the bottom is
 * in sight, freeze when it is not, resume when it comes back.
 */
export function shouldFollowBackgroundTaskLog(input: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  const { scrollTop, scrollHeight, clientHeight } = input;
  return scrollHeight - (scrollTop + clientHeight) <= 24;
}

/** The rows a detail panel shows, in order, with nothing invented for a missing value. */
/** One detail row. `labelKey` is an i18n key — the monitor is translated in every language. */
export interface BackgroundTaskDetailRow {
  labelKey: string;
  value: string;
  mono?: boolean;
}

/**
 * The details of one task, in the order a reader scans them: what it is, where it ran, when
 * it ran, how it ended, and where its output lives. A row appears only when the task reported
 * the value — an empty row for a task that never wrote a byte is noise, and a row that guesses
 * at a PID the extension did not publish is a lie.
 */
export function backgroundTaskDetailRows(view: BgTaskView): BackgroundTaskDetailRow[] {
  const task = view.task;
  const rows: BackgroundTaskDetailRow[] = [];
  if (typeof task.pid === "number") rows.push({ labelKey: "backgroundTasks.detail.pid", value: String(task.pid) });
  rows.push({ labelKey: "backgroundTasks.detail.cwd", value: task.cwd, mono: true });
  rows.push({ labelKey: "backgroundTasks.detail.started", value: formatBackgroundTaskDateTime(task.startTime) });
  if (typeof task.endTime === "number") rows.push({ labelKey: "backgroundTasks.detail.ended", value: formatBackgroundTaskDateTime(task.endTime) });
  const exit = backgroundTaskExitLabel(view);
  if (exit) rows.push({ labelKey: "backgroundTasks.detail.exit", value: exit, mono: true });
  if (typeof task.timeoutSeconds === "number") rows.push({ labelKey: "backgroundTasks.detail.timeout", value: `${String(task.timeoutSeconds)}s` });
  if (task.bytesWritten > 0) rows.push({ labelKey: "backgroundTasks.detail.bytes", value: String(task.bytesWritten) });
  rows.push({ labelKey: "backgroundTasks.detail.outputFile", value: task.outputPath, mono: true });
  if (task.model) rows.push({ labelKey: "backgroundTasks.detail.model", value: task.model, mono: true });
  if (task.tokenUsage) {
    rows.push({ labelKey: "backgroundTasks.detail.tokens", value: `\u2191${String(task.tokenUsage.input)} \u2193${String(task.tokenUsage.output)}` });
  }
  if (task.telemetryUnavailableReason) {
    rows.push({ labelKey: "backgroundTasks.detail.telemetry", value: task.telemetryUnavailableReason });
  }
  return rows;
}

export { isBgTerminalStatus };
