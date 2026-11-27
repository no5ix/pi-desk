"use client";

import { useMemo, useState, type ReactNode } from "react";
import { sideChatTitle } from "@/lib/session-family";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { isImeComposing } from "@/lib/ime";
import { AgentRunningIcon } from "./TopbarSubagents";
import { SideChatIcon, SideChatPlusIcon } from "./SideChatIcon";
import { errorMessage } from "@/lib/errors";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
  /** C1: side chats with a tab in the open right panel. */
  openSideTabIds?: ReadonlySet<string>;
  /** Opens a side chat's right-panel tab, or closes it when it is the one shown. */
  onToggleSideTab?: (sessionId: string) => void;
  /** Forks the main agent into a side chat and opens its tab; answers the refusal to show, or null. */
  onNewSideChat?: () => Promise<string | null>;
  /** Deletes one side chat and its tab; answers the failure to show, or null. */
  onDeleteSideChat?: (sessionId: string) => Promise<string | null>;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "completed") return "var(--success)";
  if (status === "failed") return "var(--danger)";
  if (status === "aborted") return "var(--warning)";
  return "var(--text-dim)";
}

function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "running" || status === "starting") {
    // The header's running glyph at row size. The row used to spin a circle: the same
    // state was drawn two ways ten pixels apart, and a spinner names no subagent.
    return <AgentRunningIcon size={14} />;
  }
  if (status === "failed") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (status === "aborted" || status === "interrupted") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="6" height="6" rx="1" />
    </svg>
  );
}

function SteerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

function AgentRow({
  session,
  main,
  selected,
  running,
  actionPending,
  onSelect,
  onStop,
  onSteer,
  sideTitle,
  tabShown = false,
  onToggleTab,
  onNewSideChat,
  newSideChatPending = false,
  onDelete,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  actionPending: boolean;
  onSelect: () => void;
  onStop: () => void;
  onSteer: () => void;
  /** C1: set for a side chat row, its name as the tabs show it. */
  sideTitle?: string;
  tabShown?: boolean;
  onToggleTab?: () => void;
  onNewSideChat?: () => void;
  newSideChatPending?: boolean;
  onDelete?: () => void;
}) {
  const { locale, t } = useI18n();
  const side = sideTitle !== undefined;
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const status: SubagentSessionStatus = running ? "running" : relation?.status ?? "completed";
  const primary = main ? t("agentSwitcher.main") : side ? sideTitle : relation?.description || sessionTitle(session);
  const secondary = main
    ? sessionTitle(session)
    : `${side ? t("agentSwitcher.sideChat") : relation?.profile ?? t("agentSwitcher.subagent")} · ${formatRelativeTime(session.modified, locale)}`;
  // Steer and Stop are the subagent route's; a side chat is driven from its own tab.
  const controllable = !main && !side && running;
  // The row's trailing track is drawn only when it holds something; the status keeps its
  // own fixed track either way, so every row's geometry is the same (see `.agent-row`).
  const hasActions = controllable || !!onNewSideChat || !!onToggleTab || !!onDelete;

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`agent-row${main ? " is-main" : ""}${selected ? " is-selected" : ""}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="agent-row-icon" style={{ width: 28, height: 28, display: "grid", placeItems: "center" }}>
        {main ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ) : side ? (
          <SideChatIcon size={16} strokeWidth={1.75} />
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
          </svg>
        )}
      </span>
      <span className="agent-row-text" style={{ minWidth: 0 }}>
        <span className="agent-row-title" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-caption)", fontWeight: selected ? 600 : 500 }} title={primary}>
          {primary}
        </span>
        <span className="agent-row-subtitle" style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--fs-micro)" }} title={secondary}>
          {secondary}
        </span>
      </span>
      <span className={`agent-row-status${running ? " is-running" : ""}`} style={{ color: main && !running ? "var(--text-dim)" : statusColor(status) }}>
        {(main || side) && !running ? (
          main && selected ? (
            <>
              {/* The same head the running row leads with, at rest (`pulse={false}`): the
                  panel drew the glyph only beside a live "Running", so the row that says
                  "Current" — the one conversation the app is standing on — was the only
                  state in the list with no glyph in front of it. */}
              <AgentRunningIcon size={14} pulse={false} />
              <span>{t("agentSwitcher.current")}</span>
            </>
          ) : null
        ) : (
          <>
            <StatusIcon status={status} />
            <span>{t(`agentSwitcher.status.${status}`)}</span>
          </>
        )}
      </span>
      {hasActions && (
        <span className="agent-row-actions">
        {controllable && (
          <>
            <button
              type="button"
              title={t("agentSwitcher.steer")}
              aria-label={t("agentSwitcher.steer")}
              disabled={actionPending}
              onClick={(event) => {
                event.stopPropagation();
                onSteer();
              }}
              style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22, border: "var(--hairline) solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg)", color: "var(--text-muted)", cursor: actionPending ? "default" : "pointer", padding: 0 }}
            >
              <SteerIcon />
            </button>
            <button
              type="button"
              title={t("agentSwitcher.stop")}
              aria-label={t("agentSwitcher.stop")}
              disabled={actionPending}
              onClick={(event) => {
                event.stopPropagation();
                onStop();
              }}
              style={{ display: "inline-grid", placeItems: "center", width: 22, height: 22, border: "var(--hairline) solid color-mix(in srgb, var(--danger) 40%, transparent)", borderRadius: "var(--radius-sm)", background: "var(--bg)", color: "var(--danger)", cursor: actionPending ? "default" : "pointer", padding: 0 }}
            >
              <StopIcon />
            </button>
          </>
        )}
        {onNewSideChat && (
          <RowButton title={t("sideChat.new")} disabled={newSideChatPending} onClick={onNewSideChat}>
            <SideChatPlusIcon size={15} strokeWidth={1.8} />
          </RowButton>
        )}
        {onToggleTab && (
          // Greyed, not gone: the row the main chat shows has no tab (one session, one chat).
          <RowButton
            title={selected ? t("agentSwitcher.openInMainChat") : t(tabShown ? "sideChat.closeTab" : "sideChat.openTab")}
            pressed={tabShown}
            disabled={selected}
            onClick={onToggleTab}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
              {tabShown && <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4z" fill="currentColor" />}
            </svg>
          </RowButton>
        )}
        {onDelete && (
          <RowButton title={t("sidebar.delete")} danger onClick={onDelete}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v7M14 10v7" />
            </svg>
          </RowButton>
        )}
        </span>
      )}
    </div>
  );
}

/** A row's trailing action; its click never selects the row. */
function RowButton({ title, pressed, danger, disabled, onClick, children }: {
  title: string;
  pressed?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`agent-row-button${danger ? " is-danger" : ""}`}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </button>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession, openSideTabIds, onToggleSideTab, onNewSideChat, onDeleteSideChat }: Props) {
  const { t } = useI18n();
  const [newSideChatPending, setNewSideChatPending] = useState(false);
  const [sideChatError, setSideChatError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const handleNewSideChat = async () => {
    if (!onNewSideChat) return;
    setNewSideChatPending(true);
    setSideChatError(null);
    try {
      setSideChatError(await onNewSideChat());
    } catch (error) {
      setSideChatError(errorMessage(error));
    } finally {
      setNewSideChatPending(false);
    }
  };
  const handleDeleteSideChat = async (sessionId: string) => {
    setConfirmDeleteId(null);
    if (!onDeleteSideChat) return;
    setSideChatError(null);
    try {
      setSideChatError(await onDeleteSideChat(sessionId));
    } catch (error) {
      setSideChatError(errorMessage(error));
    }
  };
  const [query, setQuery] = useState("");
  const [steerOpenId, setSteerOpenId] = useState<string | null>(null);
  const [steerDraft, setSteerDraft] = useState("");
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);

  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
      const relation = session.relation?.kind === "subagent" ? session.relation : null;
      return [relation?.description, relation?.profile, session.name, session.firstMessage]
        .some((value) => value?.toLowerCase().includes(normalizedQuery));
    })
    : sortedSubagents;
  const runningCount = subagents.filter((session) => runningSessionIds.has(session.id)).length;

  async function controlSubagent(id: string, action: "abort" | "steer", message?: string): Promise<boolean> {
    setControlError(null);
    setActionPendingId(id);
    try {
      const res = await fetch(`/api/subagents/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, message }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      return true;
    } catch (e) {
      setControlError(errorMessage(e));
      return false;
    } finally {
      setActionPendingId(null);
    }
  }

  async function submitSteer(id: string) {
    const message = steerDraft.trim();
    if (!message) return;
    if (await controlSubagent(id, "steer", message)) {
      setSteerOpenId(null);
      setSteerDraft("");
    }
  }

  return (
    <div
      className="agent-session-panel app-menu"
      role="listbox"
      aria-label={t("agentSwitcher.title")}
    >
      <div>
        {/* One row carries the family: its name, how many runs it holds, how many are
            running, and the box that narrows the list. The search used to sit in a
            bordered strip of its own under the header, which read as a second panel; the
            app's menus put a filter in the header line, and that is the row it fits. */}
        <div className="agent-panel-head">
          <strong className="agent-panel-title">{t("agentSwitcher.title")}</strong>
          <span className="agent-panel-count">
            {t("agentSwitcher.count", { count: subagents.length })}
          </span>
          {runningCount > 0 && (
            <span className="agent-panel-running">
              {t("agentSwitcher.runningCount", { count: runningCount })}
            </span>
          )}
          {subagents.length > 8 && (
            <input
              className="agent-panel-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agentSwitcher.search")}
              aria-label={t("agentSwitcher.search")}
            />
          )}
        </div>
        {sideChatError && (
          <div role="alert" className="agent-panel-notice">{sideChatError}</div>
        )}
        {controlError && (
          <div role="alert" className="agent-panel-notice">{controlError}</div>
        )}
        <div className="agent-panel-list" style={{ maxHeight: "min(58dvh, 480px)" }}>
          <AgentRow
            session={rootSession}
            main
            selected={rootSession.id === selectedSessionId}
            running={runningSessionIds.has(rootSession.id)}
            actionPending={actionPendingId === rootSession.id}
            onSelect={() => onSelectSession(rootSession)}
            onStop={() => {}}
            onSteer={() => {}}
            onNewSideChat={onNewSideChat ? () => void handleNewSideChat() : undefined}
            newSideChatPending={newSideChatPending}
          />
          {visibleSubagents.map((session) => (
            <div key={session.id}>
              <AgentRow
                session={session}
                selected={session.id === selectedSessionId}
                running={runningSessionIds.has(session.id)}
                actionPending={actionPendingId === session.id}
                onSelect={() => onSelectSession(session)}
                sideTitle={session.relation?.kind === "side" ? sideChatTitle(session, t("agentSwitcher.sideChat"), subagents) : undefined}
                tabShown={openSideTabIds?.has(session.id) ?? false}
                onToggleTab={session.relation?.kind === "side" && onToggleSideTab ? () => onToggleSideTab(session.id) : undefined}
                onDelete={session.relation?.kind === "side" && onDeleteSideChat ? () => setConfirmDeleteId(session.id) : undefined}
                onStop={() => {
                  setSteerOpenId(null);
                  void controlSubagent(session.id, "abort");
                }}
                onSteer={() => {
                  setControlError(null);
                  setSteerDraft("");
                  setSteerOpenId((current) => current === session.id ? null : session.id);
                }}
              />
              {confirmDeleteId === session.id && (
                <div role="alertdialog" aria-label={t("sidebar.delete")} className="agent-panel-strip">
                  <span style={{ flex: 1, minWidth: 0, color: "var(--text-muted)", fontSize: "var(--fs-caption)" }}>{t("sidebar.deleteChatBody")}</span>
                  <button type="button" className="agent-row-confirm" onClick={() => setConfirmDeleteId(null)}>{t("sidebar.cancel")}</button>
                  <button type="button" className="agent-row-confirm is-danger" onClick={() => void handleDeleteSideChat(session.id)}>{t("sidebar.delete")}</button>
                </div>
              )}
              {steerOpenId === session.id && runningSessionIds.has(session.id) && (
                <div className="agent-panel-strip">
                  <input
                    autoFocus
                    type="text"
                    value={steerDraft}
                    onChange={(event) => setSteerDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (isImeComposing(event)) return;
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitSteer(session.id);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setSteerOpenId(null);
                      }
                    }}
                    placeholder={t("agentSwitcher.steerPlaceholder")}
                    aria-label={t("agentSwitcher.steer")}
                    style={{ flex: 1, minWidth: 0, height: 30, padding: "0 10px", border: "var(--hairline) solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--bg)", color: "var(--text)", fontSize: "var(--fs-caption)", outline: "none" }}
                  />
                  <button
                    type="button"
                    disabled={!steerDraft.trim() || actionPendingId === session.id}
                    onClick={() => void submitSteer(session.id)}
                    style={{ height: 30, padding: "0 12px", border: "none", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "var(--accent-contrast)", fontSize: "var(--fs-caption)", cursor: !steerDraft.trim() || actionPendingId === session.id ? "default" : "pointer" }}
                  >
                    {t("agentSwitcher.steerSend")}
                  </button>
                </div>
              )}
            </div>
          ))}
          {visibleSubagents.length === 0 && (
            <div style={{ padding: "22px 12px", color: "var(--text-dim)", fontSize: "var(--fs-caption)", textAlign: "center" }}>
              {subagents.length === 0 ? t("agentSwitcher.none") : t("agentSwitcher.noMatches")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
