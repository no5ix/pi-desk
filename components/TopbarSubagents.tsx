"use client";

// Fork-owned: the family's run counts in the header's project row, next to the
// project, the branch and the running clock.
//
// The data is the active session's family — the same `listSessionFamilies`
// grouping the sidebar's "Subagents" fold and components/AgentSessionPanel.tsx
// use — reduced to numbers, because the header has no room for a list. The live
// running set (`/api/agent/running/events`) is what makes the "running" number
// move while the task is going; the file's own status fields cover the runs that
// finished, failed, were aborted or stopped.
//
// A family holds two kinds of member (ADR 0007): the subagent runs and the side
// chats. They are counted apart and shown apart — a side chat is a conversation
// the user opened beside the main one, a subagent is a run the agent delegated —
// and each kind leads with the glyph the rest of the app already uses for it, so
// the row reads `[robot] ✓2 ⚠1 ↻3  [side-chat bubble] ✓1 ↻1`.
//
// **One button, two groups.** The chip opens one thing (the Agents panel), so it is
// one control: two `<small role="button">` neighbours in a 400px row would be two
// targets for the same action, and a keyboard user would tab through the same panel
// twice. The groups carry their own tooltips; the button's accessible name is both
// sentences.
//
// The icons are the ones the rest of the app already uses for these states:
// AgentIcon for the family, the panel's check for a completed run, its stopped
// mark for one that ended early, and the pulsing AgentRunningIcon for a live one.
// The totals are not printed: the three buckets are the total.

import type { Ref } from "react";
import { SideChatPlusIcon as SideChatGlyph } from "./SideChatIcon";
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
  return countFamilyMembers(family, runningIds, "subagent");
}

/**
 * The same buckets for the family's side chats — the conversations the user opened
 * beside the main one (`relation.kind === "side"`, the sidebar's leading glyph). A
 * family's `subagents` list carries both kinds (ADR 0007), so the two counts are read
 * from one pass over it and never added together: "6 runs" that mixes a delegated run
 * with a side chat says nothing a user can act on.
 *
 * A side chat has no outcome. Only a subagent relation carries a `status`
 * (`lib/session-family.ts`: `{ kind: "side"; parentSessionId }`), and a conversation
 * the user is typing into is not "completed" or "aborted", so this kind reports what
 * the app can state: how many side chats the family has, and how many are running now
 * (the live set, `/api/agent/running/events`). The completed and aborted buckets stay
 * zero and render nothing — a check mark invented for a chat is fabricated data.
 */
export function countSideChats(family: SessionFamily | null, runningIds: Set<string>): SubagentCounts {
  return countFamilyMembers(family, runningIds, "side");
}

function countFamilyMembers(
  family: SessionFamily | null,
  runningIds: Set<string>,
  kind: "subagent" | "side",
): SubagentCounts {
  const counts: SubagentCounts = { total: 0, completed: 0, aborted: 0, running: 0 };
  if (!family) return counts;
  for (const session of family.subagents) {
    // Only a member of the counted kind; the sidebar's fold filters the family the same
    // way (AgentSessionPanel.tsx).
    const relation = session.relation;
    if (relation?.kind !== kind) continue;
    counts.total += 1;
    // The live running set answers for every kind; the relation's own status exists on a
    // subagent run only, and only a subagent's buckets go past "running".
    const status = relation.kind === "subagent" ? relation.status : undefined;
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

/* The app's subagent head, at the size that leads a group: the leading glyph on a
   subagent's sidebar row, the head in the Agents panel's rows
   (components/AgentSessionPanel.tsx) and the Settings › Agents icon all draw these same
   paths, and the header's kind glyph drew a different head — an antenna ball and
   vertical-bar eyes — ten pixels from all three. One shape, one meaning: the knobbed
   head says "this family delegates runs". The running head below is shared the other
   way — the panel imports that one, at row size, so a running run has one shape.

   The head is drawn well above the buckets (19px) on a light 1.4 stroke: at that box it
   paints a 1.1px line, the same weight as at 17px on 1.55 — the size the user asked for
   ("a little bit bigger") grows the glyph, not its ink. 1.75 (this file's rule just past
   12px) paints 1.4px and turns bold next to the 11px glyphs' 0.87px, which is what a
   label wants. It names the group, and at the bucket size it read smaller than the count
   sitting beside it, so the row's label looked like one more bucket. The state glyphs —
   the check, the stop, the running head — stay at 11px on purpose: a bucket's glyph sits
   *inside* the number it counts, and `AgentRunningIcon` is shared with the Agents panel's
   rows at its default size. The chip grows with the head (15px → 21px tall); the bar is a
   floor, and `placeAgentsPanel` reads the chip's live box, so the card follows it. */
function AgentIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="7" width="14" height="11" rx="2" />
      <path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
    </svg>
  );
}

/**
 * The subagent head, and by default the running one: the head with its eyes lit.
 *
 * Exported because it is the app's one answer to "this run is going". The header counts
 * with it at 11px; the Agents panel used to spin a circle in the row, so the same state
 * had two shapes ten pixels apart, and the circle said nothing about a subagent. The size
 * is a prop for that reason: a row glyph and a header glyph cannot share one pixel size.
 *
 * `pulse` is a prop because the same head now labels a state that is not running: the
 * Agents panel's "Current" row wants the head that names an agent, and the 1.6s opacity
 * cycle beside a word that says "this is the conversation you are in" reads as live work.
 * At rest the glyph is the identical shape, only unanimated.
 *
 * `strokeWidth` is a prop for the one place that is neither a row nor a chip: the
 * composer's disc (components/ChatInput.tsx) draws a live run at ~17px inside a filled
 * accent button, where the 13px rule's 1.24px line reads thin next to the send arrow's
 * 1.9px. An absent value keeps this file's size rule, so the header and the panel are
 * untouched.
 */
export function AgentRunningIcon({ size = 11, pulse = true, strokeWidth }: { size?: number; pulse?: boolean; strokeWidth?: number }) {
  return (
    <svg
      className={pulse ? "agent-status-icon--pulse" : undefined}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth ?? (size > 12 ? 1.75 : 1.9)}
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

/* The header's size of the app's one side-chat mark (components/SideChatIcon.tsx): the
   composer's button, the sidebar's leading glyph on a side chat's row, the Agents panel's
   rows, a tab and the quote bar all draw the same bubble, and the header's 11px is the
   smallest of them. The plus variant, because the group leads with the composer's mark —
   the same shape that opens one. */
function SideChatIcon() {
  return <SideChatGlyph size={11} strokeWidth={1.9} />;
}

/** One bucket: the state's glyph and its number. A zero bucket renders nothing —
 *  "✓0" is a claim about runs that do not exist, and the row has no room for it. */
function Bucket({ kind, count, title }: { kind: "completed" | "aborted" | "running"; count: number; title: string }) {
  if (count === 0) return null;
  return (
    <span className={`app-topbar-subagent-count is-${kind}`} title={title}>
      <span className="app-topbar-subagent-glyph">
        {kind === "completed" && <CheckIcon />}
        {kind === "aborted" && (
          /* The Agents panel's own stopped-run glyph, so the header's number and
             the list's row say the same thing. */
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
          </svg>
        )}
        {kind === "running" && <AgentRunningIcon />}
      </span>
      <span>{count}</span>
    </span>
  );
}

function Buckets({ counts, translate, keys }: {
  counts: SubagentCounts;
  translate: (key: string, params?: TranslationParams) => string;
  keys: { completed: string; aborted: string; running: string };
}) {
  return (
    <>
      <Bucket kind="completed" count={counts.completed} title={translate(keys.completed, counts)} />
      <Bucket kind="aborted" count={counts.aborted} title={translate(keys.aborted, counts)} />
      <Bucket kind="running" count={counts.running} title={translate(keys.running, counts)} />
    </>
  );
}

/**
 * The header's family chip: the subagent runs and the side chats, each led by its
 * kind's glyph, each with its completed / aborted / running buckets — inside ONE
 * button, because both groups open the same panel.
 */
export function TopbarSubagents({
  subagents,
  sideChats,
  onOpenAgents,
  translate,
  anchorRef,
}: {
  subagents: SubagentCounts;
  sideChats: SubagentCounts;
  onOpenAgents: () => void;
  translate: (key: string, params?: TranslationParams) => string;
  /** The Agents panel hangs below this chip: the shell reads its box to place the card. */
  anchorRef?: Ref<HTMLElement>;
}) {
  if (subagents.total + sideChats.total === 0) return null;
  const parts: string[] = [];
  if (subagents.total > 0) parts.push(translate("chat.subagentsTitle", subagents));
  if (sideChats.total > 0) parts.push(translate("chat.sideChatsTitle", sideChats));
  const title = parts.join(" · ");
  return (
    <small
      className="app-topbar-subagents"
      ref={anchorRef}
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
      {subagents.total > 0 && (
        <span className="app-topbar-family-group" title={translate("chat.subagentsTitle", subagents)}>
          <AgentIcon />
          <Buckets
            counts={subagents}
            translate={translate}
            keys={{
              completed: "chat.subagentsCompleted",
              aborted: "chat.subagentsAborted",
              running: "chat.subagentsRunning",
            }}
          />
        </span>
      )}
      {sideChats.total > 0 && (
        <span className="app-topbar-family-group app-topbar-family-group--side" title={translate("chat.sideChatsTitle", sideChats)}>
          <SideChatIcon />
          {/* A conversation is counted, not graded: the number is the family's side chats,
              and the running bucket joins it while one is live. */}
          <span className="app-topbar-subagent-count">{sideChats.total}</span>
          <Bucket kind="running" count={sideChats.running} title={translate("chat.sideChatsRunning", sideChats)} />
        </span>
      )}
    </small>
  );
}
