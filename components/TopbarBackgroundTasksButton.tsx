"use client";

// The header's Background Tasks control, with its own copy of the counts.
//
// The badge's numbers come from the same host interface as the panel, read in this small
// component on purpose: a snapshot that lands in the shell's state would re-render the whole
// application every tick, and the shell is the heaviest tree in the app. Here a new count
// re-renders one button.
//
// While the card is closed the read is the cheapest one the host interface offers — one task
// per activation, because the counts ride every list response — on a slow tick, and it is
// skipped while the tab is hidden. Opening the card is what starts the change stream.

import { useMemo } from "react";
import type { Ref } from "react";
import { TopbarBackgroundTasks } from "./TopbarBackgroundTasks";
import { useBackgroundTasks } from "@/hooks/useBackgroundTasks";
import { backgroundTasksBadge } from "@/lib/background-tasks/session-view";
import type { TranslationParams } from "@/lib/i18n/types";

export interface TopbarBackgroundTasksButtonProps {
  sessionId: string | null;
  open: boolean;
  onToggle: () => void;
  translate: (key: string, params?: TranslationParams) => string;
  anchorRef?: Ref<HTMLElement>;
}

export function TopbarBackgroundTasksButton({
  sessionId,
  open,
  onToggle,
  translate,
  anchorRef,
}: TopbarBackgroundTasksButtonProps) {
  const { snapshot } = useBackgroundTasks({ sessionId, open });
  const badge = useMemo(
    () => backgroundTasksBadge(snapshot?.counts ?? {
      running: 0,
      completed: 0,
      failed: 0,
      killed: 0,
      unseenCompleted: 0,
      unseenFailed: 0,
      unseenKilled: 0,
      total: 0,
    }),
    [snapshot?.counts],
  );
  return (
    <TopbarBackgroundTasks
      running={badge.running}
      unseenFailed={badge.unseenFailed}
      unseenKilled={badge.unseenKilled}
      unseenCompleted={badge.unseenCompleted}
      available={snapshot?.available === true}
      open={open}
      onToggle={onToggle}
      translate={translate}
      anchorRef={anchorRef}
    />
  );
}
