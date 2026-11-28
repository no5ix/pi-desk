/**
 * Release of heavyweight expanded content (Phase 6).
 *
 * Expanding a card in the chat fetches bytes the collapsed card does not need:
 * a thinking block's full reasoning, a shell command's full output, a tool
 * result whose live copy the stream cut to its payload budget. Every one of
 * those lands in a component's `useState` and stays there while the row is
 * mounted — and a row stays mounted while the reader scrolls the transcript,
 * so a session with a dozen 2 MB logs open keeps 24 MB of text the screen is
 * not showing.
 *
 * The rule this module implements:
 *
 *  - collapsing a card **gives the fetched text back** once it is big enough
 *    that refetching is cheaper than holding it (`shouldReleaseOnCollapse`);
 *  - the fetch caches that make re-expanding cheap are bounded by **bytes**, not
 *    only by entry counts, and they answer to the page's own memory pressure
 *    (`announceContentPressure`), which `lib/client-memory.ts` reports;
 *  - the thresholds are named and tested, so a card is never emptied of content
 *    the reader is looking at: release happens on collapse, and the card that
 *    reopens loads the content again (from cache when the cache still holds it).
 */

/** Text at or above this length is worth refetching rather than keeping. */
export const RELEASE_ON_COLLAPSE_CHARS = 16 * 1024;

/**
 * Whether a collapsed card should give its fetched text back.
 *
 * Small content stays: re-expanding it must not cost a round trip for a few
 * hundred characters, and the bytes it holds are not what this is about.
 */
export function shouldReleaseOnCollapse(
  text: string | null | undefined,
  threshold = RELEASE_ON_COLLAPSE_CHARS,
): boolean {
  return typeof text === "string" && text.length >= threshold;
}

/** One entry of a retained-content cache. */
interface RetainedEntry<T> {
  value: T;
  bytes: number;
}

/**
 * A cache of fetched content, bounded by entries *and* bytes, coldest entry
 * first. The count bound alone was the old bug shape: 24 entries of a 3 MB
 * thinking block is 72 MB of reasoning a collapsed card no longer shows.
 */
export class RetainedTextCache<T> {
  private readonly entries = new Map<string, RetainedEntry<T>>();
  private total = 0;

  constructor(
    private readonly maxEntries = 24,
    private readonly maxBytes = 4 * 1024 * 1024,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // LRU touch: a key that is read is a key the reader may read again.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.total -= existing.bytes;
      this.entries.delete(key);
    }
    const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    this.entries.set(key, { value, bytes: size });
    this.total += size;
    this.evict();
  }

  delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.total -= entry.bytes;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.total = 0;
  }

  /** Bytes the cache accounts for (0 when the cache stores only estimates). */
  bytes(): number {
    return this.total;
  }

  size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries || this.total > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }
}

/** Every content cache that answers to the page's memory pressure. */
const pressureCaches = new Set<{ clear(): void }>();

/** Register a cache so `announceContentPressure` can empty it. */
export function registerContentCache(cache: { clear(): void }): void {
  pressureCaches.add(cache);
}

export function unregisterContentCache(cache: { clear(): void }): void {
  pressureCaches.delete(cache);
}

/** Fired when the page reports its own heap is over budget (lib/client-memory.ts). */
export const CONTENT_PRESSURE_EVENT = "pi-web:content-pressure";

/**
 * Drop every retained expanded payload. The page sends this when its JS heap is
 * over budget; the cards refill on the next expand, from the server.
 */
export function announceContentPressure(): void {
  for (const cache of pressureCaches) cache.clear();
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new Event(CONTENT_PRESSURE_EVENT));
  }
}
