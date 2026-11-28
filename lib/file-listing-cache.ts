/**
 * The file tree's directory listings, fetched once.
 *
 * Opening the panel asks for the root; every folder the reader opens asks for one
 * more directory. The server answers a warm listing in 12–26 ms (measured on a
 * production build), so the cost a reader feels is not the server: it is the same
 * directory asked twice — React's development double effect, a refresh bump, a
 * folder collapsed and reopened, an expansion that races a prefetch.
 *
 * So the listings go through one cache with three rules:
 *
 *  - **In flight is enough.** A directory already being fetched is shared, not
 *    started again: two callers, one request.
 *  - **A short window, not a lifetime.** A listing answers for 2 s by default, and
 *    the app invalidates a directory the moment it changes something in it. A
 *    directory that failed is never cached: a refused read must stay retryable.
 *  - **A prefetch is a courtesy.** Prefetched children fill the same cache at a
 *    bounded concurrency, and a folder the reader opens mid-prefetch joins the
 *    request already running rather than starting a second one.
 */

/**
 * How long a directory listing answers before a fresh look is asked for.
 *
 * Long enough to cover the reader, not just the burst: a two-second window covered
 * the development double effect and a collapse-and-reopen, and expired before a
 * hand reached the mouse, so a prefetched folder was fetched again. The app
 * invalidates the moment it writes, renames or deletes in a folder, and the tree's
 * refresh is a force, so the window only ever answers a folder nobody changed.
 */
export const LISTING_TTL_MS = 15_000;

/** How many prefetched directories are in flight at once (the browser's own budget is smaller than the list). */
export const PREFETCH_CONCURRENCY = 3;

interface Inflight<T> {
  promise: Promise<T[]>;
  /** Callers that asked for the same directory and must not each start a request. */
  count: number;
}

interface Cached<T> {
  entries: T[];
  expiresAt: number;
}

export interface DirectoryCache {
  /**
   * `dirPath`'s entries. `fetch` runs at most once per window per directory: a
   * second caller joins the running request, and a caller inside the window gets
   * the answer without a request. `force` asks again (the tree's refresh).
   */
  list<T>(dirPath: string, showHidden: boolean, fetch: () => Promise<T[]>, opts?: { force?: boolean; ttlMs?: number }): Promise<T[]>;
  /** Fill the cache for many directories, at a bounded concurrency. Errors are swallowed: a courtesy. */
  prefetch(dirPaths: readonly string[], showHidden: boolean, fetch: (dirPath: string) => Promise<unknown>, opts?: { concurrency?: number; ttlMs?: number }): Promise<void>;
  /** Forget one directory (the app wrote in it, renamed in it, deleted in it). */
  invalidate(dirPath: string): void;
  /** Forget a directory and everything under it. */
  invalidateTree(dirPath: string): void;
  /** Everything. */
  clear(): void;
  /** What the cache saved, for the checks and the debug panel. */
  stats(): { hits: number; fetches: number; inflightJoins: number; prefetched: number };
  resetStats(): void;
}

const keyFor = (dirPath: string, showHidden: boolean) => `${showHidden ? "1" : "0"}|${dirPath}`;

/** The directory's ancestors, nearest first — a change in a folder changes what its parent lists. */
export function ancestorDirectories(dirPath: string): string[] {
  const parts = dirPath.split("/");
  const out: string[] = [];
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const ancestor = parts.slice(0, i).join("/") || "/";
    out.push(ancestor);
  }
  return out;
}

export function createDirectoryCache(defaultTtlMs = LISTING_TTL_MS): DirectoryCache {
  const cache = new Map<string, Cached<unknown>>();
  const inflight = new Map<string, Inflight<unknown>>();
  let hits = 0;
  let fetches = 0;
  let inflightJoins = 0;
  let prefetched = 0;

  return {
    list<T>(dirPath: string, showHidden: boolean, fetch: () => Promise<T[]>, opts: { force?: boolean; ttlMs?: number } = {}): Promise<T[]> {
      const key = keyFor(dirPath, showHidden);
      const cached = cache.get(key) as Cached<T> | undefined;
      if (!opts.force && cached && cached.expiresAt > Date.now()) {
        hits += 1;
        return Promise.resolve(cached.entries);
      }
      const running = inflight.get(key) as Inflight<T> | undefined;
      if (running && !opts.force) {
        inflightJoins += 1;
        running.count += 1;
        return running.promise;
      }
      fetches += 1;
      const promise = fetch().then((entries) => {
        cache.set(key, { entries, expiresAt: Date.now() + (opts.ttlMs ?? defaultTtlMs) });
        inflight.delete(key);
        return entries;
      }, (error: unknown) => {
        // A refused or failing listing is not an answer: the next caller asks again.
        inflight.delete(key);
        throw error;
      });
      inflight.set(key, { promise, count: 1 });
      return promise;
    },

    async prefetch(dirPaths, showHidden, fetch, opts: { concurrency?: number; ttlMs?: number } = {}): Promise<void> {
      const limit = Math.max(1, opts.concurrency ?? PREFETCH_CONCURRENCY);
      const queue = [...dirPaths];
      const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
          try {
            // The prefetch does not care what a listing holds, only that the
            // directory gets an entry in the cache.
            await this.list(next, showHidden, () => fetch(next) as Promise<unknown[]>, opts);
            prefetched += 1;
          } catch {
            // A folder that refuses a listing is not prefetched. The reader opening
            // it asks for itself, and sees the refusal.
          }
        }
      });
      await Promise.all(workers);
    },

    invalidate(dirPath) {
      for (const hidden of [false, true]) cache.delete(keyFor(dirPath, hidden));
      for (const ancestor of ancestorDirectories(dirPath)) {
        for (const hidden of [false, true]) cache.delete(keyFor(ancestor, hidden));
      }
    },

    invalidateTree(dirPath) {
      // A change inside a folder changes the folder, its listings, and every
      // listing above it that shows it.
      for (const key of [...cache.keys()]) {
        const dir = key.slice(2);
        if (dir === dirPath || dir.startsWith(`${dirPath}/`) || ancestorDirectories(dir).includes(dirPath)) {
          cache.delete(key);
        }
      }
    },

    clear() {
      cache.clear();
    },

    stats() {
      return { hits, fetches, inflightJoins, prefetched };
    },

    resetStats() {
      hits = 0;
      fetches = 0;
      inflightJoins = 0;
      prefetched = 0;
    },
  };
}

/** The tree's own cache: one per browser tab, like the expansion memory. */
export const directoryCache: DirectoryCache = createDirectoryCache();

/**
 * A debug affordance. The tree's requests are invisible in the network panel's
 * noise, so the cache keeps its own tally and puts it where a probe and the Debug
 * panel can read it: `__piFileListingCache.stats()` answers the fetches, the cache
 * hits, the joined requests and the prefetched directories.
 */
if (typeof window !== "undefined") {
  (window as unknown as { __piFileListingCache?: DirectoryCache }).__piFileListingCache = directoryCache;
}

/** The child directories of a listing, in the order the tree shows them. */
export function childDirectoriesOf<T>(entries: readonly T[], dirPath: string, nameOf: (entry: T) => string, isDirOf: (entry: T) => boolean): string[] {
  const base = dirPath.endsWith("/") ? dirPath.slice(0, -1) : dirPath;
  return entries.filter(isDirOf).map((entry) => `${base}/${nameOf(entry)}`);
}
