/**
 * Which sessions' next run exists because a subagent's report arrived.
 *
 * A background subagent's report is delivered into the parent as a custom message that
 * starts a turn (`triggerTurn` in `lib/subagent-runtime.ts`). That run's end is the
 * subagent's ending, and the user asked for no notice when a subagent ends its task, so the
 * announcer skips exactly that run (`lib/rpc-manager.ts`, `components/AppShell.tsx`).
 *
 * One mark is consumed by one run: the run of a prompt the user typed is announced as usual.
 * The table lives on `globalThis` because the Next dev server reloads modules while the
 * running sessions, and the marks, must outlive it (`lib/rpc-manager.ts`).
 */
declare global {
  var __piSubagentReportDrivenParents: Set<string> | undefined;
}

function getReportDrivenParents(): Set<string> {
  globalThis.__piSubagentReportDrivenParents ??= new Set();
  return globalThis.__piSubagentReportDrivenParents;
}

export function markSubagentReportRun(parentSessionId: string): void {
  getReportDrivenParents().add(parentSessionId);
}

/** True once for each marked run, and only for it. */
export function takeSubagentReportRun(parentSessionId: string): boolean {
  const parents = getReportDrivenParents();
  const marked = parents.has(parentSessionId);
  parents.delete(parentSessionId);
  return marked;
}

/** The marked parents, for the debug panel and tests. Nothing is created or consumed. */
export function peekSubagentReportRuns(): string[] {
  return [...getReportDrivenParents()];
}
