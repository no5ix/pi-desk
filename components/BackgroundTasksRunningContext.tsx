"use client";

// Which conversations have background tasks running, for the rows that list them.
//
// The sidebar shows every conversation of every project, and a task running in one of them is
// news the row should wear (the composer has the same news as its stop control). The numbers are
// the extension's own counts, pushed by the conversation's activation and kept in
// `lib/background-tasks/running-index.ts`; the shell reads them once, on a stream, and hands
// them down here.
//
// A context, not a prop: the row is nested five layers below the sidebar (project group →
// session tree → family → row), and threading one more map through all of them — plus the chats
// section, the search view and the Agents panel, which render the same rows — would be a
// parameter trail for one small mark. A row asks for its own conversation and nothing else
// re-renders its decision. The map changes when a task starts, stops or is stopped, which is
// exactly when the mark is supposed to move.

import { createContext, useContext, useMemo, type ReactNode } from "react";

/** `{ sessionId: runningTaskCount }`, the extension's counts, for the conversations it holds. */
const BackgroundTasksRunningContext = createContext<Record<string, number>>({});

export function BackgroundTasksRunningProvider({
  running,
  children,
}: {
  running: Record<string, number>;
  children: ReactNode;
}) {
  const value = useMemo(() => running, [running]);
  return (
    <BackgroundTasksRunningContext.Provider value={value}>
      {children}
    </BackgroundTasksRunningContext.Provider>
  );
}

/** How many of one conversation's background tasks the extension says are running. */
export function useBackgroundTasksRunningFor(sessionId: string | undefined): number {
  const running = useContext(BackgroundTasksRunningContext);
  return sessionId ? running[sessionId] ?? 0 : 0;
}
