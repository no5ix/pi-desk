/**
 * One background-task host client per live session, in this process.
 *
 * The extension's task registry belongs to an *activation*: it lives in the session's
 * extension runtime and dies with it. So a background task is reachable exactly while the
 * conversation that started it is live in this Pi process — the extension says the same
 * about reload (kill, unless the task opted into `surviveReload`) and about a process
 * restart (nothing is resurrected, nothing is adopted). pi-desk mirrors that boundary
 * instead of inventing persistence: the bridge exists with the session wrapper and is
 * released with it, and a conversation whose wrapper is gone is reported as closed, with no
 * invented task state.
 *
 * `globalThis`, like the session registry: Next's hot reload re-evaluates this module, and a
 * `Map` in module scope would forget bridges whose sessions are still running (leaving the
 * extension's listeners on a bus nobody reads).
 */

import { BackgroundTaskHostClient, type EventBusLike } from "./host-client";
import { announceDeferredRunEnd, clearDeferredRunEnd } from "../task-completion-server";
import { clearBackgroundTaskCompletions, noteBackgroundTaskSettlement } from "./completion-gate";
import { type BgTaskCounts } from "./protocol";
import { clearBackgroundTasksRunning, recordBackgroundTasksRunning } from "./running-index";

export interface BackgroundTasksBridge {
  sessionId: string;
  cwd: string;
  client: BackgroundTaskHostClient;
  createdAt: number;
}

interface BridgeRegistry {
  bridges: Map<string, BackgroundTasksBridge>;
  listeners: Set<() => void>;
}

const REGISTRY_KEY = "__piWebBackgroundTaskBridges";

function registry(): BridgeRegistry {
  const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: BridgeRegistry };
  const existing = host[REGISTRY_KEY];
  if (existing) return existing;
  const created: BridgeRegistry = { bridges: new Map(), listeners: new Set() };
  Object.defineProperty(host, REGISTRY_KEY, { value: created, configurable: true, writable: true });
  return created;
}

function notify(): void {
  for (const listener of [...registry().listeners]) {
    try {
      listener();
    } catch {
      // A bridge-registry listener is a fan-out (an SSE pump); a throwing one must not
      // stop the others, and it has no caller to report to.
    }
  }
}

/**
 * Creates the session's host client on the session's own EventBus — the instance the
 * extension's activation was handed. Called when the wrapper is created; released when it
 * closes. The client subscribes to the bus immediately: the cost is two listeners, and the
 * extension's service arms no timers and builds no snapshot while no lease is open, so an
 * open bridge with no panel is nearly free.
 */
export function attachBackgroundTasksBridge(
  sessionId: string,
  cwd: string,
  eventBus: EventBusLike,
): BackgroundTasksBridge {
  const bridges = registry().bridges;
  bridges.get(sessionId)?.client.dispose();
  const client = new BackgroundTaskHostClient(eventBus, {
    // Stable per bridge: the service answers a repeat `subscribe` with the same lease, and a
    // bridge that came back after a hot reload is a new consumer that wants its own.
    clientId: `pi-web:${sessionId}:${String(process.pid)}:${Math.random().toString(36).slice(2, 10)}`,
  });
  const bridge: BackgroundTasksBridge = { sessionId, cwd, client, createdAt: Date.now() };
  bridges.set(sessionId, bridge);
  // The composer's stop control and the sidebar's running mark read the running index, and they
  // are on screen for conversations whose card is closed. So every frame this conversation's own
  // activation pushes is recorded here, listener or no listener: the extension is the source, and
  // pi-desk keeps only the count of what it said is running.
  const applyCounts = (counts: BgTaskCounts, observedAt: number): void => {
    recordBackgroundTasksRunning(sessionId, {
      running: counts.running,
      unseenFailed: counts.unseenFailed,
      observedAt,
    });
    // The run the conversation finished while these tasks ran is kept by the announcer and said
    // here, once, when the last task settles: the user's notice carries the real end of the work
    // they asked for, not the fifteen seconds the answer took (task-completion-server.ts).
    if (counts.running === 0) {
      void announceDeferredRunEnd(sessionId).catch((error: unknown) => {
        console.error("[pi-web] the settlement notice failed:", error instanceof Error ? error.message : String(error));
      });
    }
    // A task that left `running` and settled is news the extension is about to tell: its notice
    // lands in the conversation and, by its default, it asks the agent for a turn about the
    // result. That turn is not the user's task ending, and the app announces a finished run on
    // the desktop, over push and over ntfy — so the session is told which run this is, and the
    // card is left as the one place that says it (background-tasks/completion-gate.ts).
    noteBackgroundTaskSettlement({
      sessionId,
      running: counts.running,
      settled: counts.completed + counts.failed + counts.killed,
      at: observedAt,
    });
  };
  // The subscribe response carries the registry's counts, so the first thing the app knows about
  // this conversation is what is running in it now — not zero until the next change. Registering
  // the listener is also what takes the lease: the extension publishes only while one is live.
  client.onCounts((facts) => applyCounts(facts.counts, facts.observedAt));
  client.onChanges((frame) => {
    if (frame.kind === "closed") {
      clearBackgroundTasksRunning(sessionId);
      clearBackgroundTaskCompletions(sessionId);
      return;
    }
    applyCounts(frame.counts, frame.observedAt);
  });
  notify();
  return bridge;
}

export function getBackgroundTasksBridge(sessionId: string): BackgroundTasksBridge | undefined {
  return registry().bridges.get(sessionId);
}

export function releaseBackgroundTasksBridge(sessionId: string): boolean {
  const bridges = registry().bridges;
  const bridge = bridges.get(sessionId);
  if (!bridge) return false;
  bridges.delete(sessionId);
  bridge.client.dispose();
  // A conversation the server is not holding has no running tasks: its mark goes with it, so a
  // sidebar row cannot keep wearing a spinner for a conversation that ended.
  clearBackgroundTasksRunning(sessionId);
  clearBackgroundTaskCompletions(sessionId);
  // A notice kept for tasks that will never settle with this conversation is nobody's news.
  clearDeferredRunEnd(sessionId);
  notify();
  return true;
}

export function listBackgroundTasksBridges(): BackgroundTasksBridge[] {
  return [...registry().bridges.values()];
}

/** Every bridge of the same project: the tasks of the conversations open in this process. */
export function listBackgroundTasksBridgesForCwd(cwd: string): BackgroundTasksBridge[] {
  return listBackgroundTasksBridges().filter((bridge) => bridge.cwd === cwd);
}

export function releaseAllBackgroundTasksBridges(): number {
  const bridges = [...registry().bridges.keys()];
  for (const sessionId of bridges) releaseBackgroundTasksBridge(sessionId);
  return bridges.length;
}

/** Fires when a bridge is attached or released, so an open panel notices an opened conversation. */
export function subscribeBackgroundTasksBridgeRegistry(listener: () => void): () => void {
  const listeners = registry().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}
