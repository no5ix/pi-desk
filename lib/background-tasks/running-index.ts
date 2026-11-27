/**
 * Which conversations have background tasks running, for the parts of the app that are not the
 * task card.
 *
 * The card asks the extension on every read, and that is right for a monitor. The composer's
 * stop control and the sidebar's running mark cannot: they are on screen for every conversation,
 * and a per-row host round-trip would put a task registry in the middle of the app's two
 * heaviest trees. So the numbers the extension already pushes are kept here — one entry per
 * conversation, updated by the change frames of that conversation's own activation and by the
 * card's own reads, dropped when the conversation's bridge is released.
 *
 * The rules that make it trustworthy:
 * - The extension is the only source. Nothing is inferred from the tasks the panel happens to
 *   show, and no task list lives here: a count of what is running, and the count of finished
 *   work nobody has acknowledged.
 * - A conversation the server is not holding has no entry, so a sidebar row cannot wear a
 *   running mark from a conversation that ended.
 * - Like the other long-lived server maps in this process, it lives on `globalThis` (Next's hot
 *   reload replaces the module, not the process) and holds one small entry per live
 *   conversation, so it has no budget to police: a lost entry is a missing mark until the next
 *   frame, never a wrong one.
 */

export interface BackgroundTasksRunningEntry {
  running: number;
  unseenFailed: number;
  /** When the extension last said anything about this conversation. */
  observedAt: number;
}

export type BackgroundTasksRunningMap = Record<string, BackgroundTasksRunningEntry>;

interface RunningStore {
  entries: Map<string, BackgroundTasksRunningEntry>;
  listeners: Set<(map: BackgroundTasksRunningMap) => void>;
}

const STATE_KEY = "__piBackgroundTasksRunning";

function store(): RunningStore {
  const globals = globalThis as Record<string, unknown>;
  const existing = globals[STATE_KEY] as RunningStore | undefined;
  if (existing && existing.entries instanceof Map && existing.listeners instanceof Set) return existing;
  const created: RunningStore = { entries: new Map(), listeners: new Set() };
  globals[STATE_KEY] = created;
  return created;
}

function notify(): void {
  const current = store();
  const map = snapshot();
  for (const listener of current.listeners) {
    try {
      listener(map);
    } catch {
      // One broken listener must not stop the others, and the panel has its own reads.
    }
  }
}

/**
 * Records what the extension reported for one conversation, and returns whether that was news.
 *
 * The map holds only conversations with news — a task running, or a failure nobody has
 * acknowledged — so an entry always means something: the composer's stop control and the
 * sidebar's running mark read the map as it stands, and a `running: 0` row left behind is a mark
 * every client would have to second-guess. A conversation whose work finished and was seen
 * leaves the map; one that finished with a failure stays, because the warning is the news.
 *
 * The same counts with a newer timestamp are not news: the timestamp rides every change frame,
 * and pushing it would re-render every sidebar row in the browser for nothing.
 */
export function recordBackgroundTasksRunning(
  sessionId: string,
  counts: { running?: number; unseenFailed?: number; unseenKilled?: number; observedAt?: number },
): boolean {
  const current = store();
  const running = Math.max(0, Number(counts.running ?? 0) || 0);
  const unseenFailed = Math.max(0, (Number(counts.unseenFailed ?? 0) || 0) + (Number(counts.unseenKilled ?? 0) || 0));
  const observedAt = Number(counts.observedAt ?? Date.now()) || Date.now();
  const previous = current.entries.get(sessionId);
  if (running === 0 && unseenFailed === 0) {
    if (!previous) return false;
    current.entries.delete(sessionId);
    notify();
    return true;
  }
  if (previous && previous.running === running && previous.unseenFailed === unseenFailed) {
    previous.observedAt = observedAt;
    return false;
  }
  current.entries.set(sessionId, { running, unseenFailed, observedAt });
  notify();
  return true;
}

/** The conversation is over, or its bridge is gone: its mark goes with it. */
export function clearBackgroundTasksRunning(sessionId: string): boolean {
  const current = store();
  if (!current.entries.delete(sessionId)) return false;
  notify();
  return true;
}

export function getBackgroundTasksRunning(sessionId: string): BackgroundTasksRunningEntry | undefined {
  return store().entries.get(sessionId);
}

export function listBackgroundTasksRunning(): BackgroundTasksRunningMap {
  return snapshot();
}

function snapshot(): BackgroundTasksRunningMap {
  const map: BackgroundTasksRunningMap = {};
  for (const [sessionId, entry] of store().entries) map[sessionId] = { ...entry };
  return map;
}

/** Fires with the whole map after any conversation's numbers change. Returns the unsubscribe. */
export function subscribeBackgroundTasksRunning(listener: (map: BackgroundTasksRunningMap) => void): () => void {
  const current = store();
  current.listeners.add(listener);
  return () => current.listeners.delete(listener);
}

/** Every conversation with a task running, the number the composer's stop control wears. */
export function backgroundTasksRunningCount(sessionId: string): number {
  return store().entries.get(sessionId)?.running ?? 0;
}

export function clearAllBackgroundTasksRunning(): number {
  const current = store();
  const count = current.entries.size;
  current.entries.clear();
  notify();
  return count;
}
