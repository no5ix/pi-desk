// The pruner contract every long-lived cache signs up to.
//
// The server keeps a dozen stores on `globalThis` on purpose: hot reload in dev
// and a session's idle eviction must not lose a scan, a file listing, an
// artifact index, a composer queue. That is the right design and it has no
// owner: nothing in it decides when the sum of them is too much, which is how a
// server ends at 10 GB with all its sessions finished.
//
// So each cache says, in one place, what it holds and how to give some of it
// back. `lib/server-memory.ts` reads the list under memory pressure, and the
// debug meter reads it for the same numbers. Adding a cache means adding a
// pruner beside it, and `lib/cache-registry.test.mjs` fails when two caches
// share a name.
//
// A pruner is a read of a count and a synchronous drop. It never blocks, never
// throws out of the valve (the caller wraps each call), and never touches a
// store it does not own.

export interface CachePruner {
  /** Stable name, matching the debug meter's bucket name where there is one. */
  name: string;
  /** What it holds now, in the bytes the store itself can name. */
  bytes(): number;
  /**
   * Drop the coldest entries until at most `targetBytes` remain, and return the
   * bytes given up. A store that cannot measure its heap returns a proxy
   * (a file's size, a string's length) and says so in the meter's note.
   */
  prune(targetBytes: number): number;
}

const REGISTRY_KEY = Symbol.for("pi-web:cache-pruners");

interface PrunerRegistry {
  pruners: Map<string, CachePruner>;
}

function registry(): PrunerRegistry {
  const host = globalThis as typeof globalThis & { [REGISTRY_KEY]?: PrunerRegistry };
  const existing = host[REGISTRY_KEY];
  if (existing) return existing;
  const created: PrunerRegistry = { pruners: new Map() };
  host[REGISTRY_KEY] = created;
  return created;
}

/**
 * Publish a cache's pruner. Idempotent per name: a module re-evaluated by a hot
 * reload replaces its own entry and nothing else's. Returns the unregister.
 */
export function registerCachePruner(pruner: CachePruner): () => void {
  const { pruners } = registry();
  pruners.set(pruner.name, pruner);
  return () => {
    if (registry().pruners.get(pruner.name) === pruner) registry().pruners.delete(pruner.name);
  };
}

export function listCachePruners(): CachePruner[] {
  return [...registry().pruners.values()];
}

export function getCachePruner(name: string): CachePruner | undefined {
  return registry().pruners.get(name);
}
