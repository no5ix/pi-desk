"use client";

import { useElapsedSince } from "@/hooks/useElapsedSince";
import { useI18n } from "@/hooks/useI18n";
import { formatTurnDuration, formatTurnDurationCompact } from "@/lib/turn-duration";
import { ClockIcon } from "./ClockIcon";

/**
 * The conversation header's live clock: how long the task has been running
 * since the last prompt, laid out after the branch as
 * `[folder] project  [branch] branch  [clock] 1h50m`.
 *
 * It is a component of its own because it ticks. AppShell owns the title block,
 * and a label that re-renders every second inside AppShell re-renders the shell,
 * the sidebar and the chat column with it; here the tick stops at this `<small>`.
 *
 * The count starts at the user's own prompt (ChatWindow reports it), so a
 * background subagent's report — a custom message, and the time the main session
 * spends waiting for it — runs the clock rather than resetting it.
 */
export function TopbarElapsed({ since }: { since: number | null }) {
  const { t } = useI18n();
  const elapsed = useElapsedSince(since);
  if (elapsed === null) return null;
  return (
    <small className="app-topbar-elapsed" title={t("chat.elapsedSincePrompt", { duration: formatTurnDuration(elapsed) })}>
      <ClockIcon size={11} />
      <span>{formatTurnDurationCompact(elapsed)}</span>
    </small>
  );
}
