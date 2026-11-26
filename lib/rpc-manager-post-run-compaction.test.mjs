import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

/**
 * A mock of pi 1.6 `AgentSession` that keeps the ordering the wrapper depends on
 * (`agent-session.js` `_startRun`): `agent_end` fires while the run is still live, the
 * post-run pipeline (`_handlePostAgentRun` → `_checkCompaction` → `_runAutoCompaction`)
 * runs in that window, and `agent_settled` closes it. `state.streaming` is the SDK's
 * `_isAgentRunActive`, `abortCompaction` counts the SDK calls the test is about.
 */
function makeInner(options = {}) {
  const listeners = new Set();
  const sessionId = options.sessionId ?? `sid-${makeInner.counter++}`;
  const state = {
    streaming: false,
    compacting: false,
    bashRunning: false,
    pendingMessages: 0,
    queued: false,
    ...options.state,
  };
  const calls = { abortCompaction: 0, abort: 0, dispose: 0 };
  const inner = {
    sessionId,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    sessionManager: {
      getCwd: () => "/tmp",
      getSessionName: () => "a named session",
      getEntries: () => [],
      getBranch: () => [],
    },
    get isStreaming() { return state.streaming; },
    get isIdle() { return !state.streaming && !state.compacting; },
    get isCompacting() { return state.compacting; },
    get isBashRunning() { return state.bashRunning; },
    get pendingMessageCount() { return state.pendingMessages; },
    agent: { state: {}, hasQueuedMessages: () => state.queued },
    settingsManager: { getDefaultTools: () => [] },
    getAllTools: () => [],
    getActiveToolNames: () => [],
    getContextUsage: () => undefined,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    abortCompaction() { calls.abortCompaction += 1; },
    abortRetry() {},
    abortBranchSummary() {},
    abort: async () => {
      calls.abort += 1;
      inner.emit({ type: "agent_end", messages: [] });
      state.streaming = false;
      inner.emit({ type: "agent_settled" });
    },
    prompt: async () => {},
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() { calls.dispose += 1; },
    emit(event) { for (const listener of [...listeners]) listener(event); },
    state,
    calls,
  };
  return inner;
}

/** The report a completed run ends with: pi's loop only stops on a reply without tool calls. */
function reportRun(text = "the final report") {
  return [
    { role: "user", content: [{ type: "text", text: "do the task" }] },
    { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  ];
}

/** A run that ended on a reply with a tool call: the loop was cut short, not a report. */
function toolRun(text = "let me look") {
  return [
    { role: "user", content: [{ type: "text", text: "do the task" }] },
    { role: "assistant", content: [{ type: "text", text }, { type: "toolCall", id: "t1", name: "read", arguments: {} }], stopReason: "toolUse" },
  ];
}

function runEndedOn(stopReason, extra = {}) {
  return [
    { role: "user", content: [{ type: "text", text: "do the task" }] },
    { role: "assistant", content: [{ type: "text", text: "half an answer" }], stopReason, ...extra },
  ];
}

/**
 * One wrapper with an event log, in a registry of its own so `notifyRunningChange` and the
 * sidebar bookkeeping see only the sessions the test created.
 */
function openWrapper(inner) {
  const wrapper = new AgentSessionWrapper(inner);
  const events = [];
  wrapper.start();
  const off = wrapper.onEvent((event) => events.push(event));
  const previous = globalThis.__piSessions;
  const registry = new Map(globalThis.__piSessions ?? []);
  registry.set(inner.sessionId, wrapper);
  globalThis.__piSessions = registry;
  return {
    wrapper,
    events,
    types: () => events.map((event) => event.type),
    dispose() {
      off();
      wrapper.destroy();
      globalThis.__piSessions = previous;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

// The composer queue lives per session id in a process-wide registry, so each test
// needs its own id: a queue left behind by one test is real work for the next.
makeInner.counter = 1;

/** Start a run, deliver the report, and return to the window pi fires compaction in. */
function finishRun(guard, inner, messages = reportRun()) {
  inner.state.streaming = true;
  inner.emit({ type: "agent_start" });
  inner.emit({ type: "message_start", message: messages[messages.length - 1] });
  inner.emit({ type: "message_end", message: messages[messages.length - 1] });
  inner.emit({ type: "agent_end", messages });
  return guard;
}

test("a run that ends with no compaction at all cancels nothing", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner);
    inner.state.streaming = false;
    inner.emit({ type: "agent_settled" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a session that never compacted must not be touched");
    assert.equal(guard.wrapper.isRunning(), false, "the finished session must be usable again");
  } finally {
    guard.dispose();
  }
});

test("the automatic compaction that opens after the final report is cancelled", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner);
    // The SDK's post-run pipeline, still inside the run: `_runAutoCompaction("threshold")`.
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 1, "the pointless post-run compaction was not cancelled");

    // The page still sees the whole pair, so "Compacting…" ends with the SDK's own event.
    const types = guard.types();
    assert.ok(types.includes("compaction_start"), "the page never learned the compaction started");
    inner.state.compacting = false;
    inner.emit({ type: "compaction_end", reason: "threshold", result: undefined, aborted: true, willRetry: false });
    inner.state.streaming = false;
    inner.emit({ type: "agent_settled" });
    await settle();
    assert.equal(guard.wrapper.isRunning(), false, "the session stayed busy after the cancelled compaction");

    // The prediction is spent: a second compaction in the same window is left alone.
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 1, "the guard fired twice for one run");
  } finally {
    guard.dispose();
  }
});

test("an intermediate assistant message does not cancel a compaction", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    inner.state.streaming = true;
    inner.emit({ type: "agent_start" });
    const intermediate = { role: "assistant", content: [{ type: "text", text: "thinking out loud" }], stopReason: "toolUse" };
    inner.emit({ type: "message_start", message: intermediate });
    inner.emit({ type: "message_end", message: intermediate });
    inner.emit({ type: "message_update", message: intermediate, partial: { content: [] } });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a mid-run assistant message cancelled a compaction");
  } finally {
    guard.dispose();
  }
});

test("a run that ends on a tool call keeps its compaction", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner, toolRun());
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a reply that ends in a tool call is not a delivered report");
  } finally {
    guard.dispose();
  }
});

test("a tool still open when the run reports keeps its compaction", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    inner.state.streaming = true;
    inner.emit({ type: "agent_start" });
    inner.emit({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash" });
    inner.emit({ type: "agent_end", messages: reportRun() });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "compaction was cancelled while a tool was still running");
  } finally {
    guard.dispose();
  }
});

test("cancelling one session's compaction leaves the other sessions alone", async () => {
  const first = makeInner({ sessionId: "sid-a" });
  const second = makeInner({ sessionId: "sid-b" });
  const a = openWrapper(first);
  const b = openWrapper(second);
  try {
    finishRun(a, first);
    // The second session has no finished report of its own; the SDK starts its compaction.
    second.state.streaming = true;
    second.state.compacting = true;
    second.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(second.calls.abortCompaction, 0, "an unrelated session's compaction was cancelled");
    assert.equal(first.calls.abortCompaction, 0, "the other session's event reached this session's guard");

    first.state.compacting = true;
    first.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(first.calls.abortCompaction, 1, "this session's own post-run compaction was not cancelled");
    assert.equal(second.calls.abortCompaction, 0, "the sibling session was cancelled as collateral");
  } finally {
    a.dispose();
    b.dispose();
  }
});

test("a stopped run is not a delivered report", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner, runEndedOn("aborted"));
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a stopped run cancelled a compaction");
  } finally {
    guard.dispose();
  }
});

test("a failed run, and a run the SDK will retry, keep their compaction", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    const messages = runEndedOn("error", { errorMessage: "prompt is too long: 210000 tokens > 200000 maximum" });
    inner.state.streaming = true;
    inner.emit({ type: "agent_start" });
    inner.emit({ type: "agent_end", messages, willRetry: true });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "overflow" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a failed run's recovery compaction was cancelled");

    inner.emit({ type: "compaction_end", reason: "overflow", result: undefined, aborted: false, willRetry: true });
    inner.emit({ type: "agent_settled" });
    inner.state.streaming = false;
    inner.state.compacting = false;
    inner.emit({ type: "agent_start" });
    inner.emit({ type: "agent_end", messages, willRetry: false });
    inner.emit({ type: "compaction_start", reason: "overflow" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a context-overflow failure's compaction was cancelled");
  } finally {
    guard.dispose();
  }
});

test("overflow recovery for a truncated reply is never cancelled", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    // pi's recoverable length stop: compact, then `agent.continue()` finishes the task.
    finishRun(guard, inner, runEndedOn("length"));
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "overflow" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "overflow recovery was cancelled mid-task");
  } finally {
    guard.dispose();
  }
});

test("the user's /compact is never cancelled", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner);
    inner.state.streaming = false;
    inner.emit({ type: "agent_settled" });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "manual" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a manual compaction was cancelled");
  } finally {
    guard.dispose();
  }
});

test("the pre-run compaction of the next prompt is not cancelled", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner);
    inner.state.streaming = false;
    inner.emit({ type: "agent_settled" });
    await settle();

    // The next prompt: `_prepareRun` compacts before sending, inside the new run.
    inner.state.streaming = true;
    inner.emit({ type: "agent_start" });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "the next prompt's own compaction was cancelled");
  } finally {
    guard.dispose();
  }
});

test("a compaction after the run settled is left alone", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner);
    inner.state.streaming = false;
    inner.emit({ type: "agent_settled" });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a compaction outside the answered run was cancelled");
  } finally {
    guard.dispose();
  }
});

test("queued work keeps the compaction that builds its context", async () => {
  for (const queued of [
    { pendingMessages: 1 },
    { queued: true },
  ]) {
    const inner = makeInner({ state: queued });
    const guard = openWrapper(inner);
    try {
      finishRun(guard, inner);
      inner.state.compacting = true;
      inner.emit({ type: "compaction_start", reason: "threshold" });
      await settle();
      assert.equal(inner.calls.abortCompaction, 0, `queued work ${JSON.stringify(queued)} lost its compaction`);
    } finally {
      guard.dispose();
    }
  }

  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner);
    // The composer's next task: it cannot be delivered until the run is over.
    await guard.wrapper.send({ type: "queue_composer", message: "the next task" });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 0, "a queued composer task lost the compaction it needs");
  } finally {
    guard.dispose();
  }
});

test("repeated completion, Stop and teardown stay idempotent", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  const logged = [];
  const realInfo = console.info;
  console.info = (...args) => logged.push(args.join(" "));
  try {
    finishRun(guard, inner);
    inner.emit({ type: "agent_end", messages: reportRun() });
    inner.emit({ type: "agent_end", messages: reportRun() });
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    inner.emit({ type: "compaction_start", reason: "threshold" });
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 1, "one finished run cancelled more than once");
    assert.equal(logged.filter((line) => line.includes("post-run")).length, 1, `compaction log lines: ${logged.join(" | ")}`);
    assert.match(logged.join(" "), new RegExp(inner.sessionId));
    assert.match(logged.join(" "), /threshold/);

    inner.state.compacting = false;
    inner.emit({ type: "compaction_end", reason: "threshold", result: undefined, aborted: true, willRetry: false });
    await guard.wrapper.send({ type: "abort" });
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 1, "Stop left a compaction to be cancelled again");

    guard.wrapper.destroy();
    inner.emit({ type: "compaction_start", reason: "threshold" });
    await settle();
    assert.equal(inner.calls.abortCompaction, 1, "a destroyed wrapper kept cancelling");
  } finally {
    console.info = realInfo;
    guard.dispose();
  }
});

test("the final report survives the cancellation and the session stays usable", async () => {
  const inner = makeInner();
  const guard = openWrapper(inner);
  try {
    finishRun(guard, inner, reportRun("42 files changed, all tests green"));
    inner.state.compacting = true;
    inner.emit({ type: "compaction_start", reason: "threshold" });
    inner.state.compacting = false;
    inner.emit({ type: "compaction_end", reason: "threshold", result: undefined, aborted: true, willRetry: false });
    inner.state.streaming = false;
    inner.emit({ type: "agent_settled" });
    await settle();

    const end = guard.events.find((event) => event.type === "agent_end");
    const report = end.messages[end.messages.length - 1];
    assert.equal(report.role, "assistant");
    assert.equal(report.content[0].text, "42 files changed, all tests green", "the report did not reach the page");
    const endEvent = guard.events.find((event) => event.type === "compaction_end");
    assert.equal(endEvent.aborted, true, "the SDK's aborted compaction_end was not forwarded");
    assert.ok(!guard.types().includes("compaction"), "a compaction summary was invented for the transcript");
    assert.equal(guard.wrapper.getTaskSnapshot().lastRun.outcome.status, "done", "the run was not recorded as completed");

    // Usable: the next prompt starts a run of its own.
    inner.prompt = async () => {
      inner.state.streaming = true;
      inner.emit({ type: "agent_start" });
      inner.emit({ type: "agent_end", messages: reportRun("next answer") });
      inner.state.streaming = false;
      inner.emit({ type: "agent_settled" });
    };
    await guard.wrapper.send({ type: "prompt", message: "and now?" });
    await settle();
    assert.ok(guard.types().filter((type) => type === "agent_start").length >= 2, "the session stopped running runs");
  } finally {
    guard.dispose();
  }
});
