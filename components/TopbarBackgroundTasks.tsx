"use client";

// The header's Background Tasks button.
//
// It is one control that opens one card, so it is one button: the icon, the count of running
// tasks, and the mark of finished work nobody has read. The count is the extension's own
// number — the sum of `running` over the registries of this project's live conversations —
// not a count of rows the panel happens to show, so a task started in another conversation of
// the project is in it as soon as that conversation is live.
//
// The failed mark is the extension's *unseen* failure count, the same set its TUI dock and
// `/bg-clear` share: opening a finished task in the panel clears the badge here and the badge
// there, and listing tasks acknowledges nothing.
//
// The button wears the header's own `.native-toolbar-button`: the same box, hover and focus as
// its neighbours, and it is in the actions row (not the sidebar, not Settings) because the
// card it opens hangs under it.

import type { Ref } from "react";
import type { TranslationParams } from "@/lib/i18n/types";

/** The app's Lucide `list-todo`: a list whose first two rows are checked. */
export function BackgroundTasksIcon({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}

export interface TopbarBackgroundTasksProps {
  running: number;
  unseenFailed: number;
  unseenKilled: number;
  unseenCompleted: number;
  /** True when the extension answers; a badge on a panel that can read nothing is a claim. */
  available: boolean;
  open: boolean;
  onToggle: () => void;
  translate: (key: string, params?: TranslationParams) => string;
  /** The card hangs below this button (lib/top-panel-placement.ts). */
  anchorRef?: Ref<HTMLElement>;
}

export function TopbarBackgroundTasks({
  running,
  unseenFailed,
  unseenKilled,
  unseenCompleted,
  available,
  open,
  onToggle,
  translate,
  anchorRef,
}: TopbarBackgroundTasksProps) {
  const label = translate("backgroundTasks.title");
  // The tooltip is the state in one line, in the same order the card's head prints it.
  const parts: string[] = [];
  if (running > 0) parts.push(translate("backgroundTasks.runningCount", { running }));
  if (unseenFailed > 0 || unseenKilled > 0) {
    parts.push(translate("backgroundTasks.unseenFailed", { count: unseenFailed + unseenKilled }));
  }
  if (unseenCompleted > 0) parts.push(translate("backgroundTasks.unseenCompleted", { count: unseenCompleted }));
  const title = available && parts.length > 0 ? `${label} · ${parts.join(" · ")}` : label;
  return (
    <button
      type="button"
      ref={anchorRef as Ref<HTMLButtonElement>}
      className={`native-toolbar-button app-topbar-tasks${open ? " is-open" : ""}${running > 0 ? " is-running" : ""}`}
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-expanded={open}
      aria-haspopup="dialog"
      data-background-tasks-button=""
    >
      <BackgroundTasksIcon />
      {available && running > 0 && (
        <span className="app-topbar-tasks-count" aria-hidden="true">{running > 99 ? "99+" : running}</span>
      )}
      {available && (unseenFailed + unseenKilled > 0) && (
        <span className="app-topbar-tasks-failed" aria-hidden="true" />
      )}
    </button>
  );
}
