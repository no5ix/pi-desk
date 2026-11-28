#!/usr/bin/env node
// Measure what the server is holding, and what it gives back.
//
// The task this exists for: a dev server at 10.6 GB RSS that stayed at 10.6 GB
// after every session had finished. Nothing in the app measured the process, so
// every fix was a guess. This drives the browsing path of a server that is
// already running — the same GETs a person opening sessions makes — and samples
// the process and the app's own metered view (`GET /api/agent/debug?memory=1`,
// lib/server-memory.ts) the whole time.
//
// It is read-only by construction: `GET /api/sessions/[id]` reads the file
// through the read-only SessionManager cache, and only that route family is
// called. Nothing here opens an event stream, starts a wrapper, sends a prompt,
// or writes a file.
//
//   node scripts/memory-bench.mjs                        # browse the 6 biggest sessions, 3 rounds
//   node scripts/memory-bench.mjs --sessions 12 --rounds 2 --idle 90
//   node scripts/memory-bench.mjs --json > memory.json   # for a chart, or a diff between branches
//
// Read the last block: "given back after idle" is the number the whole task is
// about. A server that ends a round at 1.9 GB and returns to 0.4 GB is a
// different machine from one that stays at 1.9 GB.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const PORT = Number(process.env.PI_WEB_PORT ?? 30141);
const args = process.argv.slice(2);

function flagValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function urlOverride() {
  const index = args.indexOf("--url");
  const value = index === -1 ? undefined : args[index + 1];
  return typeof value === "string" && value.startsWith("http") ? value : undefined;
}

const options = {
  base: (urlOverride() ?? `http://127.0.0.1:${PORT}`).replace(/\/$/, ""),
  sessions: flagValue("sessions", 6),
  rounds: flagValue("rounds", 3),
  idleSeconds: flagValue("idle", 90),
  sampleMs: flagValue("sample", 2_000),
  json: hasFlag("json"),
  wire: hasFlag("wire"),
  calls: flagValue("calls", 120),
};

/** Resident memory of the process serving the port, in bytes, from the OS. */
function serverProcessRss() {
  const pids = spawnSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
  const pid = pids.stdout?.trim().split("\n")[0];
  if (!pid) return { pid: null, rss: 0 };
  const ps = spawnSync("ps", ["-o", "rss=", "-p", pid], { encoding: "utf8" });
  const kb = Number(ps.stdout?.trim());
  return { pid: Number(pid), rss: Number.isFinite(kb) ? kb * 1024 : 0 };
}

function sessionsDir() {
  return process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, "sessions")
    : join(homedir(), ".pi", "agent", "sessions");
}

/** The biggest session files this machine has, newest first within a size class. */
function largestSessions(limit) {
  const root = sessionsDir();
  const rows = [];
  for (const dir of safeReaddir(root)) {
    for (const file of safeReaddir(join(root, dir))) {
      if (!file.endsWith(".jsonl")) continue;
      const path = join(root, dir, file);
      try {
        const stats = statSync(path);
        if (!stats.isFile()) continue;
        rows.push({
          id: basename(file).replace(/\.jsonl$/, "").split("_").slice(1).join("_") || basename(file, ".jsonl"),
          bytes: stats.size,
        });
      } catch {
        // A file that vanished mid-scan is not worth a measurement run ending.
      }
    }
  }
  return rows.sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

function safeReaddir(path) {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

const mb = (bytes) => (bytes / (1024 * 1024)).toFixed(1).padStart(8);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const samples = [];
let phase = "warmup";
let stopped = false;

async function getJson(path, init) {
  const response = await fetch(`${options.base}${path}`, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return response.json();
}

async function sample() {
  while (!stopped) {
    let memory = null;
    try {
      memory = (await getJson("/api/agent/debug?memory=1")).server?.memory ?? null;
    } catch {
      // The server is not answering: the sample row says so, and the run goes on.
    }
    const proc = serverProcessRss();
    samples.push({
      at: Date.now(),
      phase,
      rss: proc.rss || memory?.rss || 0,
      heapUsed: memory?.heapUsed ?? 0,
      heapLimit: memory?.heapLimit ?? 0,
      buckets: Object.fromEntries((memory?.buckets ?? []).map((bucket) => [bucket.name, bucket])),
    });
    await sleep(options.sampleMs);
  }
}

/** The same query a chat view sends when it opens a session. */
async function openSession(id) {
  const params = new URLSearchParams({ deferThinking: "1", deferMedia: "1", tree: "summary", wholeTurns: "1" });
  return getJson(`/api/sessions/${encodeURIComponent(id)}?${params}`);
}

function summarise() {
  const peakRss = Math.max(...samples.map((row) => row.rss));
  const byPhase = new Map();
  for (const row of samples) {
    const entry = byPhase.get(row.phase) ?? { peakRss: 0, peakHeap: 0, peakLive: 0, peakCache: 0 };
    entry.peakRss = Math.max(entry.peakRss, row.rss);
    entry.peakHeap = Math.max(entry.peakHeap, row.heapUsed);
    entry.peakLive = Math.max(entry.peakLive, row.buckets["sessions.live"]?.bytes ?? 0);
    entry.peakCache = Math.max(entry.peakCache, row.buckets["caches.sessionManager"]?.bytes ?? 0);
    byPhase.set(row.phase, entry);
  }
  const last = samples[samples.length - 1];
  const live = last.buckets["sessions.live"];
  const cache = last.buckets["caches.sessionManager"];
  return { peakRss, byPhase, last, live, cache };
}

// ── Phase 8: the live path, measured in this process ──────────────────────────
//
// The server bench above answers "what does the process hold". This answers the
// other half of the memory work: what a run costs the *page* — the bytes that
// cross the event stream, and the state a browser keeps after them. It runs the
// app's own modules (lib/tool-update-delta.ts, lib/deferred-message-content.ts,
// lib/event-payload-limit.ts, lib/chat-lazy-load.ts, lib/content-retention.ts)
// over a synthetic run, so it needs no server, no model and no session file, and
// it compares the shipped path against the path it replaced.
//
//   node scripts/memory-bench.mjs --wire
//   node scripts/memory-bench.mjs --wire --calls 400 --json > wire.json
//
// The columns are bytes on the wire and bytes of page state, which is what the
// phases change; process RSS and heap are the server bench's subject.

/** One tool-heavy run: a shell log that grows, a screenshot per call, and a
 *  long reasoning block per reply — the shape that made tabs unreadable. */
function wireWorkload(calls) {
  const events = [];
  for (let call = 0; call < calls; call += 1) {
    let log = "";
    // A command that prints, in windows of five updates, which is what the
    // stream's coalescing window sees at ~20 updates a second.
    for (let window = 0; window < 5; window += 1) {
      for (let frame = 0; frame < 5; frame += 1) {
        log += `call ${call} window ${window} frame ${frame} ${"x".repeat(400)}\n`;
        events.push({
          type: "tool_execution_update",
          toolCallId: `call-${call}`,
          toolName: "bash",
          partialResult: { content: [{ type: "text", text: log }], details: { fullOutput: log }, isError: false },
        });
      }
      // The stream keeps the newest frame per tool call per window.
      events.push({ type: "__window_flush" });
    }
    events.push({
      type: "message_end",
      entryId: `entry-tool-${call}`,
      message: {
        role: "toolResult",
        toolCallId: `call-${call}`,
        toolName: "bash",
        content: [
          // Every tenth call prints a log big enough to need the per-event
          // budget; a run where nothing is oversize does not test the cap.
          { type: "text", text: `out ${call} ${"o".repeat(call % 10 === 0 ? 3 * 1024 * 1024 : 200 * 1024)}` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "Q".repeat(300 * 1024) } },
        ],
        isError: false,
        timestamp: 1000 + call,
      },
    });
    events.push({
      type: "message_end",
      entryId: `entry-reply-${call}`,
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: `reasoning ${call} ${"r".repeat(60 * 1024)}` },
          { type: "text", text: `reply ${call} ${"a".repeat(1500)}` },
        ],
        model: "bench-model",
        provider: "bench",
        usage: { input: 400, output: 900 },
      },
    });
  }
  return events;
}

/** Ordinary user/assistant rows: a session is mostly these. */
function historyRows(count) {
  return Array.from({ length: Math.max(0, count) }, (_unused, index) => ({
    role: index % 5 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: `history ${index} ${"h".repeat(2000)}` }],
  }));
}

function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

async function wireBenchmark() {
  const jiti = (await import("jiti")).createJiti(import.meta.url);
  const delta = await jiti.import("../lib/tool-update-delta.ts");
  const defer = await jiti.import("../lib/deferred-message-content.ts");
  const limit = await jiti.import("../lib/event-payload-limit.ts");
  const lazy = await jiti.import("../lib/chat-lazy-load.ts");
  const retention = await jiti.import("../lib/content-retention.ts");

  const calls = options.calls ?? 120;
  const events = wireWorkload(calls);

  const configs = [
    { name: "full", delta: false, defer: false, limitBytes: 0 },
    { name: "phases", delta: true, defer: true, limitBytes: limit.MAX_EVENT_PAYLOAD_BYTES },
    { name: "phases-64k", delta: true, defer: true, limitBytes: limit.MIN_EVENT_PAYLOAD_BYTES },
  ];
  const rows = [];

  for (const config of configs) {
    const encoder = config.delta ? delta.createToolUpdateEncoder() : null;
    const states = new Map();
    const messages = [];
    const sizes = [];
    let wireBytes = 0;
    let frames = 0;
    let deltaFrames = 0;
    let deferredFrames = 0;
    let cappedFrames = 0;
    let reconstructFails = 0;

    for (const event of events) {
      if (event.type === "__window_flush") continue;
      let wire = event;
      if (event.type === "tool_execution_update" && encoder) {
        wire = encoder.encode(event);
      } else if (event.type === "message_end" && config.defer) {
        const projected = defer.deferLiveMessageContent(event.message, {
          sessionId: "bench",
          entryId: event.entryId,
        });
        if (projected.deferred.thinkingBlocks > 0 || projected.deferred.imageBlocks > 0) deferredFrames += 1;
        wire = { ...event, entryId: event.entryId, message: projected.message };
      }

      const json = JSON.stringify(wire);
      let onWire = json;
      if (config.limitBytes) {
        const capped = limit.capEventPayloadJson(wire, json, {
          limitBytes: config.limitBytes,
          sessionId: "bench",
          entryId: wire.entryId,
        });
        if (capped) {
          onWire = capped.json;
          cappedFrames += 1;
        }
      }

      sizes.push(onWire.length);
      wireBytes += onWire.length;
      frames += 1;
      if (wire.mode === delta.TOOL_UPDATE_WIRE_DELTA) deltaFrames += 1;

      // The page's side of the same stream: deltas are reconstructed, finished
      // messages are appended to the transcript the component list holds.
      if (event.type === "tool_execution_update") {
        const applied = delta.applyToolUpdateDelta(states.get(event.toolCallId), wire);
        if (config.delta && !applied.ok) reconstructFails += 1;
        delta.rememberToolUpdateState(states, event.toolCallId, applied.state);
      } else if (event.type === "message_end") {
        messages.push(JSON.parse(onWire).message);
      }
    }

    // Phase 6: the loaded window and the thinking cache, over the same run. The
    // window only does something once the transcript is past its cap, so the
    // run is followed by the plain history rows a long session also has.
    const padded = [...historyRows(lazy.MAX_LOADED_MESSAGES + 400 - messages.length), ...messages];
    const ids = padded.map((_message, index) => `entry-${index}`);
    const trimmed = lazy.trimLoadedWindow(padded, ids, { visibleCount: lazy.MAX_LOADED_MESSAGES });
    const windowBytes = trimmed.messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0);

    const cache = new retention.RetainedTextCache();
    let thinkingTotal = 0;
    for (const [index, message] of messages.entries()) {
      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const [blockIndex, block] of blocks.entries()) {
        if (block?.type !== "thinking" || block.deferred) continue;
        const text = String(block.thinking ?? "");
        thinkingTotal += text.length;
        cache.set(`bench:entry-${index}:${blockIndex}`, text, text.length);
      }
    }

    rows.push({
      config: config.name,
      frames,
      wireBytes,
      p50: percentile(sizes.slice().sort((a, b) => a - b), 0.5),
      p95: percentile(sizes.slice().sort((a, b) => a - b), 0.95),
      max: Math.max(...sizes),
      deltaFrames,
      deferredFrames,
      cappedFrames,
      reconstructFails,
      transcriptBytes: messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0),
      windowBytes,
      loadedRows: trimmed.messages.length,
      evicted: trimmed.evicted,
      thinkingTotalChars: thinkingTotal,
      cacheBytes: cache.bytes(),
      cacheEntries: cache.size(),
    });
  }

  const baseline = rows[0];
  const phases = rows[1];
  const result = { calls, events: events.length, rows };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`wire benchmark · ${calls} tool calls · ${events.length} events · `
    + `${(baseline.wireBytes / 1024 / 1024).toFixed(0)} MB on the wire unfixed`);
  console.log("\nconfig        frames   wire MB    p50 KB    p95 KB     max KB   deltas  deferred  capped  state MB  window MB");
  for (const row of rows) {
    console.log(
      `${row.config.padEnd(12)} ${String(row.frames).padStart(7)} ${mb(row.wireBytes)} `
      + `${(row.p50 / 1024).toFixed(1).padStart(9)} ${(row.p95 / 1024).toFixed(1).padStart(9)} ${(row.max / 1024).toFixed(1).padStart(9)} `
      + `${String(row.deltaFrames).padStart(7)} ${String(row.deferredFrames).padStart(9)} ${String(row.cappedFrames).padStart(7)} `
      + `${mb(row.transcriptBytes)} ${mb(row.windowBytes)}`,
    );
  }
  const saved = baseline.wireBytes > 0 ? 1 - phases.wireBytes / baseline.wireBytes : 0;
  console.log(`\nwire: ${mb(baseline.wireBytes)} MB → ${mb(phases.wireBytes)} MB (${Math.round(saved * 100)}% less), `
    + `${phases.cappedFrames} events cut to ${mb(limit.MAX_EVENT_PAYLOAD_BYTES)} MB, `
    + `${phases.deferredFrames} appends projected, ${phases.reconstructFails} deltas refused`);
  console.log(`window: ${(phases.transcriptBytes / 1024 / 1024).toFixed(1)} MB of run rows, `
    + `${(phases.windowBytes / 1024 / 1024).toFixed(1)} MB in the window of ${phases.loadedRows} rows `
    + `(${phases.evicted} rows handed back); thinking cache ${mb(phases.cacheBytes)} MB in `
    + `${phases.cacheEntries} entries, of ${mb(baseline.cacheBytes)} MB unfixed`);
  console.log("\nRead: the `full` row is the path the phases replaced. `state MB` is the serialized size of the");
  console.log("     transcript the page holds, `window MB` what the loaded window keeps after the cap: bytes,");
  console.log("     not heap — the process side is the server bench (`npm run memory:bench`, no --wire).");
}

async function main() {
  if (options.wire) return wireBenchmark();
  const targets = largestSessions(options.sessions);
  if (targets.length === 0) {
    console.error(`No session files under ${sessionsDir()}. Nothing to browse.`);
    process.exit(1);
  }
  const probe = await getJson("/api/agent/debug?memory=1").catch(() => null);
  if (!probe?.server?.memory) {
    console.error(`${options.base} has no metered view. Is this pi-web's server, and is it running this code?`);
    process.exit(1);
  }
  const proc = serverProcessRss();
  console.log(`server on ${options.base} (pid ${proc.pid ?? "?"}) · ${targets.length} sessions · `
    + `${(targets[0].bytes / 1024 / 1024).toFixed(0)} MB down to ${(targets[targets.length - 1].bytes / 1024 / 1024).toFixed(0)} MB`);

  const sampler = sample();
  phase = "baseline";
  await sleep(options.sampleMs);

  for (let round = 1; round <= options.rounds; round += 1) {
    phase = `round ${round}`;
    for (const target of targets) {
      const startedAt = Date.now();
      try {
        await openSession(target.id);
        console.log(`  round ${round} · ${(target.bytes / 1024 / 1024).toFixed(0).padStart(5)} MB session · opened in ${Date.now() - startedAt} ms`);
      } catch (error) {
        console.log(`  round ${round} · ${error.message}`);
      }
      // A switch is not a burst: a person reads, then moves on. The gap is what
      // makes the byte caps' grace periods and the idle timers observable.
      await sleep(1_500);
    }
  }

  phase = "idle";
  console.log(`  all reads done · watching ${options.idleSeconds} s for what comes back`);
  await sleep(options.idleSeconds * 1_000);
  stopped = true;
  await sampler;

  const summary = summarise();
  const idleRss = summary.byPhase.get("idle")?.peakRss ?? 0;
  const finalRss = summary.last.rss;
  const givenBack = idleRss > 0 ? Math.max(0, summary.peakRss - finalRss) : 0;

  if (options.json) {
    console.log(JSON.stringify({
      options,
      samples,
      peakRss: summary.peakRss,
      finalRss,
      givenBackAfterPeak: givenBack,
      byPhase: [...summary.byPhase.entries()],
    }, null, 2));
    return;
  }

  console.log("\nphase            peak RSS    peak heap   live transcripts   SM cache");
  for (const [name, row] of summary.byPhase) {
    console.log(
      `${name.padEnd(14)} ${mb(row.peakRss)} ${mb(row.peakHeap)} ${mb(row.peakLive)} ${mb(row.peakCache)}`,
    );
  }
  console.log(`\npeak RSS ${mb(summary.peakRss)} MB · final ${mb(finalRss)} MB · `
    + `given back after the peak ${mb(givenBack)} MB (${summary.peakRss > 0 ? Math.round((givenBack / summary.peakRss) * 100) : 0}%)`);
  console.log(`heap ceiling in force ${mb(summary.last.heapLimit)} MB · live wrappers ${summary.live?.count ?? 0} `
    + `holding ${mb(summary.live?.bytes ?? 0)} MB · cached views ${summary.cache?.count ?? 0} `
    + `holding ${mb(summary.cache?.bytes ?? 0)} MB`);
  console.log("\nRead: the idle row is the one that matters. A server that keeps its peak is a server whose heap has no ceiling,");
  console.log("     or whose sessions are still warm (PI_WEB_IDLE_TIMEOUT_MS, lib/idle-session-cap.ts).");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
