"use client";

// The Background Tasks panel's data.
//
// One rule runs through this hook: the extension is the task list. Every read is a request to
// the session's `pi-background-tasks` host interface through the app's API, and every write is
// answered by the extension — a task is shown stopped only after the extension's `stop`
// settled, and rerun only on its `rerun` result. Nothing here keeps a task registry: the state
// is the last snapshot, and a snapshot is thrown away the moment the conversation changes.
//
// Two levels of liveness, because a monitor that polls when nobody looks is a monitor that
// costs:
// - the header's badge: a light snapshot (one task per activation) on a slow tick, refreshed
//   on focus, and skipped while the tab is hidden;
// - the open panel: the change stream, which is the extension's own invalidation feed, plus a
//   slow safety net for a stream this tab lost, and a one-second bounded log window while a
//   selected task is running (at most once a second — the extension's rule for a following
//   view), one window per read, never a whole log.
//
// Requests carry monotonic ids: a response from a conversation the user has left is dropped,
// so a slow reply of the previous session can never paint the panel of the new one.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BgTaskView } from "@/lib/background-tasks/protocol";
import {
  BACKGROUND_TASK_LOG_FOLLOW_INTERVAL_MS,
  BACKGROUND_TASK_LOG_WINDOW_BYTES,
  BACKGROUND_TASK_PAGE_SIZE,
  BACKGROUND_TASK_POLL_INTERVAL_MS,
  BACKGROUND_TASK_REFRESH_DEBOUNCE_MS,
  mergeBackgroundTaskViews,
  type BackgroundTasksView,
} from "@/lib/background-tasks/session-view";

export interface BackgroundTasksLogState {
  taskId: string;
  text: string;
  path: string;
  totalBytes: number;
  bytesRead: number;
  bytesWritten: number;
  truncated: boolean;
  windowStart: number;
  windowEnd: number;
  error?: string;
}

export interface BackgroundTasksDetailState {
  taskId: string;
  view: BgTaskView | null;
  error?: string;
}

export type BackgroundTasksBusy = Record<string, "stop" | "rerun" | "mark-seen">;

export interface UseBackgroundTasksOptions {
  /** The conversation whose runtime the panel reads; null stops every request. */
  sessionId: string | null;
  open: boolean;
}

export interface UseBackgroundTasksResult {
  snapshot: BackgroundTasksView | null;
  loading: boolean;
  error: string | null;
  /** The last action's failure, in the extension's terms (`NOT_RERUNNABLE`, `NOT_FOUND`, …). */
  actionError: string | null;
  busy: BackgroundTasksBusy;
  detail: BackgroundTasksDetailState | null;
  logs: BackgroundTasksLogState | null;
  selectedTaskId: string | null;
  refresh: () => void;
  selectTask: (taskId: string | null) => void;
  stopTask: (taskId: string) => Promise<boolean>;
  stopAll: (taskIds: string[]) => Promise<boolean>;
  rerunTask: (taskId: string) => Promise<boolean>;
  loadLogs: (taskId: string, options?: { maxBytes?: number; tail?: boolean }) => Promise<void>;
  clearActionError: () => void;
}

interface LogsResponseBody {
  ok?: boolean;
  code?: string;
  message?: string;
  text?: string;
  path?: string;
  totalBytes?: number;
  bytesRead?: number;
  bytesWritten?: number;
  truncated?: boolean;
  windowStart?: number;
  windowEnd?: number;
}

export function useBackgroundTasks({ sessionId, open }: UseBackgroundTasksOptions): UseBackgroundTasksResult {
  const [snapshot, setSnapshot] = useState<BackgroundTasksView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<BackgroundTasksBusy>({});
  const [detail, setDetail] = useState<BackgroundTasksDetailState | null>(null);
  const [logs, setLogs] = useState<BackgroundTasksLogState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const snapshotRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const logsRequestRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const snapshotRef = useRef<BackgroundTasksView | null>(null);
  snapshotRef.current = snapshot;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
  }, []);

  // A conversation switch is a new runtime: the tasks of the one left behind are gone with
  // it, and showing them over the new conversation would be a lie about work in progress.
  useEffect(() => {
    snapshotRequestRef.current += 1;
    setSnapshot(null);
    setDetail(null);
    setLogs(null);
    setSelectedTaskId(null);
    setBusy({});
    setError(null);
    setActionError(null);
  }, [sessionId]);

  const fetchSnapshot = useCallback(async (options: { merge?: boolean } = {}) => {
    if (!sessionId) return;
    const requestId = ++snapshotRequestRef.current;
    setLoading(true);
    // The badge asks for one task per activation: it needs the counts, not the list.
    const limit = open ? BACKGROUND_TASK_PAGE_SIZE : 1;
    try {
      const response = await fetch(
        `/api/background-tasks?session=${encodeURIComponent(sessionId)}&limit=${String(limit)}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => null) as BackgroundTasksView | null;
      if (requestId !== snapshotRequestRef.current || !mountedRef.current) return;
      if (!response.ok || !body) {
        setError(body?.reason || `Request failed (${String(response.status)})`);
        return;
      }
      setError(null);
      setSnapshot((current) => (options.merge && current
        ? { ...body, tasks: mergeBackgroundTaskViews([body.tasks, current.tasks]) }
        : body));
    } catch (requestError) {
      if (requestId !== snapshotRequestRef.current || !mountedRef.current) return;
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      if (requestId === snapshotRequestRef.current && mountedRef.current) setLoading(false);
    }
  }, [open, sessionId]);

  const refresh = useCallback(() => {
    void fetchSnapshot({ merge: true });
  }, [fetchSnapshot]);

  // A burst of change frames — a task starting, its output growing, its terminal state —
  // arrives as several frames inside one second. One refresh serves them all.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void fetchSnapshot({ merge: true });
    }, BACKGROUND_TASK_REFRESH_DEBOUNCE_MS);
  }, [fetchSnapshot]);

  // The badge ticks; the open panel streams and ticks slowly as a safety net.
  useEffect(() => {
    if (!sessionId) return;
    void fetchSnapshot({ merge: false });
    const interval = open ? BACKGROUND_TASK_POLL_INTERVAL_MS : Math.max(BACKGROUND_TASK_POLL_INTERVAL_MS, 15_000);
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void fetchSnapshot({ merge: false });
    }, interval);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchSnapshot({ merge: false });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchSnapshot, open, sessionId]);

  // The change stream, while the panel is open. Closing the panel closes the stream: a
  // monitor nobody is reading asks for nothing.
  useEffect(() => {
    if (!sessionId || !open) return;
    const source = new EventSource(`/api/background-tasks/events?session=${encodeURIComponent(sessionId)}`);
    source.onmessage = (event) => {
      let frame: { type?: string };
      try {
        frame = JSON.parse(String(event.data)) as { type?: string };
      } catch {
        return;
      }
      if (frame.type === "change" || frame.type === "bridges" || frame.type === "hello") scheduleRefresh();
    };
    // EventSource reconnects by itself; the snapshot on open and the slow poll cover the gap.
    source.onerror = () => { /* the poll is the safety net */ };
    return () => source.close();
  }, [open, scheduleRefresh, sessionId]);

  const postAction = useCallback(async (
    payload: Record<string, unknown>,
    taskIds: string[],
    kind: "stop" | "rerun" | "mark-seen" | "stop-all",
  ): Promise<boolean> => {
    if (!sessionId) return false;
    // One in-flight action per task, and one for stop-all, so a double tap cannot send two
    // stops and the row cannot show two spinners.
    const keys = kind === "stop-all" ? ["*"] : taskIds;
    setBusy((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = kind === "stop-all" ? "stop" : kind;
      return next;
    });
    setActionError(null);
    try {
      const response = await fetch("/api/background-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: sessionId, ...payload }),
      });
      const body = await response.json().catch(() => null) as
        { ok?: boolean; code?: string; message?: string } | null;
      if (!mountedRef.current) return false;
      const ok = response.ok && body?.ok === true;
      if (!ok) {
        setActionError(body?.message || body?.code || `The request failed (${String(response.status)})`);
        return false;
      }
      // The extension's answer is the news: refetch and let its list say what happened.
      void fetchSnapshot({ merge: false });
      return true;
    } catch (requestError) {
      if (mountedRef.current) {
        setActionError(requestError instanceof Error ? requestError.message : String(requestError));
      }
      return false;
    } finally {
      if (mountedRef.current) {
        setBusy((current) => {
          const next = { ...current };
          for (const key of keys) delete next[key];
          return next;
        });
      }
    }
  }, [fetchSnapshot, sessionId]);

  const loadDetail = useCallback(async (taskId: string) => {
    if (!sessionId) return;
    const requestId = ++detailRequestRef.current;
    setDetail({ taskId, view: null });
    try {
      const response = await fetch(
        `/api/background-tasks/task?session=${encodeURIComponent(sessionId)}&taskId=${encodeURIComponent(taskId)}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => null) as
        { ok?: boolean; result?: { task?: BgTaskView }; code?: string; message?: string } | null;
      if (requestId !== detailRequestRef.current || !mountedRef.current) return;
      const task = body?.ok && body.result?.task ? body.result.task : null;
      setDetail({ taskId, view: task, error: body?.ok ? undefined : (body?.message || body?.code) });
    } catch (requestError) {
      if (requestId !== detailRequestRef.current || !mountedRef.current) return;
      setDetail({
        taskId,
        view: null,
        error: requestError instanceof Error ? requestError.message : String(requestError),
      });
    }
  }, [sessionId]);

  const loadLogs = useCallback(async (taskId: string, options: { maxBytes?: number; tail?: boolean } = {}) => {
    if (!sessionId) return;
    const requestId = ++logsRequestRef.current;
    const maxBytes = options.maxBytes ?? BACKGROUND_TASK_LOG_WINDOW_BYTES;
    try {
      const response = await fetch(
        `/api/background-tasks/task?session=${encodeURIComponent(sessionId)}&taskId=${encodeURIComponent(taskId)}`
        + `&type=logs&maxBytes=${String(maxBytes)}&tail=${options.tail === false ? "false" : "true"}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => null) as LogsResponseBody | null;
      if (requestId !== logsRequestRef.current || !mountedRef.current) return;
      if (!response.ok || body?.ok !== true) {
        setLogs({
          taskId,
          text: "",
          path: "",
          totalBytes: 0,
          bytesRead: 0,
          bytesWritten: 0,
          truncated: false,
          windowStart: 0,
          windowEnd: 0,
          error: body?.message || body?.code || `The log could not be read (${String(response.status)})`,
        });
        return;
      }
      // Each read is one bounded window and replaces the last: a window is the end of the
      // log, so stitching windows together would duplicate their boundary.
      setLogs({
        taskId,
        text: body.text ?? "",
        path: body.path ?? "",
        totalBytes: body.totalBytes ?? 0,
        bytesRead: body.bytesRead ?? 0,
        bytesWritten: body.bytesWritten ?? 0,
        truncated: body.truncated === true,
        windowStart: body.windowStart ?? 0,
        windowEnd: body.windowEnd ?? 0,
      });
    } catch (requestError) {
      if (requestId !== logsRequestRef.current || !mountedRef.current) return;
      setLogs({
        taskId,
        text: "",
        path: "",
        totalBytes: 0,
        bytesRead: 0,
        bytesWritten: 0,
        truncated: false,
        windowStart: 0,
        windowEnd: 0,
        error: requestError instanceof Error ? requestError.message : String(requestError),
      });
    }
  }, [sessionId]);

  const stopTask = useCallback(async (taskId: string) => {
    const ok = await postAction({ action: "stop", taskId }, [taskId], "stop");
    // The extension's `stop` resolved: refresh the one task, so the row shows the terminal
    // state it reported rather than the state the click guessed.
    if (ok) void loadDetail(taskId);
    return ok;
  }, [loadDetail, postAction]);

  const stopAll = useCallback(async (taskIds: string[]) =>
    postAction({ action: "stop-all", taskIds }, taskIds, "stop-all"), [postAction]);

  const rerunTask = useCallback(async (taskId: string) =>
    postAction({ action: "rerun", taskId }, [taskId], "rerun"), [postAction]);

  const selectTask = useCallback((taskId: string | null) => {
    setSelectedTaskId(taskId);
    if (!taskId) {
      detailRequestRef.current += 1;
      logsRequestRef.current += 1;
      setDetail(null);
      setLogs(null);
      return;
    }
    void loadDetail(taskId);
    void loadLogs(taskId);
    // Opening a finished task acknowledges it, exactly as the extension's dock does: the same
    // seen set, marked by the same operation, so a badge cleared here is cleared there too.
    const view = snapshotRef.current?.tasks.find((task) => task.task.id === taskId);
    if (view && view.task.status !== "running" && !view.seen) {
      void postAction({ action: "mark-seen", taskIds: [taskId] }, [taskId], "mark-seen");
    }
  }, [loadDetail, loadLogs, postAction]);

  // A running task's log follows at most once a second, one bounded window per read.
  const runningSelectedTaskId = useMemo(() => {
    if (!selectedTaskId) return null;
    const view = snapshot?.tasks.find((task) => task.task.id === selectedTaskId);
    return view?.task.status === "running" ? selectedTaskId : null;
  }, [selectedTaskId, snapshot]);

  useEffect(() => {
    if (!open || !runningSelectedTaskId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadLogs(runningSelectedTaskId);
    }, BACKGROUND_TASK_LOG_FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadLogs, open, runningSelectedTaskId]);

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    snapshot,
    loading,
    error,
    actionError,
    busy,
    detail,
    logs,
    selectedTaskId,
    refresh,
    selectTask,
    stopTask,
    stopAll,
    rerunTask,
    loadLogs,
    clearActionError,
  };
}
