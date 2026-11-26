import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DEFAULT_COMMAND_TIMEOUT_MS,
} = await jiti.import("./command-timeout.ts");
const {
  agentRunPhase,
  decideAgentRunStall,
  isAgentProgressEvent,
  isStallEligiblePhase,
  resolveLivenessTimeoutMs,
  AGENT_PROGRESS_EVENT_TYPES,
  DEFAULT_RUN_STALL_NOTICE_MS,
  STALL_ELIGIBLE_PHASES,
} = await jiti.import("./agent-run-liveness.ts");

const base = {
  running: true,
  streaming: false,
  promptRunning: false,
  bashRunning: false,
  compacting: false,
  retrying: false,
  runningTools: 0,
  awaitingInput: false,
  waitingForMcp: false,
};

/** A model request in flight: the SDK streams, nothing else is open. */
const modelRequest = { ...base, streaming: true, promptRunning: true };

test("the idle session, a stopped run, has no phase to watch", () => {
  assert.equal(agentRunPhase({ ...base, running: false }), "idle");
  assert.equal(isStallEligiblePhase("idle"), false);
  assert.equal([...STALL_ELIGIBLE_PHASES].includes("idle"), false);
});

test("a model request reports the waiting_model phase, and is the one the watchdog may watch", () => {
  assert.equal(agentRunPhase(modelRequest), "waiting_model");
  assert.equal(isStallEligiblePhase(agentRunPhase(modelRequest)), true);
});

test("the phases whose length is not evidence of a hang are never eligible", () => {
  const cases = [
    // A shell command: bounded by its own timeout (lib/command-timeout.ts).
    ["bash", { ...base, bashRunning: true, streaming: true, promptRunning: true }],
    // A tool — a subagent's `get_subagent_result`, an hour-long test run, a build.
    ["tool", { ...base, streaming: true, promptRunning: true, runningTools: 1 }],
    // A compaction: it announces its own start and end, and its length is its own.
    ["compaction", { ...base, compacting: true, promptRunning: true }],
    // Provider retry backoff: minutes of silence by design, announced at each step.
    ["retry_backoff", { ...base, promptRunning: true, retrying: true }],
    // An unanswered extension dialog: the run is parked on a person.
    ["awaiting_input", { ...base, streaming: true, promptRunning: true, awaitingInput: true }],
  ];
  for (const [phase, flags] of cases) {
    assert.equal(agentRunPhase(flags), phase, `${phase} is the phase these flags describe`);
    assert.equal(isStallEligiblePhase(phase), false, `${phase} must never be stalled`);
    const verdict = decideAgentRunStall(flags, {
      now: 10 * 60 * 60_000,
      lastProgressAt: 0,
      thresholds: { noticeMs: DEFAULT_RUN_STALL_NOTICE_MS, abortMs: 60 * 60_000 },
    });
    assert.equal(verdict.kind, "none", `ten hours of ${phase} is nobody's business`);
  }
});

test("a tool call inside a streaming turn outranks the model phase", () => {
  // The SDK reports streaming for the whole turn, tools included. Reading that as
  // "waiting for model" would put a long command in the phase the watchdog watches.
  assert.equal(agentRunPhase({ ...modelRequest, runningTools: 2 }), "tool");
  assert.equal(agentRunPhase({ ...modelRequest, bashRunning: true, runningTools: 2 }), "bash");
  assert.equal(agentRunPhase({ ...modelRequest, awaitingInput: true, runningTools: 2 }), "awaiting_input");
});

test("the prompt's own phases (MCP connect, extension preflight) are eligible", () => {
  assert.equal(agentRunPhase({ ...base, promptRunning: true, waitingForMcp: true }), "mcp_wait");
  assert.equal(agentRunPhase({ ...base, promptRunning: true }), "prompt_admission");
  assert.equal(isStallEligiblePhase("mcp_wait"), true);
  assert.equal(isStallEligiblePhase("prompt_admission"), true);
});

test("a model request that never answers is noticed, once", () => {
  const thresholds = { noticeMs: 300_000, abortMs: 0 };
  const first = decideAgentRunStall(modelRequest, {
    now: 301_000, lastProgressAt: 1_000, thresholds,
  });
  assert.equal(first.kind, "notice");
  assert.equal(first.phase, "waiting_model");
  assert.equal(first.noProgressMs, 300_000);

  // Every later tick of the same silence says nothing more: the chat gets one notice.
  const later = decideAgentRunStall(modelRequest, {
    now: 900_000, lastProgressAt: 1_000, thresholds, notifiedMs: first.noProgressMs,
  });
  assert.equal(later.kind, "none");
});

test("a run that keeps making progress is never declared stalled, however long it runs", () => {
  const thresholds = { noticeMs: 300_000, abortMs: 600_000 };
  // Three hours of a model streaming, one event every few seconds.
  let lastProgressAt = 0;
  for (let now = 0; now <= 3 * 60 * 60_000; now += 4_000) {
    lastProgressAt = now;
    const verdict = decideAgentRunStall(modelRequest, { now, lastProgressAt, thresholds });
    assert.equal(verdict.kind, "none", `a streaming run was stalled at ${now}ms`);
  }
});

test("an abort is opt-in: with no abort threshold a silent run is only noticed", () => {
  const verdict = decideAgentRunStall(modelRequest, {
    now: 24 * 60 * 60_000, lastProgressAt: 0, thresholds: { noticeMs: 300_000, abortMs: 0 },
    notifiedMs: 300_000,
  });
  assert.equal(verdict.kind, "none", "the default never stops a run the user is watching");
});

test("with an abort threshold configured, the silent run is stopped, and only stopped once", () => {
  const thresholds = { noticeMs: 60_000, abortMs: 600_000 };
  const before = decideAgentRunStall(modelRequest, { now: 599_000, lastProgressAt: 0, thresholds, notifiedMs: 60_000 });
  assert.equal(before.kind, "none", "not before the configured window has fully passed");

  const abort = decideAgentRunStall(modelRequest, { now: 600_000, lastProgressAt: 0, thresholds, notifiedMs: 60_000 });
  assert.equal(abort.kind, "abort");
  assert.equal(abort.noProgressMs, 600_000);

  const again = decideAgentRunStall(modelRequest, { now: 601_000, lastProgressAt: 0, thresholds, notifiedMs: 60_000, aborted: true });
  assert.equal(again.kind, "none", "a second abort is never sent");
});

test("a run that is not running is never stalled, whatever the clock says", () => {
  const verdict = decideAgentRunStall({ ...modelRequest, running: false }, {
    now: 10_000_000, lastProgressAt: 0, thresholds: { noticeMs: 1, abortMs: 2 },
  });
  assert.equal(verdict.kind, "none");
});

test("heartbeats are not progress, and a stream's events are not the run's either", () => {
  // The transport's keep-alive is not an SDK event and must never count.
  assert.equal(isAgentProgressEvent({ type: "heartbeat" }), false);
  // Lifecycle events say a boundary happened, not that work advanced: a run that ended
  // and is waiting on its post-run pipeline is not "making progress".
  assert.equal(isAgentProgressEvent({ type: "agent_start" }), false);
  assert.equal(isAgentProgressEvent({ type: "agent_end" }), false);
  assert.equal(isAgentProgressEvent({ type: "agent_settled" }), false);
  // What does count: the run's own output and announcements.
  for (const type of [
    "message_start", "message_update", "message_end",
    "tool_execution_start", "tool_execution_update", "tool_execution_end",
    "bash_execution_update", "compaction_start", "compaction_end",
    "auto_retry_start", "auto_retry_end", "turn_start", "turn_end",
  ]) {
    assert.equal(isAgentProgressEvent({ type }), true, `${type} is progress`);
    assert.ok(AGENT_PROGRESS_EVENT_TYPES.has(type));
  }
});

test("the notice default is minutes, and the abort default is off", () => {
  assert.equal(DEFAULT_RUN_STALL_NOTICE_MS, 5 * 60_000, "a notice faster than this interrupts honest slow work");
  assert.equal(resolveLivenessTimeoutMs("X", undefined, DEFAULT_RUN_STALL_NOTICE_MS), DEFAULT_RUN_STALL_NOTICE_MS);
  assert.equal(resolveLivenessTimeoutMs("X", "", DEFAULT_RUN_STALL_NOTICE_MS), DEFAULT_RUN_STALL_NOTICE_MS);
  assert.equal(resolveLivenessTimeoutMs("X", "0", DEFAULT_RUN_STALL_NOTICE_MS), 0);
  assert.equal(resolveLivenessTimeoutMs("X", "45000", 1), 45_000);
  // Garbage and out-of-range fall back: a timer over Node's ceiling fires at once.
  assert.equal(resolveLivenessTimeoutMs("X", "abc", 1), 1);
  assert.equal(resolveLivenessTimeoutMs("X", "-5", 1), 1);
  assert.equal(resolveLivenessTimeoutMs("X", "9999999999999", 1), 1);
});

test("the shell command's default bound is far past a hung test and short of a day", () => {
  assert.equal(DEFAULT_COMMAND_TIMEOUT_MS, 30 * 60_000);
});
