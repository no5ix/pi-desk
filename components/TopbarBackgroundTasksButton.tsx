"use client";

// The Background Tasks control in the title row, beside the subagent counts
// (components/AppShell.tsx). It wears the row's own pill — the class the subagent counts wear —
// because it is the same kind of control in the same row: a count of work that opens a card under
// itself, at the same size. The glyph and the number are the whole control: the row already says
// what it counts (the subagent counts beside it carry no word either), and the title names it in
// every language. Its states add only what the row's pill does not say: the head glyph breathes
// green while a task runs, turns warning when the newest news is a task that failed, and lies dim
// when nothing runs and all is seen. The numbers are the extension's own counts, streamed by the
// extensions themselves (hooks/useBackgroundTasksRunning.ts); the control adds nothing.

import { forwardRef } from "react";
import { BackgroundTasksIcon } from "./BackgroundTasksIcon";

interface Props {
  running: number;
  unseenFailed: number;
  tasksOpen: boolean;
  onToggle: () => void;
  title: string;
}

export const TopbarBackgroundTasksButton = forwardRef<HTMLButtonElement, Props>(
  ({ running, unseenFailed, tasksOpen, onToggle, title }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={[
          // The row's own pill, the class the subagent counts wear: the chip is the same control
          // in the same row, so it takes the pill, the hover wash, the focus ring and the glyph
          // sizing from that rule (app/native-theme.css) and adds only its states below.
          "app-topbar-subagents",
          "bg-tasks-chip",
          running > 0 ? "is-running" : "is-idle",
          unseenFailed > 0 ? "has-failed" : "",
          tasksOpen ? "is-open" : "",
        ].filter(Boolean).join(" ")}
        onClick={onToggle}
        onKeyDown={(event) => {
          // Enter and Space open the card, the same as a click. Escape is the shell's.
          if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            onToggle();
          }
        }}
        data-background-tasks-button=""
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={tasksOpen}
      >
        <span className="bg-tasks-head-mark">
          <BackgroundTasksIcon size={13.5} strokeWidth={2.1} />
        </span>
        <span className="bg-tasks-chip-count">{running}</span>
        {unseenFailed > 0 && <span className="bg-tasks-chip-mark" aria-hidden="true">⚠</span>}
      </button>
    );
  },
);

TopbarBackgroundTasksButton.displayName = "TopbarBackgroundTasksButton";
