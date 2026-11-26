// What this process is holding, and the number at which that is too much.
//
// The server keeps a loaded session's full transcript in the heap, and every
// long-lived store in it lives on `globalThis` on purpose (hot reload in dev and
// a session's idle eviction must not lose a scan, a queue, or an index). That is
// a design with no built-in accounting: 10 GB of RSS told the operator that
// something was wrong and nothing at all about what. This module is the
// accounting — a cheap synchronous sample of the process and of each store that
// can grow, so a number in a report maps to a named bucket, and so the pressure
// valve that releases them has something to measure.
//
// Every bucket is read from the store that owns it, on the request path, with no
// import of that store's module if it was never loaded. Byte figures are the
// bytes the store can name (a session file's size, a string's length, a queued
// SSE backlog) — a proxy for retained heap, not a measurement of it: the
// measured ratio for a parsed transcript is roughly the file's own size
// (docs/agents/fork-sessions.md, lib/session-reader.ts's cache comment). A bucket
// that stopped at a walk bound says so with `partial: true`, so a floor never
// reads as an exact figure.

import { statSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import { listAgentEventStreams } from "./agent-event-stream";

export interface DebugMemoryBucket {
  /** Stable dotted name: `sessions.live`, `caches.sessionManager`, `streams.queued`. */
  name: string;
  count: number;
  /** Bytes the store can name. 0 when the store is not loaded at all. */
  bytes: number;
  /** The walk stopped at a bound, so `bytes` is a floor. */
  partial?: boolean;
  note?: string;
}

export interface DebugPageMemory {
  sessionId: string;
  at: number;
  /** Chrome's `performance.memory` used heap; null where the browser reports none. */
  jsHeapBytes: number | null;
  domNodes: number;
  /** The page's own counters: loaded messages, rendered rows, queued prompts. */
  messages: number;
  renderedRows: number;
  queuedPrompts: number;
}

export interface DebugMemoryReport {
  at: number;
  /** Process resident memory, the number Activity Monitor shows. */
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  /** V8's old-space ceiling in force — bin/server-flags.js sets it; otherwise Next's (dev: half of RAM) or V8's default. */
  heapLimit: number;
  /** The pressure threshold, `PI_WEB_MEMORY_BUDGET_MB`. 0: the valve is off. */
  budgetMb: number;
  overBudget: boolean;
  /** True when `global.gc()` exists (a dev server started with `--expose-gc`). */
  gcAvailable: boolean;
  /** Set only by `?memory=1&gc=1`: whether a collection ran for this report. */
  gcRequested?: boolean;
  lastGcAt: number | null;
  /** The high-water RSS since the process started. */
  peakRss: number;
  samples: number;
  buckets: DebugMemoryBucket[];
  pages: DebugPageMemory[];
  /** The last pressure valve run, or null when nothing has been released. */
  pressure: DebugPressureState | null;
}

export interface DebugPressureAction {
  name: string;
  bytesFreed: number;
}

export interface DebugPressureState {
  at: number;
  /** What asked for it: `over-budget`, `requested`. */
  reason: string;
  actions: DebugPressureAction[];
  freedBytes: number;
  /** True when `global.gc()` ran (the process has `--expose-gc`). */
  collected: boolean;
}

/**
 * PI_WEB_MEMORY_BUDGET_MB: the RSS above which the server starts releasing what
 * it is holding. Unset is 1024, `0` switches the valve off, and the value is
 * clamped to a range that is a budget and not a joke. It is deliberately lower
 * than the heap ceiling: the caches and wrappers are what get released, and the
 * ceiling is what makes collecting them worth doing.
 */
export const DEFAULT_MEMORY_BUDGET_MB = 1024;
const MIN_MEMORY_BUDGET_MB = 256;
const MAX_MEMORY_BUDGET_MB = 32 * 1024;

export function resolveMemoryBudgetMb(rawValue: string | undefined = process.env.PI_WEB_MEMORY_BUDGET_MB): number {
  const raw = (rawValue ?? "").trim();
  if (raw === "") return DEFAULT_MEMORY_BUDGET_MB;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MEMORY_BUDGET_MB;
  if (parsed === 0) return 0;
  return Math.min(MAX_MEMORY_BUDGET_MB, Math.max(MIN_MEMORY_BUDGET_MB, Math.round(parsed)));
}

const MB = 1024 * 1024;

function asMap(value: unknown): Map<unknown, unknown> | null {
  return value instanceof Map ? value as Map<unknown, unknown> : null;
}

function byteLengthOf(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

function sumStringLengths(values: Iterable<unknown>): number {
  let bytes = 0;
  for (const value of values) bytes += byteLengthOf(value);
  return bytes;
}

/**
 * The wrappers: the session files they hold, summed. This is the bucket the
 * whole task is about — the transcript is the payload, and a loaded wrapper
 * keeps all of it (node_modules/@earendil-works/pi-coding-agent/dist/core/
 * session-manager.js's `fileEntries`).
 */
function liveSessionBucket(): DebugMemoryBucket {
  const registry = asMap((globalThis as Record<PropertyKey, unknown>).__piSessions);
  if (!registry) return { name: "sessions.live", count: 0, bytes: 0 };
  let bytes = 0;
  for (const wrapper of registry.values()) {
    const sessionFile = (wrapper as { sessionFile?: unknown })?.sessionFile;
    if (typeof sessionFile !== "string") continue;
    try {
      bytes += statSync(sessionFile).size;
    } catch {
      // A not-yet-flushed session has no file: its entries are in the heap, and
      // the byte figure simply counts what is on disk.
    }
  }
  return { name: "sessions.live", count: registry.size, bytes };
}

/** The read-only SessionManager cache: it already knows each entry's on-disk size. */
function sessionManagerCacheBucket(): DebugMemoryBucket {
  const cache = asMap((globalThis as Record<PropertyKey, unknown>).__piSmCache);
  if (!cache) return { name: "caches.sessionManager", count: 0, bytes: 0 };
  let bytes = 0;
  for (const entry of cache.values()) bytes += Number((entry as { bytes?: unknown })?.bytes) || 0;
  return { name: "caches.sessionManager", count: cache.size, bytes, note: "slimmed view; bytes are the file size they were measured at" };
}

function sessionListBucket(): DebugMemoryBucket {
  const cache = (globalThis as Record<PropertyKey, unknown>).__piSessionListCache as
    { data?: unknown[]; ts?: number } | undefined;
  const rows = Array.isArray(cache?.data) ? cache.data.length : 0;
  // A row is metadata plus a clipped first message; counted, not weighed.
  return { name: "caches.sessionList", count: rows, bytes: rows * 1024, note: "bytes estimated at 1 KiB per row" };
}

/** Every prompt of every session the calendar read, keyed by file. */
function promptCacheBucket(): DebugMemoryBucket {
  const cache = asMap((globalThis as Record<PropertyKey, unknown>).__piSessionPromptCache);
  if (!cache) return { name: "caches.prompts", count: 0, bytes: 0 };
  let bytes = 0;
  for (const entry of cache.values()) {
    const prompts = (entry as { prompts?: unknown })?.prompts;
    if (!Array.isArray(prompts)) continue;
    for (const prompt of prompts) {
      if (typeof prompt !== "object" || prompt === null) continue;
      const record = prompt as Record<string, unknown>;
      bytes += byteLengthOf(record.text) + byteLengthOf(record.reply);
    }
  }
  return { name: "caches.prompts", count: cache.size, bytes };
}

/**
 * The artifact index: every version of every artifact, with its full text, and
 * persisted to disk. Walking all of it every sample is the point (it is the
 * store that grows without bound), so the walk is bounded and says so.
 */
function artifactIndexBucket(): DebugMemoryBucket {
  const index = asMap((globalThis as Record<PropertyKey, unknown>).__piWebArtifactIndex);
  if (!index) return { name: "caches.artifactIndex", count: 0, bytes: 0 };
  let versions = 0;
  let bytes = 0;
  let scanned = 0;
  for (const file of index.values()) {
    if (scanned++ >= 400) {
      return { name: "caches.artifactIndex", count: index.size, bytes, partial: true, note: `${versions} artifact versions in the first ${scanned} files` };
    }
    const artifacts = (file as { artifacts?: unknown })?.artifacts;
    if (!Array.isArray(artifacts)) continue;
    for (const artifact of artifacts) {
      const list = (artifact as { versions?: unknown })?.versions;
      if (!Array.isArray(list)) continue;
      for (const version of list) {
        versions += 1;
        bytes += byteLengthOf((version as { content?: unknown })?.content);
      }
    }
  }
  return { name: "caches.artifactIndex", count: index.size, bytes, note: `${versions} artifact versions` };
}

/** The @-menu file listings: up to 200 000 paths per project, 20 projects. */
function fileIndexBucket(): DebugMemoryBucket {
  const cache = asMap((globalThis as Record<PropertyKey, unknown>).__piFileIndexCache);
  if (!cache) return { name: "caches.fileIndex", count: 0, bytes: 0 };
  let paths = 0;
  for (const entry of cache.values()) {
    const files = (entry as { listing?: { files?: unknown } })?.listing?.files;
    if (Array.isArray(files)) paths += files.length;
  }
  return { name: "caches.fileIndex", count: cache.size, bytes: paths * 64, note: `${paths} paths, bytes estimated at 64 B each` };
}

function composerQueueBucket(): DebugMemoryBucket {
  const queues = asMap((globalThis as Record<PropertyKey, unknown>).__piComposerQueues);
  if (!queues) return { name: "queues.composer", count: 0, bytes: 0 };
  let items = 0;
  let bytes = 0;
  for (const state of queues.values()) {
    const list = (state as { items?: unknown })?.items;
    if (!Array.isArray(list)) continue;
    items += list.length;
    for (const item of list) {
      const record = item as Record<string, unknown>;
      bytes += byteLengthOf(record.text ?? record.message);
      if (Array.isArray(record.images)) bytes += sumStringLengths(record.images.map((image) => (image as { data?: unknown })?.data));
    }
  }
  // The Map keeps an entry per session that ever queued a prompt; the items are
  // what cost anything, and an attached image is base64.
  return { name: "queues.composer", count: queues.size, bytes, note: `${items} queued prompts` };
}

function terminalBucket(): DebugMemoryBucket {
  const terminals = asMap((globalThis as Record<PropertyKey, unknown>).__piWebTerminals);
  if (!terminals) return { name: "terminals", count: 0, bytes: 0 };
  let bytes = 0;
  let exited = 0;
  for (const record of terminals.values()) {
    const entry = record as { backlog?: unknown; exited?: unknown };
    bytes += byteLengthOf(entry?.backlog);
    if (entry?.exited === true) exited += 1;
  }
  return { name: "terminals", count: terminals.size, bytes, note: `${exited} exited shells kept in the registry` };
}

function streamBucket(): DebugMemoryBucket {
  const streams = listAgentEventStreams();
  let bytes = 0;
  for (const stream of streams) bytes += stream.queuedBytes;
  return { name: "streams.queued", count: streams.length, bytes, note: "SSE backlogs awaiting a slow client" };
}

function mcpBucket(): DebugMemoryBucket {
  // A registered stdio server is a child process of this one, so the count is
  // the memory figure: it is charged outside the heap, and it is what a phone
  // and four browser-automation servers leave running behind idle sessions.
  const hosts = asMap((globalThis as Record<PropertyKey, unknown>).__piSessions);
  if (!hosts) return { name: "mcp.servers", count: 0, bytes: 0 };
  let servers = 0;
  let hostsCount = 0;
  for (const wrapper of hosts.values()) {
    const getSnapshot = (wrapper as { getMcpDebugSnapshot?: () => { servers?: unknown[] } | null })?.getMcpDebugSnapshot;
    if (typeof getSnapshot !== "function") continue;
    const snapshot = getSnapshot.call(wrapper);
    if (!snapshot) continue;
    hostsCount += 1;
    if (Array.isArray(snapshot.servers)) servers += snapshot.servers.length;
  }
  return { name: "mcp.servers", count: servers, bytes: 0, note: `${hostsCount} hosts, one per live session` };
}

/** Every bucket, in the order that answers "where is it". */
function collectBuckets(): DebugMemoryBucket[] {
  return [
    liveSessionBucket(),
    sessionManagerCacheBucket(),
    streamBucket(),
    mcpBucket(),
    artifactIndexBucket(),
    fileIndexBucket(),
    promptCacheBucket(),
    sessionListBucket(),
    composerQueueBucket(),
    terminalBucket(),
  ];
}

/** A page's own numbers, sent with the lease renewal (every 30 s, per selected session). */
const pageMemory = new Map<string, DebugPageMemory>();
const PAGE_MEMORY_LIMIT = 24;

export function recordPageMemory(sample: DebugPageMemory): void {
  if (!sample?.sessionId) return;
  pageMemory.delete(sample.sessionId);
  pageMemory.set(sample.sessionId, sample);
  while (pageMemory.size > PAGE_MEMORY_LIMIT) {
    const oldest = pageMemory.keys().next();
    if (oldest.done) break;
    pageMemory.delete(oldest.value);
  }
}

export function listPageMemory(): DebugPageMemory[] {
  return [...pageMemory.values()];
}

/** `global.gc()` exists only behind `--expose-gc`; asking for one is a dev affordance. */
export function collectGarbage(): boolean {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== "function") return false;
  gc();
  return true;
}

const serverStartedAt = Date.now();
let lastReport: DebugMemoryReport | null = null;
let peakRss = 0;
let samples = 0;
let lastGcAt: number | null = null;
let lastValve: DebugPressureState | null = null;
/** The shortest gap between two valve runs — releasing is main-thread work. */
const VALVE_INTERVAL_MS = 60_000;

/**
 * One sample. Synchronous and cheap: a few `statSync` calls (one per loaded
 * session), a heap statistics read, and bounded walks of the long-lived stores.
 * The debug route calls it, and the sampler calls it on a timer, so it must stay
 * well under a millisecond for a normal load.
 */
export function sampleServerMemory(now: number = Date.now()): DebugMemoryReport {
  const usage = process.memoryUsage();
  const heap = getHeapStatistics();
  peakRss = Math.max(peakRss, usage.rss);
  samples += 1;
  const budgetMb = resolveMemoryBudgetMb();
  const report: DebugMemoryReport = {
    at: now,
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    heapLimit: heap.heap_size_limit,
    budgetMb,
    overBudget: budgetMb > 0 && usage.rss > budgetMb * MB,
    gcAvailable: typeof (globalThis as { gc?: unknown }).gc === "function",
    lastGcAt,
    peakRss,
    samples,
    buckets: collectBuckets(),
    pages: listPageMemory(),
    pressure: lastValve,
  };
  lastReport = report;
  return report;
}

/** The last sample, taken now if nothing has taken one recently. */
export function getServerMemoryReport(maxAgeMs = 5_000, now: number = Date.now()): DebugMemoryReport {
  if (!lastReport || now - lastReport.at > maxAgeMs) return sampleServerMemory(now);
  return lastReport;
}

export function getServerStartedAt(): number {
  return serverStartedAt;
}

const SAMPLER_INTERVAL_MS = 30_000;
let samplerTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Keep the process metered for as long as the process lives. Unref'd, so a
 * sampler never holds the server open, and idempotent, so a hot reload does not
 * stack timers.
 */
export function startServerMemorySampler(intervalMs: number = SAMPLER_INTERVAL_MS): void {
  if (samplerTimer) return;
  samplerTimer = setInterval(() => {
    try {
      const report = sampleServerMemory();
      // Over the RSS budget, release what can be released (at most once a minute).
      if (report.overBudget) void maybeApplyPressure(report.at)?.catch(() => {});
    } catch {
      // Reading the process must never be the reason the server has a problem.
    }
  }, intervalMs);
  samplerTimer.unref?.();
  sampleServerMemory();
}

export function stopServerMemorySampler(): void {
  if (samplerTimer) clearInterval(samplerTimer);
  samplerTimer = null;
}

export function noteGarbageCollection(at: number = Date.now()): void {
  lastGcAt = at;
}

// --- the pressure valve ----------------------------------------------------
// A release path with no trigger is a code path nobody measures: sessions leave
// on a ten-minute timer, caches never leave at all, and V8 returns pages only
// when its heap is tight. So the valve is a trigger with an order:
//
//   1. the loaded transcripts — the idle byte cap, run at half its budget with
//      no grace, which is the largest store and the one the next read refetches;
//   2. every cache that registered a pruner (lib/cache-registry.ts), halved,
//      coldest entry first;
//   3. V8's garbage collector, when the process was started with `--expose-gc`.
//
// Order matters as much as the steps: collecting before the stores are released
// frees nothing, because every byte is still reachable.
//
// It fires when the process is over PI_WEB_MEMORY_BUDGET_MB, at most once a
// minute, and on request (the debug route's `pressure=1`, the bench). It is
// synchronous work on the main thread — a Map drop and, in dev, a full GC — so
// the interval is the cost control, and the report keeps the last run's actions
// so a drop in the numbers is explainable.

const valve = {
  running: null as Promise<DebugPressureState> | null,
  lastAt: 0,
};

function halve(bytes: number): number {
  return Math.floor(bytes / 2);
}

async function runValve(reason: string, now: number): Promise<DebugPressureState> {
  const actions: DebugPressureAction[] = [];
  let freedBytes = 0;

  // 1. Loaded transcripts the person is not looking at.
  try {
    const rpc = await import("./rpc-manager");
    const cap = rpc.IDLE_SESSION_CAP_BYTES;
    const before = liveSessionBucket().bytes;
    const evicted = rpc.enforceIdleSessionCap(now, { maxBytes: halve(cap), graceMs: 0 });
    const freed = Math.max(0, before - liveSessionBucket().bytes);
    if (evicted.length > 0 || freed > 0) {
      actions.push({ name: `sessions (${evicted.length} released)`, bytesFreed: freed });
      freedBytes += freed;
    }
  } catch (error) {
    console.warn(`[pi-web] memory pressure: the session cap did not run: ${error instanceof Error ? error.message : error}`);
  }

  // 2. The caches, each to half of what it holds.
  const { listCachePruners } = await import("./cache-registry");
  for (const pruner of listCachePruners()) {
    try {
      const held = pruner.bytes();
      if (held <= 0) continue;
      const freed = pruner.prune(halve(held));
      if (freed > 0) {
        actions.push({ name: pruner.name, bytesFreed: freed });
        freedBytes += freed;
      }
    } catch (error) {
      // A pruner that throws is a bug in that cache, not a reason to stop releasing.
      console.warn(`[pi-web] memory pressure: pruner "${pruner.name}" failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  const collected = collectGarbage();
  const state: DebugPressureState = { at: now, reason, actions, freedBytes, collected };
  lastValve = state;
  valve.lastAt = now;
  const summary = actions.map((action) => `${action.name} -${Math.round(action.bytesFreed / MB)} MB`).join(", ");
  console.log(
    `[pi-web] memory pressure (${reason}): released ${Math.round(freedBytes / MB)} MB` +
    `${summary ? `: ${summary}` : " — nothing was holding"}` +
    `${collected ? ", garbage collected" : ""}`,
  );
  return state;
}

/**
 * Release what can be released. One run at a time; a second call while one is
 * running joins it.
 */
export function applyMemoryPressure(reason = "requested", now: number = Date.now()): Promise<DebugPressureState> {
  if (valve.running) return valve.running;
  const run = runValve(reason, now).finally(() => {
    if (valve.running === run) valve.running = null;
  });
  valve.running = run;
  return run;
}

/** The sampler's trigger: over the RSS budget, and not more than once a minute. */
export function maybeApplyPressure(now: number = Date.now()): Promise<DebugPressureState> | null {
  const report = sampleServerMemory(now);
  if (!report.overBudget) return null;
  if (now - valve.lastAt < VALVE_INTERVAL_MS) return null;
  return applyMemoryPressure("over-budget", now);
}

/** The last valve run, for a report that explains a drop. */
export function getLastPressureState(): DebugPressureState | null {
  return lastValve;
}
