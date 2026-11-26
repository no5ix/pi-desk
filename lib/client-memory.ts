"use client";

// What this page is holding, so a report of "the tab ate 2 GB" names something.
//
// The page keeps the loaded window of a session in React state, renders one row
// per loaded message, and caches settled views per session. Nothing in the
// browser meters that, and the server can only see its own side, so the page
// reports its numbers on the lease renewal it already sends every 30 seconds
// (app/api/agent/[id]/lease/route.ts → lib/server-memory.ts). Reading them costs
// a `querySelectorAll` and one `performance.memory` read, once a renewal.
//
// `performance.memory` is Chromium-only and coarse (it is deliberately rounded to
// keep it out of fingerprinting); where it is absent the sample carries null and
// the DOM and message counts still say what the page is doing.

/** Chromium's non-standard heap counter. Absent in Safari and Firefox. */
interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface ClientMemoryCounters {
  /** Messages the page has loaded for the selected session. */
  messages?: number;
  /** Rows in the DOM, which is what layout and paint cost. */
  renderedRows?: number;
  /** Composer prompts waiting to be sent, whose attached images are base64. */
  queuedPrompts?: number;
}

export interface ClientMemorySample extends ClientMemoryCounters {
  /** `performance.memory.usedJSHeapSize`, or null where the browser reports none. */
  jsHeapBytes: number | null;
  /** Heap V8 has committed, not what is live in it. */
  heapTotalBytes: number | null;
  domNodes: number;
  /** Document nodes per rendered row: the honest measure of a heavy chat. */
  nodesPerRow: number;
}

/** The rows of the chat, counted by the attribute the scroll code already uses. */
export function countRenderedRows(root: ParentNode | null = document): number {
  if (!root) return 0;
  try {
    return root.querySelectorAll("[data-entry-id]").length;
  } catch {
    // A detached root or an odd document: a missing counter is not worth a page error.
    return 0;
  }
}

export function sampleClientMemory(counters: ClientMemoryCounters = {}): ClientMemorySample {
  const memory = (performance as PerformanceWithMemory).memory;
  const domNodes = document.getElementsByTagName("*").length;
  const renderedRows = counters.renderedRows ?? countRenderedRows();
  return {
    jsHeapBytes: memory?.usedJSHeapSize ?? null,
    heapTotalBytes: memory?.totalJSHeapSize ?? null,
    domNodes,
    nodesPerRow: renderedRows > 0 ? Math.round(domNodes / renderedRows) : 0,
    messages: counters.messages ?? 0,
    renderedRows,
    queuedPrompts: counters.queuedPrompts ?? 0,
  };
}
