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

async function main() {
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
