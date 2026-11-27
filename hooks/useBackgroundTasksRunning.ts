"use client";

// The app's live view of the conversation's background tasks, for the controls that are not the
// card: the composer's stop disc and the sidebar's running mark.
//
// The card has its own client (`useBackgroundTasks`), which leases, lists and streams. This one
// carries only what the whole application needs to know: how many tasks the extension says are
// running in each conversation it is holding. The frames come from the server's index, which is
// written by the extensions' own change frames — so a task that starts in pi's CLI with `/bg`
// moves the composer's disc and the sidebar's mark within a frame, with no polling.
//
// One shared stream for the whole browser (the app's rule for a stream every tab wants:
// `openSharedEventStreamHandle`, a `pi-web:*` name, one leader per browser), a fetch for the
// first paint, and a reconnect when the tab returns or the network does.

import { useCallback, useEffect, useMemo, useState } from "react";
import { openSharedEventStreamHandle } from "@/lib/scheduled-tasks/shared-stream";

export const BACKGROUND_TASKS_RUNNING_STREAM_NAME = "pi-web:background-tasks-running";

interface RunningFrame {
  type?: string;
  sessions?: Record<string, { running?: number; unseenFailed?: number }>;
}

/** What the extensions report per conversation: running tasks and unacknowledged failures. */
interface RunningCounts {
  running: number;
  unseenFailed: number;
}

function toCounts(sessions: RunningFrame["sessions"]): Record<string, RunningCounts> {
  const counts: Record<string, RunningCounts> = {};
  for (const [sessionId, entry] of Object.entries(sessions ?? {})) {
    const running = Number(entry?.running ?? 0) || 0;
    const unseenFailed = Number(entry?.unseenFailed ?? 0) || 0;
    if (running > 0 || unseenFailed > 0) counts[sessionId] = { running, unseenFailed };
  }
  return counts;
}

export function useBackgroundTasksRunning(): {
  /** `{ sessionId: { running, unseenFailed } }`, only for conversations with news. */
  counts: Record<string, RunningCounts>;
  /** The same numbers for the sidebar's rows: `{ sessionId: runningCount }`. */
  runningBySession: Record<string, number>;
  runningIn: (sessionId: string | null | undefined) => number;
  unseenFailedIn: (sessionId: string | null | undefined) => number;
} {
  const [counts, setCounts] = useState<Record<string, RunningCounts>>({});

  useEffect(() => {
    let mounted = true;
    void fetch("/api/background-tasks/running")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { sessions?: RunningFrame["sessions"] } | null) => {
        if (mounted && data) setCounts(toCounts(data.sessions));
      })
      .catch(() => {
        // The first paint is a nicety; the stream is the truth.
      });
    const stream = openSharedEventStreamHandle<RunningFrame>({
      url: "/api/background-tasks/running/events",
      name: BACKGROUND_TASKS_RUNNING_STREAM_NAME,
      onEvent: (data) => {
        if (!mounted || data?.type !== "running" || !data.sessions) return;
        setCounts(toCounts(data.sessions));
      },
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") stream.reconnect();
    };
    const onOnline = () => stream.reconnect();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      stream.stop();
    };
  }, []);

  const runningIn = useCallback(
    (sessionId: string | null | undefined) => (sessionId ? counts[sessionId]?.running ?? 0 : 0),
    [counts],
  );
  const unseenFailedIn = useCallback(
    (sessionId: string | null | undefined) => (sessionId ? counts[sessionId]?.unseenFailed ?? 0 : 0),
    [counts],
  );
  // The same numbers for the sidebar's rows, as a plain `{ sessionId: runningCount }` map: the
  // row wears a mark and a count in its tooltip, and asks for its own conversation
  // (components/BackgroundTasksRunningContext.tsx).
  const runningBySession = useMemo(
    () => Object.fromEntries(Object.entries(counts).map(([sessionId, entry]) => [sessionId, entry.running])),
    [counts],
  );

  return { counts, runningBySession, runningIn, unseenFailedIn };
}
