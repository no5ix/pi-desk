import { randomUUID } from "node:crypto";
import type { PendingComposerMessage } from "./composer-queue-types";
import { registerCachePruner } from "./cache-registry.ts";

type QueueState = { items: PendingComposerMessage[]; paused: boolean; version: number };
// Survive wrapper idle eviction and Next hot reload, just like live sessions.
const registry = globalThis as typeof globalThis & { __piComposerQueues?: Map<string, QueueState> };
function stateFor(id: string): QueueState {
  const queues = registry.__piComposerQueues ??= new Map();
  let state = queues.get(id);
  if (!state) queues.set(id, state = { items: [], paused: false, version: 0 });
  state.version ??= 0;
  return state;
}

export function getPendingComposerMessages(sessionId: string): PendingComposerMessage[] {
  return registry.__piComposerQueues?.get(sessionId)?.items.map(item => ({ ...item })) ?? [];
}

export function getComposerQueueVersion(sessionId: string): number {
  return registry.__piComposerQueues?.get(sessionId)?.version ?? 0;
}

/** Editable outbox. Items enter the SDK only when claimed for delivery.
 * Never clear/rebuild SDK queues: that loses attachments and races its agent loop.
 */
export class ComposerQueue {
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private delivering = false;
  private readonly state: QueueState;

  constructor(sessionId: string, private readonly callbacks: {
    canDeliver: () => boolean;
    deliver: (item: PendingComposerMessage, steer: boolean) => Promise<unknown>;
    changed: (items: PendingComposerMessage[], version: number) => void;
    failed: (error: unknown) => void;
  }) {
    this.state = stateFor(sessionId);
  }

  snapshot() { return this.state.items.map(item => ({ ...item })); }
  get version() { return this.state.version; }

  enqueue(message: string, images?: PendingComposerMessage["images"], id = randomUUID()) {
    if (typeof message !== "string" || (!message.trim() && !images?.length)) throw new Error("Message is empty");
    if (this.state.items.length >= 100) throw new Error("Too many queued messages");
    const item = { id, message, ...(images?.length ? { images } : {}) };
    this.state.items.push(item);
    this.state.paused = false;
    this.changed();
    this.wake();
    return item;
  }

  take(id: string) {
    const index = this.state.items.findIndex(item => item.id === id);
    // Idle delivery, another window or a rapid second click may win the claim.
    // Missing is a normal no-op; never send or restore the original again.
    if (index < 0) return null;
    const [item] = this.state.items.splice(index, 1);
    this.changed();
    return item;
  }

  async sendNow(id: string) {
    const item = this.take(id);
    if (!item) return;
    try {
      await this.callbacks.deliver(item, true);
    } catch (error) {
      this.state.items.unshift(item);
      this.pause();
      this.changed();
      throw error;
    }
  }

  pause() { this.state.paused = true; }

  wake() {
    if (this.disposed || this.timer || this.delivering || this.state.paused || !this.state.items.length) return;
    // agent_settled is emitted before SDK idle flags and RPC admission settle.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, 0);
  }

  private async drain() {
    if (this.disposed || this.delivering || this.state.paused || !this.state.items.length || !this.callbacks.canDeliver()) return;
    const item = this.take(this.state.items[0].id);
    if (!item) return;
    this.delivering = true;
    try {
      await this.callbacks.deliver(item, false);
    } catch (error) {
      this.state.items.unshift(item);
      this.pause();
      this.changed();
      this.callbacks.failed(error);
    } finally {
      this.delivering = false;
      this.wake();
    }
  }

  private changed() { this.state.version++; this.callbacks.changed(this.snapshot(), this.version); }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

// --- memory pressure (lib/server-memory.ts) --------------------------------
// A queue holds the prompts waiting behind a run, base64 attachments included:
// a 10 MB image is 13.3 million characters in the heap. Queues outlive the
// wrapper — they are kept for sessions that are closed, finished or deleted —
// and nothing caps them. An empty queue costs a Map entry, so pressure drops
// those first; a queue with items goes only when the whole sum is over budget,
// which is the moment a queued prompt is worth less than the server staying up.

/** Characters of prompt text and attachment data queued, across all sessions. */
export function composerQueueBytes(): number {
  let bytes = 0;
  for (const state of registry.__piComposerQueues?.values() ?? []) {
    for (const item of state.items) {
      bytes += item.message.length;
      for (const image of item.images ?? []) bytes += image.data.length;
    }
  }
  return bytes;
}

/** Drop empty queues first, then whole sessions, oldest first, to `targetBytes`. */
export function shrinkComposerQueues(targetBytes: number): number {
  const queues = registry.__piComposerQueues;
  if (!queues) return 0;
  const before = composerQueueBytes();
  let total = before;
  const freedBy = (state: QueueState) => {
    let freed = 0;
    for (const item of state.items) {
      freed += item.message.length;
      for (const image of item.images ?? []) freed += image.data.length;
    }
    return freed;
  };
  for (const [id, state] of [...queues.entries()]) {
    if (state.items.length === 0) queues.delete(id);
  }
  for (const [id, state] of [...queues.entries()]) {
    if (total <= Math.max(0, targetBytes)) break;
    total -= freedBy(state);
    queues.delete(id);
  }
  return Math.max(0, before - total);
}

registerCachePruner({
  name: "composer queues",
  bytes: composerQueueBytes,
  prune: shrinkComposerQueues,
});
