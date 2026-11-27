"use client";

// The Background Tasks card: the header button's own panel, hung under the header.
//
// It is a monitor of `pi-background-tasks`' registry, and it reads like one: a row per task
// with its state, its command, its clock and its exit; a detail block for the selected task;
// a bounded tail of its output that follows while it runs and stops following the moment the
// user scrolls up. The card wears `.app-menu` like every other application menu in the app, so
// it is the same surface, the same radii, the same rows — a third-party dashboard welded into
// the conversation is exactly what this is not.
//
// Nothing is invented here. The rows, the counts, the exit codes and the log text are the
// extension's; an unavailable state says which case it is (not installed, disabled, this
// conversation is not running, the host interface has not answered yet, the activation closed)
// instead of showing an empty list and implying the project is idle.
//
// A Stop is a request: the row changes when the extension's answer arrives, and the card shows
// the extension's failure text (`NOT_FOUND`, `NOT_RERUNNABLE`, `LOG_UNAVAILABLE`) when it does
// not. Stop-all asks for the exact running selection, because that is what the host operation
// acts on — never a fresh scan of the registry behind the user's back.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackgroundTasksIcon } from "./TopbarBackgroundTasks";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";
import type { TranslationParams } from "@/lib/i18n/types";
import {
  BACKGROUND_TASK_FILTERS,
  BACKGROUND_TASK_LOG_FULL_WINDOW_BYTES,
  BACKGROUND_TASK_LOG_WINDOW_BYTES,
  backgroundTaskDetailRows,
  backgroundTaskDurationMs,
  backgroundTaskExitLabel,
  backgroundTaskTitle,
  countBackgroundTaskFilters,
  filterBackgroundTasks,
  formatBackgroundTaskDuration,
  formatBackgroundTaskTime,
  isUnseenFailure,
  shortenBackgroundTaskCommand,
  shouldFollowBackgroundTaskLog,
  type BackgroundTaskFilter,
} from "@/lib/background-tasks/session-view";
import type { BgTaskStatus, BgTaskView } from "@/lib/background-tasks/protocol";

export interface BackgroundTasksPanelProps {
  sessionId: string | null;
  open: boolean;
  onClose: () => void;
  translate: (key: string, params?: TranslationParams) => string;
}

const STATUS_KEYS: Record<BgTaskStatus, string> = {
  running: "backgroundTasks.status.running",
  completed: "backgroundTasks.status.completed",
  failed: "backgroundTasks.status.failed",
  killed: "backgroundTasks.status.killed",
};

const FILTER_KEYS: Record<BackgroundTaskFilter, string> = {
  all: "backgroundTasks.filter.all",
  running: "backgroundTasks.filter.running",
  completed: "backgroundTasks.filter.completed",
  failed: "backgroundTasks.filter.failed",
  killed: "backgroundTasks.filter.killed",
};

function statusGlyph(status: BgTaskStatus) {
  if (status === "running") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
    );
  }
  if (status === "completed") {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="2.5,6.5 5,9 9.5,3.5" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 7v6" /><path d="M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" />
    </svg>
  );
}

/** A row's clock: a running task's live duration, a finished one's end time and length. */
function rowClock(view: BgTaskView, now: number): string {
  const duration = formatBackgroundTaskDuration(backgroundTaskDurationMs(view, now));
  if (view.task.status === "running") return duration;
  return typeof view.task.endTime === "number"
    ? `${formatBackgroundTaskTime(view.task.endTime)} · ${duration}`
    : duration;
}

/** A row's last-known activity: how much the task has written, which is what a monitor shows. */
function rowActivity(view: BgTaskView, translate: (key: string, params?: TranslationParams) => string): string {
  const bytes = view.task.bytesWritten;
  if (bytes <= 0) return translate("backgroundTasks.noOutput");
  const kilobytes = bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} kB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return translate("backgroundTasks.outputBytes", { bytes: kilobytes });
}

export function BackgroundTasksPanel({ sessionId, open, onClose, translate }: BackgroundTasksPanelProps) {
  const {
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
  } = useBackgroundTasks({ sessionId, open });
  const [filter, setFilter] = useState<BackgroundTaskFilter>("all");
  const [wrapLogs, setWrapLogs] = useState(false);
  const [followLogs, setFollowLogs] = useState(true);
  const [confirmStopAll, setConfirmStopAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const logRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // A running row's clock ticks in the card, so a live task is visibly live. The tick is one
  // interval for the whole card, and it runs only while the card is open and work is running.
  const anyRunning = (snapshot?.counts.running ?? 0) > 0;
  useEffect(() => {
    if (!open || !anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning, open]);

  useEffect(() => {
    if (!open) {
      setConfirmStopAll(false);
      setFollowLogs(true);
    }
  }, [open]);

  // The card is opened by a click on the header; focus follows it, so the keyboard user is
  // inside the panel they asked for and Escape (the shell's handler) closes the right thing.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  const tasks = useMemo(() => snapshot?.tasks ?? [], [snapshot]);
  const visible = useMemo(() => filterBackgroundTasks(tasks, filter), [filter, tasks]);
  const filterCounts = useMemo(() => countBackgroundTaskFilters(tasks), [tasks]);
  const runningIds = useMemo(
    () => tasks.filter((view) => view.task.status === "running").map((view) => view.task.id),
    [tasks],
  );
  const selected = useMemo(
    () => tasks.find((view) => view.task.id === selectedTaskId) ?? detail?.view ?? null,
    [detail?.view, selectedTaskId, tasks],
  );
  const state = snapshot?.state ?? (sessionId ? "not-ready" : "no-session");
  const unavailable = state !== "ready";
  const stateKey = state === "not-installed"
    ? "backgroundTasks.notInstalled"
    : state === "disabled"
      ? "backgroundTasks.disabled"
      : state === "no-session"
        ? "backgroundTasks.noSession"
        : state === "closed"
          ? "backgroundTasks.closed"
          : "backgroundTasks.notReady";
  const detailRows = selected ? backgroundTaskDetailRows(selected) : [];

  // A log that grew while the bottom was in view stays pinned to the bottom; one the user
  // scrolled up is left where they put it. The rule is the extension's dock's, and it is the
  // only way a monitor's log is readable while the task is talking.
  useEffect(() => {
    const element = logRef.current;
    if (!element || !followLogs) return;
    element.scrollTop = element.scrollHeight;
  }, [followLogs, logs?.text, selectedTaskId]);

  const handleLogScroll = useCallback(() => {
    const element = logRef.current;
    if (!element) return;
    setFollowLogs(shouldFollowBackgroundTaskLog({
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
  }, []);

  if (!open) return null;

  const stopRunning = () => {
    void stopAll(runningIds);
    setConfirmStopAll(false);
  };

  return (
    <div
      className="bg-tasks-panel app-menu"
      role="dialog"
      aria-label={translate("backgroundTasks.title")}
      aria-modal="false"
      tabIndex={-1}
      ref={panelRef}
      data-background-tasks-panel=""
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="bg-tasks-head">
        <span className="bg-tasks-head-icon"><BackgroundTasksIcon size={14} strokeWidth={1.9} /></span>
        <strong className="bg-tasks-title">{translate("backgroundTasks.title")}</strong>
        {snapshot && (
          <span
            className="bg-tasks-head-counts"
            title={translate("backgroundTasks.headCounts", {
              running: snapshot.counts.running,
              completed: snapshot.counts.completed,
              failed: snapshot.counts.failed,
              killed: snapshot.counts.killed,
              total: snapshot.counts.total,
            })}
          >
            {snapshot.counts.running > 0 && (
              <span className="bg-tasks-head-running">
                {translate("backgroundTasks.runningCount", { running: snapshot.counts.running })}
              </span>
            )}
            <span className="bg-tasks-head-total">
              {translate("backgroundTasks.totalCount", { total: snapshot.counts.total })}
            </span>
          </span>
        )}
        <span className="bg-tasks-head-actions">
          <button
            type="button"
            className="bg-tasks-icon-button"
            onClick={refresh}
            title={translate("backgroundTasks.refresh")}
            aria-label={translate("backgroundTasks.refresh")}
            disabled={!sessionId}
          >
            <RefreshIcon />
          </button>
          <button
            type="button"
            className="bg-tasks-icon-button"
            onClick={onClose}
            title={translate("backgroundTasks.close")}
            aria-label={translate("backgroundTasks.close")}
          >
            <CloseIcon />
          </button>
        </span>
      </div>

      {(actionError || error) && (
        <div className="bg-tasks-notice" role="alert">
          <span>{actionError ? `${translate("backgroundTasks.actionFailed")}: ${actionError}` : error}</span>
          <button type="button" className="bg-tasks-notice-close" onClick={clearActionError} aria-label={translate("backgroundTasks.dismiss")}>
            <CloseIcon />
          </button>
        </div>
      )}

      {unavailable && (
        <div className="bg-tasks-state">
          <p className="bg-tasks-state-line">{translate(stateKey)}</p>
          {snapshot?.reason && <p className="bg-tasks-state-reason">{snapshot.reason}</p>}
          {state === "not-installed" && <p className="bg-tasks-state-reason">{translate("backgroundTasks.installHint")}</p>}
        </div>
      )}

      {!unavailable && (
        <>
          <div className="bg-tasks-filters" role="group" aria-label={translate("backgroundTasks.filters")}>
            {BACKGROUND_TASK_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                className={`bg-tasks-filter is-${key}${filter === key ? " is-active" : ""}`}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
              >
                <span>{translate(FILTER_KEYS[key])}</span>
                <span className="bg-tasks-filter-count">{filterCounts[key]}</span>
              </button>
            ))}
            {runningIds.length > 0 && (
              <span className="bg-tasks-filters-tail">
                {confirmStopAll ? (
                  <span className="bg-tasks-confirm">
                    <span>{translate("backgroundTasks.stopAllConfirm", { count: runningIds.length })}</span>
                    <button type="button" className="bg-tasks-confirm-button is-danger" onClick={stopRunning}>
                      {translate("backgroundTasks.stopAll")}
                    </button>
                    <button type="button" className="bg-tasks-confirm-button" onClick={() => setConfirmStopAll(false)}>
                      {translate("backgroundTasks.cancel")}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="bg-tasks-stop-all"
                    onClick={() => setConfirmStopAll(true)}
                    title={translate("backgroundTasks.stopAllHint")}
                  >
                    {translate("backgroundTasks.stopAll")}
                  </button>
                )}
              </span>
            )}
          </div>

          <div className="bg-tasks-list" role="list" aria-label={translate("backgroundTasks.list")}>
            {loading && tasks.length === 0 && <div className="bg-tasks-empty">{translate("backgroundTasks.loading")}</div>}
            {!loading && tasks.length === 0 && (
              <div className="bg-tasks-empty">
                <span>{translate("backgroundTasks.empty")}</span>
                <span className="bg-tasks-empty-hint">{translate("backgroundTasks.emptyHint")}</span>
              </div>
            )}
            {!loading && tasks.length > 0 && visible.length === 0 && (
              <div className="bg-tasks-empty">{translate("backgroundTasks.emptyFilter")}</div>
            )}
            {visible.map((view) => {
              const id = view.task.id;
              const isBusy = busy[id] === "stop" || busy[id] === "rerun";
              const otherSessions = (snapshot?.sessions.length ?? 0) > 1;
              const owner = snapshot?.sessions.find((session) => session.primary);
              return (
                <button
                  key={id}
                  type="button"
                  role="listitem"
                  className={`bg-tasks-row is-${view.task.status}${selectedTaskId === id ? " is-selected" : ""}${isUnseenFailure(view) ? " is-unseen" : ""}`}
                  onClick={() => selectTask(selectedTaskId === id ? null : id)}
                  aria-current={selectedTaskId === id ? "true" : undefined}
                  title={`${backgroundTaskTitle(view)} · ${shortenBackgroundTaskCommand(view.task.command)}`}
                >
                  <span className={`bg-tasks-status is-${view.task.status}`}>{statusGlyph(view.task.status)}</span>
                  <span className="bg-tasks-row-text">
                    <span className="bg-tasks-row-title">{backgroundTaskTitle(view)}</span>
                    <span className="bg-tasks-row-command">{shortenBackgroundTaskCommand(view.task.command)}</span>
                  </span>
                  <span className="bg-tasks-row-state">
                    <span className="bg-tasks-row-status-label">{translate(STATUS_KEYS[view.task.status])}</span>
                    <span className="bg-tasks-row-clock">{rowClock(view, now)}</span>
                    <span className="bg-tasks-row-activity">
                      {typeof view.task.pid === "number" && `pid ${String(view.task.pid)} · `}
                      {backgroundTaskExitLabel(view) ?? rowActivity(view, translate)}
                    </span>
                  </span>
                  {isBusy && <span className="bg-tasks-row-busy">{translate("backgroundTasks.stopping")}</span>}
                  {!isBusy && view.task.status === "running" && (
                    <span className="bg-tasks-row-actions">
                      <span
                        role="button"
                        tabIndex={0}
                        className="bg-tasks-row-stop"
                        title={translate("backgroundTasks.stop")}
                        onClick={(event) => {
                          event.stopPropagation();
                          void stopTask(id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          event.stopPropagation();
                          void stopTask(id);
                        }}
                      >
                        {translate("backgroundTasks.stop")}
                      </span>
                    </span>
                  )}
                  {otherSessions && owner && view.kind !== "shell" && null}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="bg-tasks-detail">
              <div className="bg-tasks-detail-head">
                <span className={`bg-tasks-status is-${selected.task.status}`}>{statusGlyph(selected.task.status)}</span>
                <strong className="bg-tasks-detail-title">{backgroundTaskTitle(selected)}</strong>
                <span className={`bg-tasks-detail-state is-${selected.task.status}`}>{translate(STATUS_KEYS[selected.task.status])}</span>
                <span className="bg-tasks-detail-actions">
                  {selected.canRerun && (
                    <button
                      type="button"
                      className="bg-tasks-action"
                      onClick={() => void rerunTask(selected.task.id)}
                      disabled={busy[selected.task.id] === "rerun"}
                      title={translate("backgroundTasks.rerunHint")}
                    >
                      {translate("backgroundTasks.rerun")}
                    </button>
                  )}
                  {!selected.canRerun && selected.task.status !== "running" && (
                    <span className="bg-tasks-detail-note">{translate("backgroundTasks.rerunOnlyShell")}</span>
                  )}
                  {selected.task.status === "running" && (
                    <button
                      type="button"
                      className="bg-tasks-action is-danger"
                      onClick={() => void stopTask(selected.task.id)}
                      disabled={busy[selected.task.id] === "stop"}
                    >
                      {busy[selected.task.id] === "stop" ? translate("backgroundTasks.stopping") : translate("backgroundTasks.stop")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="bg-tasks-icon-button"
                    onClick={() => selectTask(null)}
                    title={translate("backgroundTasks.closeTask")}
                    aria-label={translate("backgroundTasks.closeTask")}
                  >
                    <CloseIcon />
                  </button>
                </span>
              </div>

              <div className="bg-tasks-detail-command">
                <code>{selected.task.command}</code>
              </div>

              {selected.task.description && (
                <p className="bg-tasks-detail-description">{selected.task.description}</p>
              )}

              {selected.task.error && (
                <div className="bg-tasks-detail-error" role="status">
                  <strong>{translate("backgroundTasks.errorLabel")}</strong>
                  <span>{selected.task.error}</span>
                </div>
              )}

              <dl className="bg-tasks-detail-rows">
                {detailRows.map((row) => (
                  <div key={row.labelKey} className="bg-tasks-detail-row">
                    <dt>{translate(row.labelKey)}</dt>
                    <dd className={row.mono ? "is-mono" : undefined}>{row.value}</dd>
                  </div>
                ))}
                {snapshot?.sessionNames && (snapshot.sessions.length ?? 0) > 1 && (
                  <div className="bg-tasks-detail-row">
                    <dt>{translate("backgroundTasks.detail.startedIn")}</dt>
                    <dd>{Object.values(snapshot.sessionNames)[0] ?? ""}</dd>
                  </div>
                )}
              </dl>

              <div className="bg-tasks-log-head">
                <span>{translate("backgroundTasks.logs")}</span>
                {logs && (
                  <span className="bg-tasks-log-meta">
                    {logs.truncated
                      ? translate("backgroundTasks.logTruncated", {
                        shown: `${String(Math.round(logs.bytesRead / 1024))} kB`,
                        total: `${String(Math.round(logs.totalBytes / 1024))} kB`,
                      })
                      : translate("backgroundTasks.logShown", { bytes: `${String(Math.round(logs.bytesRead / 1024))} kB` })}
                  </span>
                )}
                <span className="bg-tasks-log-actions">
                  <button
                    type="button"
                    className="bg-tasks-action"
                    onClick={() => void loadLogs(selected.task.id, { maxBytes: BACKGROUND_TASK_LOG_FULL_WINDOW_BYTES })}
                    title={translate("backgroundTasks.logBiggerHint")}
                  >
                    {translate("backgroundTasks.logMore")}
                  </button>
                  <button
                    type="button"
                    className="bg-tasks-action"
                    onClick={() => void loadLogs(selected.task.id, { maxBytes: BACKGROUND_TASK_LOG_WINDOW_BYTES, tail: false })}
                    title={translate("backgroundTasks.logFromStartHint")}
                  >
                    {translate("backgroundTasks.logFromStart")}
                  </button>
                  <button
                    type="button"
                    className="bg-tasks-action"
                    onClick={() => setWrapLogs((value) => !value)}
                    aria-pressed={wrapLogs}
                    title={translate("backgroundTasks.logWrapHint")}
                  >
                    {translate("backgroundTasks.logWrap")}
                  </button>
                  <button
                    type="button"
                    className={`bg-tasks-action${followLogs ? " is-active" : ""}`}
                    onClick={() => setFollowLogs(true)}
                    aria-pressed={followLogs}
                    title={translate("backgroundTasks.logFollowHint")}
                  >
                    {translate("backgroundTasks.logFollow")}
                  </button>
                </span>
              </div>

              <div
                className={`bg-tasks-log${wrapLogs ? " is-wrapped" : ""}`}
                ref={logRef}
                onScroll={handleLogScroll}
                role="log"
                aria-live="polite"
                aria-label={translate("backgroundTasks.logs")}
                tabIndex={0}
              >
                {logs?.error && <div className="bg-tasks-log-empty">{logs.error}</div>}
                {!logs && <div className="bg-tasks-log-empty">{translate("backgroundTasks.logLoading")}</div>}
                {logs && !logs.error && logs.text.length === 0 && (
                  <div className="bg-tasks-log-empty">{translate("backgroundTasks.logEmpty")}</div>
                )}
                {logs && !logs.error && logs.text.length > 0 && <pre className="bg-tasks-log-text">{logs.text}</pre>}
              </div>
              {followLogs && selected.task.status === "running" && (
                <div className="bg-tasks-log-following">{translate("backgroundTasks.logFollowing")}</div>
              )}
              {!followLogs && (
                <div className="bg-tasks-log-following is-paused">{translate("backgroundTasks.logPaused")}</div>
              )}
            </div>
          )}

          {(snapshot?.sessions.length ?? 0) > 1 && (
            <div className="bg-tasks-sessions">
              {snapshot!.sessions.map((session) => (
                <span key={session.sessionId} className={`bg-tasks-session is-${session.state}${session.primary ? " is-primary" : ""}`}>
                  {snapshot?.sessionNames?.[session.sessionId] ?? session.sessionId}
                  {session.counts.running > 0 && <span className="bg-tasks-session-count">{session.counts.running}</span>}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
