import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(join(tmpdir(), "pi-web-post-run-compaction-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

test.after(() => rm(agentDir, { recursive: true, force: true }));

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const reply = (text) => fauxAssistantMessage([fauxText(text)]);
/**
 * Cancelling at `compaction_start` lands before the summarization request is issued (the SDK's
 * `throwIfAborted()` follows the emit), so a cancelled compaction consumes no faux reply while
 * a compaction that completes consumes one. That is how these tests tell the two apart.
 */
const textOf = (message) => (typeof message.content === "string"
  ? message.content
  : message.content.filter((block) => block.type === "text").map((block) => block.text).join(""));

/**
 * A real pi 1.6 `AgentSession` on the faux provider, with compaction tuned so any completed
 * run crosses the automatic threshold: `_checkCompaction` case 3 → `_runAutoCompaction
 * ("threshold", false)` — the compaction that opens after the final report. Retries are off,
 * so the post-run pipeline reaches compaction instead of retrying an API error.
 */
async function realSession(t) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-post-run-compaction-cwd-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const faux = fauxProvider({ models: [{ id: "faux-post-run", contextWindow: 200_000, maxTokens: 1000 }] });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 199_999, keepRecentTokens: 1 },
    retry: { enabled: false },
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel("faux-post-run"),
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    resourceLoader,
  });
  const settle = async () => {
    for (let i = 0; i < 200 && (session.isIdle === false || session.isCompacting); i += 1) await tick();
  };
  return { session, faux, settle };
}

/** The same session behind pi-web's wrapper, as `POST /api/agent/[id]` puts it. */
async function wrappedSession(t) {
  const { session, faux, settle } = await realSession(t);
  const wrapper = new AgentSessionWrapper(session);
  t.after(() => wrapper.destroy());
  wrapper.start();
  wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  return { session, faux, wrapper, events, settle };
}

const compactionStarts = (events) => events.filter((event) => event.type === "compaction_start");
const compactionEnds = (events) => events.filter((event) => event.type === "compaction_end");
const summaryEntries = (session) => session.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
const assistantTexts = (session) => session.messages.filter((message) => message.role === "assistant").map(textOf);
const userTexts = (session) => session.messages.filter((message) => message.role === "user").map(textOf);

test("the installed SDK exposes the cancellation the wrapper calls", async (t) => {
  const { session } = await realSession(t);
  assert.equal(typeof session.abortCompaction, "function", "AgentSession.abortCompaction() is the SDK's cancellation entry point");
  assert.equal(session.isCompacting, false, "a fresh session reports no compaction");
});

test("the wrapper cancels the SDK compaction that opens after a completed report", async (t) => {
  const { session, faux, wrapper, events, settle } = await wrappedSession(t);
  faux.setResponses([reply("42 files changed, all tests green")]);

  await wrapper.send({ type: "prompt", message: "do the task" });
  await settle();

  assert.deepEqual(compactionStarts(events).map((event) => event.reason), ["threshold"],
    "the SDK did not reach the post-run compaction this test is about");
  const ends = compactionEnds(events);
  assert.equal(ends.length, 1, "the cancelled compaction must still announce its end to the page");
  assert.equal(ends[0].reason, "threshold");
  assert.equal(ends[0].aborted, true, "the post-run compaction was not aborted");
  assert.equal(ends[0].errorMessage, undefined, "an aborted compaction must not read as a failure");

  // The report is intact and no half-written summary entered the transcript.
  assert.deepEqual(assistantTexts(session), ["42 files changed, all tests green"]);
  assert.equal(summaryEntries(session).length, 0, "the aborted compaction appended a summary entry");
  assert.equal(session.isIdle, true, "the session did not return to idle");
  assert.equal(wrapper.isRunning(), false, "the wrapper still reports the session running");

  // The next prompt: the SDK compacts before sending, exactly as it does for an aborted
  // reply. The cancelled summary is deferred, not lost, and the report stays in the file.
  faux.setResponses([reply("the deferred summary"), reply("second answer")]);
  await wrapper.send({ type: "prompt", message: "and now?" });
  await settle();

  assert.deepEqual(compactionStarts(events).map((event) => event.reason), ["threshold", "threshold"],
    "the deferred compaction never ran on the next prompt");
  assert.equal(compactionEnds(events)[1].aborted, false, "the deferred compaction was cancelled too");
  assert.equal(summaryEntries(session).length, 1, "the deferred compaction wrote no summary entry");
  assert.ok(assistantTexts(session).includes("second answer"), "the session stopped answering");
  const persisted = session.sessionManager.getEntries()
    .filter((entry) => entry.type === "message")
    .map((entry) => textOf(entry.message));
  assert.ok(persisted.includes("42 files changed, all tests green"), "the report left the transcript");
  assert.equal(session.isIdle, true);
  assert.equal(wrapper.isRunning(), false);
});

test("without the wrapper the SDK's post-run compaction completes exactly as before", async (t) => {
  const { session, faux, settle } = await realSession(t);
  const events = [];
  session.subscribe((event) => events.push(event));
  // The summary request is a second model call: plain SDK behaviour, untouched.
  faux.setResponses([reply("42 files changed, all tests green"), reply("summary of the work")]);

  await session.prompt("do the task");
  await settle();

  assert.deepEqual(compactionStarts(events).map((event) => event.reason), ["threshold"]);
  const ends = compactionEnds(events);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].aborted, false, "the plain SDK compaction must complete");
  assert.ok(ends[0].result?.summary, "the completed compaction produced its summary");
  assert.equal(summaryEntries(session).length, 1, "the plain SDK compaction wrote no summary entry");
  assert.ok(assistantTexts(session).includes("42 files changed, all tests green"), "the report was lost by plain compaction");
});

test("a queued composer task keeps the SDK's post-run compaction", async (t) => {
  const { session, faux, wrapper, events, settle } = await wrappedSession(t);
  // The report, then the compaction that completes for the queued task; the queued task's own
  // reply, plus a spare summary in case its run reaches the threshold again.
  faux.setResponses([
    reply("the report"),
    reply("summary of the work"),
    reply("answer to the next task"),
    reply("summary of the next work"),
  ]);

  const running = wrapper.send({ type: "prompt", message: "do the task" });
  await wrapper.send({ type: "queue_composer", message: "the next task" });
  await running;
  await settle();

  const ends = compactionEnds(events);
  assert.ok(ends.length >= 1, "no compaction ran for a session with queued work");
  assert.ok(ends.every((event) => event.aborted === false),
    `the compaction that feeds the queued task was cancelled: ${JSON.stringify(ends)}`);
  assert.ok(summaryEntries(session).length >= 1, "the queued-work compaction wrote no summary entry");
  assert.ok(userTexts(session).includes("the next task"), "the queued composer task was never sent");
  assert.ok(assistantTexts(session).includes("answer to the next task"));
});

test("the user's /compact through the wrapper is never cancelled", async (t) => {
  const { session, faux, wrapper, events, settle } = await wrappedSession(t);
  faux.setResponses([reply("the report")]);

  // The run's own compaction is cancelled; the user's is not.
  await wrapper.send({ type: "prompt", message: "do the task" });
  await settle();
  assert.deepEqual(compactionStarts(events).map((event) => event.reason), ["threshold"]);

  faux.setResponses([reply("manual summary")]);
  await wrapper.send({ type: "compact" });
  await settle();

  const ends = compactionEnds(events);
  const manual = ends[ends.length - 1];
  assert.equal(manual.reason, "manual", "the manual compaction did not report itself");
  assert.equal(manual.aborted, false, "the user's /compact was cancelled");
  assert.equal(summaryEntries(session).length, 1, "the manual compaction wrote no summary entry");
  assert.equal(session.isIdle, true);
});

test("real overflow recovery compacts and retries the task; the wrapper keeps its hands off", async (t) => {
  const { session, faux, wrapper, events, settle } = await wrappedSession(t);
  faux.setResponses([
    fauxAssistantMessage([fauxText("cut short")], {
      stopReason: "error",
      errorMessage: "prompt is too long: 210000 tokens > 200000 maximum",
    }),
    // Recovery compacts (one summary reply), the retry answers, and the finished answer's own
    // post-run compaction starts a summarization request before it is cancelled.
    reply("summary of the work"),
    reply("the finished report"),
  ]);

  await wrapper.send({ type: "prompt", message: "do the task" });
  await settle();

  const starts = compactionStarts(events);
  assert.deepEqual(starts.map((event) => event.reason), ["overflow"], "the SDK did not start overflow recovery");
  const ends = compactionEnds(events);
  assert.equal(ends[0].aborted, false, "overflow recovery was cancelled");
  assert.equal(ends[0].willRetry, true, "overflow recovery did not promise the retry");
  assert.equal(summaryEntries(session).length, 1, "overflow recovery wrote no summary entry");
  assert.ok(assistantTexts(session).includes("the finished report"), "the retry after overflow recovery never ran");
  assert.equal(session.isIdle, true);
  assert.equal(wrapper.isRunning(), false);
});
