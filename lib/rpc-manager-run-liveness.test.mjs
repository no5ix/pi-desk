import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// The wrapper names a session after a finished run when the setting is on; keep that, and
// every settings read, out of ~/.pi.
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-liveness-agent-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { RUN_LIVENESS_TICK_MS } = await jiti.import("./agent-run-liveness.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

/**
 * An SDK session that behaves as pi's does: `prompt()` resolves only after the run's
 * `agent_settled`, `isIdle` spans the post-run pipeline, and `abort()` ends the run with
 * its own `agent_end` / `agent_settled`. A run the model never answers is a `prompt()`
 * that starts streaming and stays there — exactly what the wrapper sees in the field.
 */
function makeInner(options = {}) {
  const listeners = new Set();
  const state = { streaming: false, idle: true };
  const inner = {
    sessionId: "liveness-session",
    sessionFile: "",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    pendingMessageCount: 0,
    model: undefined,
    systemPrompt: "",
    agent: { state: {} },
    extensionRunner: {},
    sessionManager: {
      getCwd: () => process.cwd(),
      getEntries: () => [],
      getBranch: () => [],
      getSessionName: () => "named session",
      isPersisted: () => false,
    },
    settingsManager: { getCacheWarmingMode: () => undefined, getDefaultTools: () => [] },
    steering: [],
    followUp: [],
    getSteeringMessages: () => [...inner.steering],
    getFollowUpMessages: () => [...inner.followUp],
    getContextUsage: () => undefined,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {},
    /** How often the watchdog's stop reached the SDK. */
    abortCalls: 0,
    /** Every `prompt()` call, for the "a recovered session runs again" assertions. */
    prompts: [],
    async abort() {
      inner.abortCalls += 1;
      inner.emit({ type: "agent_end", messages: [] });
      state.streaming = false;
      state.idle = true;
      inner.emit({ type: "agent_settled", aborted: true });
      // pi's `prompt()` settles when the run's signal aborts: a cancelled prompt whose
      // promise stayed outstanding would keep `isRunning()` true forever.
      inner.settlePrompt?.();
    },
    prompt(message, promptOptions) {
      inner.prompts.push(message);
      state.streaming = true;
      state.idle = false;
      inner.emit({ type: "agent_start" });
      promptOptions?.preflightResult?.("started");
      return new Promise((resolve) => {
        // `hang`: every prompt hangs. `hangFirst`: only the first, so a test can watch a
        // run the watchdog stopped and then prove the same session answers the next one.
        const hangs = options.hang === true || (options.hangFirst === true && inner.prompts.length === 1);
        if (hangs) {
          // The provider request never answers: no further event, no resolution — until
          // a Stop aborts the run, which settles it the way the SDK's own signal does.
          inner.settlePrompt = () => resolve();
          return;
        }
        inner.emit({ type: "message_start", message: { role: "assistant", content: [] } });
        inner.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ok" } });
        inner.emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop" } });
        inner.emit({ type: "agent_end", messages: [] });
        state.streaming = false;
        state.idle = true;
        inner.emit({ type: "agent_settled" });
        resolve();
      });
    },
  };
  Object.defineProperty(inner, "isStreaming", {
    get: () => state.streaming,
    configurable: true,
  });
  Object.defineProperty(inner, "isIdle", {
    get: () => state.idle,
    configurable: true,
  });
  inner.emit = (event) => {
    for (const listener of [...listeners]) listener(event);
  };
  /** Settles the outstanding `prompt()`, as the SDK's abort path does. */
  inner.settlePrompt = () => {
    state.streaming = false;
    state.idle = true;
  };
  return inner;
}

/** Start a wrapper, watch its events, and tear it down after the test. */
function watch(inner, t, liveness) {
  const wrapper = new AgentSessionWrapper(inner, liveness ? { liveness } : {});
  const events = [];
  const unsubscribe = wrapper.onEvent((event) => {
    events.push(event);
  });
  wrapper.start();
  t.after(() => {
    unsubscribe();
    wrapper.destroy();
  });
  return {
    wrapper,
    events,
    stalled: () => events.filter((event) => event.type === "agent_stalled"),
    of: (type) => events.filter((event) => event.type === type),
  };
}

test("a prompt that completes normally is never reported as stalled", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });
  const inner = makeInner();
  const seen = watch(inner, t);

  await seen.wrapper.send({ type: "prompt", message: "hi" });
  t.mock.timers.tick(RUN_LIVENESS_TICK_MS * 40);
  await nextTurn();

  assert.equal(seen.stalled().length, 0, "a finished run must not leave a stall behind");
  assert.equal(seen.wrapper.isRunning(), false);
  const state = await seen.wrapper.send({ type: "get_state" });
  assert.equal(state.runLiveness.phase, "idle");
  assert.equal(state.runLiveness.noProgressMs, 0);
  assert.equal(state.runLiveness.stalledMs, 0);
  assert.equal(state.isStreaming, false);
  assert.equal(state.isPromptRunning, false, "the prompt promise settles with the run, so the client can finish");
});

test("a model request that never answers is noticed once, and the state read says so", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 2_000_000 });
  const warn = t.mock.method(console, "warn", () => {});
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 60_000, abortMs: 0 });

  void seen.wrapper.send({ type: "prompt", message: "hi" });
  await nextTurn();

  t.mock.timers.tick(RUN_LIVENESS_TICK_MS);
  assert.equal(seen.stalled().length, 0, "the window has not passed");
  t.mock.timers.tick(RUN_LIVENESS_TICK_MS * 3);
  assert.equal(seen.stalled().length, 1, "one notice once the silence passes the window");
  const notice = seen.stalled()[0];
  assert.equal(notice.phase, "waiting_model");
  assert.ok(notice.noProgressMs >= 60_000);

  // Two hours later, with nothing in between: still the one notice, and the state read
  // carries it, so a reloading page learns the run is stuck without the event.
  t.mock.timers.tick(2 * 60 * RUN_LIVENESS_TICK_MS * 60);
  await nextTurn();
  assert.equal(seen.stalled().length, 1, "the same silence is never announced twice");
  const state = await seen.wrapper.send({ type: "get_state" });
  assert.equal(state.runLiveness.phase, "waiting_model");
  assert.ok(state.runLiveness.stalledMs >= 60_000, "the state read reports the notice the client missed");
  assert.equal(state.isStreaming, true, "the SDK is right: the run is still outstanding");
  assert.ok(warn.mock.calls.length >= 1, "the server log records the stall");
});

test("a run that keeps streaming for hours is never noticed", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 3_000_000 });
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 60_000, abortMs: 120_000 });

  void seen.wrapper.send({ type: "prompt", message: "long task" });
  await nextTurn();

  // Six hours of a model producing output, one event every tick of the watchdog.
  for (let hour = 0; hour < 6; hour += 1) {
    t.mock.timers.tick(RUN_LIVENESS_TICK_MS);
    inner.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "…" } });
    t.mock.timers.tick(RUN_LIVENESS_TICK_MS);
    inner.emit({ type: "tool_execution_start", toolCallId: `c${hour}`, toolName: "bash" });
    inner.emit({ type: "tool_execution_update", toolCallId: `c${hour}`, toolName: "bash", partialResult: {} });
    inner.emit({ type: "tool_execution_end", toolCallId: `c${hour}`, toolName: "bash" });
  }
  await nextTurn();

  assert.equal(seen.stalled().length, 0, "progress is the answer: a run that moves is not stalled");
  assert.equal(inner.abortCalls, 0, "a watchdog must never stop a run that is working");
  assert.equal(seen.wrapper.isRunning(), true);
});

test("a tool call that runs for hours (a subagent's report, a test suite) is left alone", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 4_000_000 });
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 30_000, abortMs: 60_000 });

  void seen.wrapper.send({ type: "prompt", message: "delegate" });
  await nextTurn();
  inner.emit({ type: "tool_execution_start", toolCallId: "sub-1", toolName: "get_subagent_result" });
  await nextTurn();

  t.mock.timers.tick(10 * 60 * 60_000);
  await nextTurn();

  assert.equal(seen.stalled().length, 0, "the length of a tool call is not evidence of a hang");
  assert.equal(inner.abortCalls, 0, "stopping it would cancel the subagent the user asked for");
  const state = await seen.wrapper.send({ type: "get_state" });
  assert.equal(state.runLiveness.phase, "tool");
});

test("an unanswered extension dialog is the user's, not a stall", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 5_000_000 });
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 30_000, abortMs: 60_000 });

  void seen.wrapper.send({ type: "prompt", message: "ask me" });
  await nextTurn();
  // An extension parks the run on a dialog the browser has not answered: the request the
  // SDK's runner would have raised, raised through the same context the wrapper gives it.
  void seen.wrapper.createExtensionUiContext().confirm("Proceed?", "Details");
  await nextTurn();

  t.mock.timers.tick(3 * 60 * 60_000);
  await nextTurn();
  assert.equal(seen.wrapper.isAwaitingInput(), true);
  assert.equal(seen.stalled().length, 0, "a run waiting for a person is not stuck");
  assert.equal(inner.abortCalls, 0);
});

test("with the stop configured, a silent run is stopped once, and the session runs again after", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 6_000_000 });
  t.mock.method(console, "warn", () => {});
  t.mock.method(console, "error", () => {});
  const inner = makeInner({ hangFirst: true });
  const seen = watch(inner, t, { noticeMs: 60_000, abortMs: 300_000 });

  const first = seen.wrapper.send({ type: "prompt", message: "hangs" });
  await nextTurn();
  t.mock.timers.tick(290_000);
  assert.equal(inner.abortCalls, 0, "not before the configured window has passed");
  assert.equal(seen.stalled().length, 1);

  t.mock.timers.tick(30_000);
  await nextTurn();
  assert.equal(inner.abortCalls, 1, "the stop goes to the SDK, whose own events close the run");

  t.mock.timers.tick(600_000);
  await nextTurn();
  assert.equal(inner.abortCalls, 1, "never a second stop for the same run");
  assert.equal(seen.of("agent_end").length, 1, "the SDK's agent_end closes the run; the watchdog invents none");
  assert.equal(seen.of("agent_settled").length, 1, "one settle, so no duplicate completion notification");
  assert.equal(seen.wrapper.isRunning(), false);

  // The point of recovering: the session takes the next prompt the user sends.
  const second = await seen.wrapper.send({ type: "prompt", message: "try again" });
  assert.equal(second, null);
  assert.deepEqual(inner.prompts, ["hangs", "try again"]);
  await first.catch(() => undefined);
  const state = await seen.wrapper.send({ type: "get_state" });
  assert.equal(state.runLiveness.phase, "idle", "the recovered session reports no silence");
  assert.equal(seen.stalled().length, 1, "the new run starts with a clean slate");
});

test("a lost agent_settled still leaves the session idle for the client to reconcile", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 7_000_000 });
  const inner = makeInner();
  const realEmit = inner.emit;
  // The event the browser never receives: the SSE stream dropped at that moment.
  inner.emit = (event) => {
    if (event.type === "agent_settled") return;
    realEmit(event);
  };
  const seen = watch(inner, t, { noticeMs: 60_000, abortMs: 0 });

  await seen.wrapper.send({ type: "prompt", message: "hi" });
  await nextTurn();

  assert.equal(seen.of("agent_settled").length, 0);
  assert.equal(seen.wrapper.isRunning(), false, "the wrapper is idle, so GET /api/agent/[id] says not busy and the client settles");
  assert.equal(seen.wrapper.getRunLiveness().phase, "idle");
  const state = await seen.wrapper.send({ type: "get_state" });
  assert.equal(state.isStreaming, false);
  assert.equal(state.isPromptRunning, false);
});

test("a lost agent_end with the run reported by agent_settled alone still settles", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 8_000_000 });
  const inner = makeInner();
  const realEmit = inner.emit;
  // pi answers a Stop during retry back-off with `agent_settled` and no new `agent_end`.
  inner.emit = (event) => {
    if (event.type === "agent_end") return;
    realEmit(event);
  };
  const seen = watch(inner, t, { noticeMs: 60_000, abortMs: 0 });

  await seen.wrapper.send({ type: "prompt", message: "hi" });
  await nextTurn();

  assert.equal(seen.of("agent_end").length, 0);
  assert.equal(seen.of("agent_settled").length, 1);
  assert.equal(seen.wrapper.isRunning(), false);
  assert.equal(seen.wrapper.getRunLiveness().stalledMs, 0, "the settle closes the clock even with the end missing");
});

test("events that arrive after the run settled cannot revive it, and the next run starts clean", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 9_000_000 });
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 30_000, abortMs: 0 });

  void seen.wrapper.send({ type: "prompt", message: "one" });
  await nextTurn();
  inner.emit({ type: "tool_execution_start", toolCallId: "late-1", toolName: "bash" });
  // Stop, as the browser's Stop: the SDK aborts and the run settles.
  await seen.wrapper.send({ type: "abort" });
  await nextTurn();
  assert.equal(seen.wrapper.isRunning(), false);

  // The buffered tail of the dead run arrives late.
  inner.emit({ type: "tool_execution_end", toolCallId: "late-1", toolName: "bash" });
  inner.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "stale" } });
  t.mock.timers.tick(60 * 60_000);
  await nextTurn();

  assert.equal(seen.wrapper.getDebugSnapshot().run.runningTools, 0, "a late end cannot leave a tool counted as running");
  assert.equal(seen.stalled().length, 0, "an idle session is never announced as stalled");
  assert.equal(seen.wrapper.getRunLiveness().phase, "idle");

  // And the next run gets its own clock: the previous run's stall must not carry into it.
  void seen.wrapper.send({ type: "prompt", message: "two" });
  await nextTurn();
  t.mock.timers.tick(45_000);
  assert.equal(seen.stalled().length, 1, "the new run is noticed on its own silence, exactly once");
  assert.equal(seen.stalled()[0].noProgressMs >= 30_000, true);
});

test("Stop while a model request is pending reaches the SDK and clears the run", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 10_000_000 });
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 60_000, abortMs: 0 });

  void seen.wrapper.send({ type: "prompt", message: "cancel me" });
  await nextTurn();
  await seen.wrapper.send({ type: "abort" });
  await nextTurn();

  assert.equal(inner.abortCalls, 1, "the cancellation reaches the SDK, whose signal ends the provider request");
  assert.equal(seen.wrapper.isRunning(), false);
  assert.equal(seen.wrapper.getRunLiveness().phase, "idle");
  const state = await seen.wrapper.send({ type: "get_state" });
  assert.equal(state.isStreaming, false);
});

test("a compaction that produces nothing is left to finish, and the run continues after it", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 11_000_000 });
  const inner = makeInner({ hang: true });
  const seen = watch(inner, t, { noticeMs: 30_000, abortMs: 60_000 });

  void seen.wrapper.send({ type: "prompt", message: "compact me" });
  await nextTurn();
  inner.emit({ type: "compaction_start", reason: "threshold" });
  inner.isCompacting = true;
  await nextTurn();

  t.mock.timers.tick(40 * 60_000);
  await nextTurn();
  assert.equal(seen.stalled().length, 0, "a compaction's length is its own");
  assert.equal(inner.abortCalls, 0, "stopping it would end the run the user is compacting");
  assert.equal((await seen.wrapper.send({ type: "get_state" })).runLiveness.phase, "compaction");

  // It finishes: the clock is live again for the model request that follows.
  inner.isCompacting = false;
  inner.emit({ type: "compaction_end", reason: "threshold" });
  t.mock.timers.tick(45_000);
  await nextTurn();
  assert.equal(seen.stalled().length, 1, "the model request after it is noticed on its own silence");
  assert.equal(seen.stalled()[0].phase, "waiting_model");
});
