"use client";

// Fork-owned: the subagent counts in the header's project row, next to the
// project, the branch and the running clock.
//
// The data is the active session's family — the same `listSessionFamilies`
// grouping the sidebar's "Subagents" fold and components/AgentSessionPanel.tsx
// use — reduced to four numbers, because the header has no room for a list. The
// live running set (`/api/agent/running/events`) is what makes the "running"
// number move while the task is going; the file's own status fields cover the
// runs that finished, failed, were aborted or stopped.
//
// The icons are the ones the rest of the app already uses for these states:
// AgentIcon for the family, the panel's check for a completed run, its stopped
// mark for one that ended early, and the pulsing AgentRunningIcon for a live one.
// The totals are not printed: the three buckets are the total.

import type { SessionFamily } from "@/lib/session-family";
import type { TranslationParams } from "@/lib/i18n/types";

export interface SubagentCounts {
  total: number;
  completed: number;
  aborted: number;
  running: number;
  /** TranslationParams compatibility: the counts go straight into the tooltips. */
  [key: string]: number;
}

/** Counts a family's subagent runs by outcome.
 *  `runningIds` is the live set of running sessions; a run the server says is
 *  running, queued, interrupted, failed or aborted is counted once, in that
 *  order, so a run never lands in two buckets. */
export function countSubagents(family: SessionFamily | null, runningIds: Set<string>): SubagentCounts {
  const counts: SubagentCounts = { total: 0, completed: 0, aborted: 0, running: 0 };
  if (!family) return counts;
  for (const session of family.subagents) {
    counts.total += 1;
    // Only a subagent relation carries a status; the sidebar's fold filters the
    // family the same way (components/AgentSessionPanel.tsx).
    const status = session.relation?.kind === "subagent" ? session.relation.status : undefined;
    if (runningIds.has(session.id) || status === "running" || status === "queued") {
      counts.running += 1;
    } else if (status === "aborted" || status === "failed" || status === "interrupted") {
      counts.aborted += 1;
    } else if (status === "completed") {
      counts.completed += 1;
    }
  }
  return counts;
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="2.5,6.5 5,9 9.5,3.5" />
    </svg>
  );
}

/* The header's own copies of the two glyphs components/AgentSessionPanel.tsx
   draws in its rows (the sidebar's "Subagents" fold): the subagent head, and the
   running pulse. They are module-private there; the header is a tenth of the
   width, so it uses the same paths at 11px. */
function AgentIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8V5z" />
      <circle cx="12" cy="3" r="1" />
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M9 13v2" />
      <path d="M15 13v2" />
    </svg>
  );
}

function AgentRunningIcon() {
  return (
    <svg
      className="agent-status-icon--pulse"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8V5z" />
      <circle cx="12" cy="3" r="1" />
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M8 13h2" />
      <path d="M14 13h2" />
    </svg>
  );
}

export function TopbarSubagents({
  counts,
  onOpenAgents,
  translate,
}: {
  counts: SubagentCounts;
  onOpenAgents: () => void;
  translate: (key: string, params?: TranslationParams) => string;
}) {
  if (counts.total === 0) return null;
  const title = translate("chat.subagentsTitle", counts);
  return (
    <small
      className="app-topbar-subagents"
      role="button"
      tabIndex={0}
      title={title}
      aria-label={title}
      onClick={onOpenAgents}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onOpenAgents();
      }}
    >
      <AgentIcon />
      {counts.completed > 0 && (
        <span
          className="app-topbar-subagent-count is-completed"
          title={translate("chat.subagentsCompleted", counts)}
        >
          <span className="app-topbar-subagent-glyph"><CheckIcon /></span>
          <span>{counts.completed}</span>
        </span>
      )}
      {counts.aborted > 0 && (
        <span
          className="app-topbar-subagent-count is-aborted"
          title={translate("chat.subagentsAborted", counts)}
        >
          {/* The Agents panel's own stopped-run glyph, so the header's number and
              the list's row say the same thing. */}
          <span className="app-topbar-subagent-glyph">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
            </svg>
          </span>
          <span>{counts.aborted}</span>
        </span>
      )}
      {counts.running > 0 && (
        <span
          className="app-topbar-subagent-count is-running"
          title={translate("chat.subagentsRunning", counts)}
        >
          <AgentRunningIcon />
          <span>{counts.running}</span>
        </span>
      )}
    </small>
  );
}
