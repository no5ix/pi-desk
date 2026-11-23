import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createSubagentController, runResultText, getSessionIdsWithUnsettledSubagentRuns, hasUnsettledSubagentRun, subagentDebugSnapshot } = await jiti.import("./subagent-runtime.ts");
const { peekSubagentReportRuns, takeSubagentReportRun } = await jiti.import("./subagent-report-runs.ts");
const { SUBAGENT_NOTIFICATION_PREFIX, subagentFinalText, subagentNotificationText } = await jiti.import("./subagent-extension.ts");

function completedRun() {
  return {
    sessionId: "child-session",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Inspect parser",
    task: "Find the parser",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  };
}

test("completion notification reopens an idle parent and uses its current session", async () => {
  const delivered = [];
  const reopened = [];
  let ready = false;
  let parent;
  const liveParent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => { ready = true; },
    inner: {
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async (sessionId, sessionFile) => {
      reopened.push([sessionId, sessionFile]);
      parent = liveParent;
      return liveParent;
    },
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });

  await controller.extensionRuntime.notifyParent(completedRun());

  assert.deepEqual(reopened, [["parent-session", "/tmp/parent.jsonl"]]);
  assert.equal(ready, true);
  assert.equal(delivered.length, 1);
  assert.equal(
    delivered[0].message.content,
    `${SUBAGENT_NOTIFICATION_PREFIX}Subagent child-session completed.\n\nParser found`,
  );
  // Compaction reads custom messages as user turns, so the report must announce that it is not one (#875).
  assert.match(delivered[0].message.content, /^The following is a background subagent's report/);
  assert.equal(delivered[0].message.details.sessionId, "child-session");
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("disabled built-in subagents reject stale Agent calls before starting", async () => {
  const controller = createSubagentController({
    getSession: () => { throw new Error("must not inspect a parent"); },
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => false,
  });

  await assert.rejects(
    controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Inspect",
      description: "Inspect",
    }),
    /built-in sub-agents are disabled/,
  );
});

function makeDirectTurnChild(lastEntry) {
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "Inspect parser",
      task: "old task",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    lastEntry,
  ];
  const child = {
    inner: {
      sessionId: "child",
      sessionFile: "/tmp/child.jsonl",
      sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
      getLastAssistantText: () => "direct reply",
    },
    sessionFile: "/tmp/child.jsonl",
    cwd: tmpdir(),
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
  };
  const reopened = [];
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : undefined,
    registerSession: () => {},
    reopenSession: async (id) => { reopened.push(id); return child; },
    resolveSessionPath: async () => "/tmp/child.jsonl",
    invalidateSessionList: () => {},
  });
  return { controller, entries, reopened };
}

test("a turn in the chat of a child a restart cut off settles its run and leaves the parent asleep", async () => {
  const running = { type: "custom", customType: "pi-web:subagent-status", data: { version: 1, status: "running" } };
  const { controller, entries, reopened } = makeDirectTurnChild(running);
  assert.equal((await controller.get("child"))?.status, "interrupted");

  controller.settleDirectTurn("child", false);
  const settled = await controller.get("child");
  assert.equal(settled?.status, "completed");
  assert.equal(settled?.result, "direct reply");
  assert.deepEqual(reopened, [], "the parent's model is not woken");

  // Settled now, so a later turn leaves its report alone.
  const count = entries.length;
  controller.settleDirectTurn("child", false);
  assert.equal(entries.length, count);
});

test("a stopped turn in a cut-off child's chat reads as aborted", async () => {
  const running = { type: "custom", customType: "pi-web:subagent-status", data: { version: 1, status: "running" } };
  const { controller } = makeDirectTurnChild(running);
  controller.settleDirectTurn("child", true);
  assert.equal((await controller.get("child"))?.status, "aborted");
});

test("talking to a finished child keeps its report", async () => {
  const finished = { type: "custom", customType: "pi-web:subagent-result", data: { version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "ORIGINAL REPORT" } };
  const { controller, entries } = makeDirectTurnChild(finished);
  const count = entries.length;
  controller.settleDirectTurn("child", false);
  assert.equal(entries.length, count);
  assert.equal((await controller.get("child"))?.result, "ORIGINAL REPORT");
});

test("resume reuses the persisted child session and keeps its session id", async () => {
  const calls = [];
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt: async (task) => { calls.push(task); },
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "child",
    task: "continue this",
    description: "Continue task",
  });
  const result = await execution.completion;
  assert.equal(execution.run.sessionId, "child");
  assert.equal(result.sessionId, "child");
  assert.equal(result.status, "completed");
  assert.deepEqual(calls, ["continue this"]);
  // The resumed run's notification must be distinguishable from the first run's (#985).
  assert.equal(result.resumed, true);
  assert.equal(execution.run.resumed, true);
});

for (const [label, live] of [["a live child", true], ["a reopened child", false]]) {
  test(`resume refuses ${label} whose worktree is gone, as a prompt sent to it does (#1202)`, async (t) => {
    // An isolated child's worktree is removed when its run ends.
    const worktree = await mkdtemp(join(tmpdir(), "pi-web-removed-worktree-"));
    await rm(worktree, { recursive: true });
    const calls = [];
    const entries = [
      { type: "custom", customType: "pi-web:subagent", data: {
        version: 1,
        parentSessionId: "parent",
        parentSessionPath: "/tmp/parent.jsonl",
        parentToolCallId: "old-call",
        profile: "general-purpose",
        description: "old task",
        task: "old",
        runInBackground: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
        worktreePath: worktree,
        worktreeBranch: "pi-web-agent-test",
      } },
      { type: "custom", customType: "pi-web:subagent-result", data: {
        version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
      } },
    ];
    // A released child is read back from its session file, and reopened from it.
    const sessions = await mkdtemp(join(tmpdir(), "pi-web-removed-worktree-sessions-"));
    t.after(() => rm(sessions, { recursive: true, force: true }));
    const sessionFile = join(sessions, "child.jsonl");
    await writeFile(sessionFile, [
      { type: "session", version: 3, id: "child", timestamp: "2026-01-01T00:00:00.000Z", cwd: worktree },
      ...entries.map((entry, index) => ({ ...entry, id: `e${index}`, parentId: index ? `e${index - 1}` : null, timestamp: "2026-01-01T00:00:00.000Z" })),
    ].map((line) => JSON.stringify(line)).join("\n") + "\n");
    const childInner = {
      sessionId: "child",
      sessionFile,
      sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
      prompt: async (task) => { calls.push(task); },
      getLastAssistantText: () => "new result",
      abort: async () => {},
    };
    const child = { inner: childInner, sessionFile, cwd: worktree, isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
    const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
    let reopened = 0;
    const controller = createSubagentController({
      getSession: (id) => id === "child" ? (live ? child : undefined) : parent,
      registerSession: () => {},
      reopenSession: async () => { reopened += 1; return child; },
      resolveSessionPath: async () => child.sessionFile,
      invalidateSessionList: () => {},
      isBuiltInSubagentsEnabled: () => true,
    });
    await assert.rejects(controller.extensionRuntime.resume({
      parentContext: parent.inner,
      parentToolCallId: "new-call",
      sessionId: "child",
      task: "continue this",
      description: "Continue task",
    }), { message: `Directory does not exist: ${worktree}. Start a new subagent instead.` });
    assert.equal(reopened, live ? 0 : 1);
    assert.deepEqual(calls, []);
    // Nothing was queued or recorded: the child still reads as its earlier, completed run.
    assert.equal(entries.length, 2);
    assert.equal((await controller.extensionRuntime.get("child")).status, "completed");
  });
}

/** A live isolated child whose session ends with `lifecycle`, resumed with `prompt` as its run. */
function resumeIsolatedChild(worktree, lifecycle, prompt = async () => {}) {
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "general-purpose",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
      worktreePath: worktree,
      worktreeBranch: "pi-web-agent-test",
    } },
    lifecycle,
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt,
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: worktree, isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  return {
    entries,
    before: () => controller.extensionRuntime.get("child"),
    resume: async () => (await controller.extensionRuntime.resume({
      parentContext: parent.inner,
      parentToolCallId: "new-call",
      sessionId: "child",
      task: "continue this",
      description: "Continue task",
    })).completion,
  };
}

/** The child as `get()` reads it from its session file once its wrapper is gone. */
async function readBackFromFile(t, cwd, entries) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-subagent-read-back-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const sessionFile = join(dir, "child.jsonl");
  await writeFile(sessionFile, [
    { type: "session", version: 3, id: "child", timestamp: "2026-01-01T00:00:00.000Z", cwd },
    ...entries.map((entry, index) => ({ ...entry, id: `e${index}`, parentId: index ? `e${index - 1}` : null, timestamp: "2026-01-01T00:00:00.000Z" })),
  ].map((line) => JSON.stringify(line)).join("\n") + "\n");
  return createSubagentController({
    getSession: () => undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => sessionFile,
    invalidateSessionList: () => {},
  }).extensionRuntime.get("child");
}

test("a resumed isolated child is told its worktree is still there, never that it was removed (#1202)", async (t) => {
  const worktree = await mkdtemp(join(tmpdir(), "pi-web-kept-worktree-"));
  t.after(() => rm(worktree, { recursive: true, force: true }));
  const earlier = [
    // The process stopped mid-run: nothing removed the worktree, and no result was recorded.
    ["an interrupted run", "interrupted", { type: "custom", customType: "pi-web:subagent-status", data: { version: 1, status: "running" } }],
    // The earlier run's removal was refused; that refusal's reason is not this run's.
    ["a run that kept it", "completed", { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result", worktreeExists: true,
      worktreeCleanupError: `Worktree retained at ${worktree}: fatal: '${worktree}' contains modified or untracked files, use --force to delete it`,
    } }],
  ];
  for (const [label, status, lifecycle] of earlier) {
    await t.test(`after ${label}`, async (t) => {
      const child = resumeIsolatedChild(worktree, lifecycle);
      assert.equal((await child.before()).status, status);
      const result = await child.resume();
      const text = subagentFinalText(result);
      assert.equal(text, `Subagent child completed.\n\nIts worktree is still at ${worktree} (branch pi-web-agent-test).\n\nnew result`);
      assert.deepEqual(child.entries.at(-1).data, { version: 1, status: "completed", completedAt: result.completedAt, result: "new result", worktreeExists: true });
      assert.equal(subagentFinalText(await readBackFromFile(t, worktree, child.entries)), text);
    });
  }
});

test("a worktree removed during a resumed run is reported removed, live and read back (#1202)", async (t) => {
  const worktree = await mkdtemp(join(tmpdir(), "pi-web-removed-during-run-"));
  t.after(() => rm(worktree, { recursive: true, force: true }));
  const child = resumeIsolatedChild(worktree, { type: "custom", customType: "pi-web:subagent-result", data: {
    version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result", worktreeExists: true,
  } }, () => rm(worktree, { recursive: true }));
  const result = await child.resume();
  const text = subagentFinalText(result);
  assert.equal(text, "Subagent child completed.\n\nIts worktree was removed; branch pi-web-agent-test keeps any commits it made.\n\nnew result");
  assert.equal(child.entries.at(-1).data.worktreeExists, false);
  assert.equal(subagentFinalText(await readBackFromFile(t, worktree, child.entries)), text);
});

test("a run collected and resumed in the same turn keeps its held notification suppressed", async () => {
  const delivered = [];
  let parentRunning = true;
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result",
    } },
  ];
  let finishResumed;
  const childInner = {
    sessionId: "collect-and-resume-child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    prompt: () => new Promise((resolve) => { finishResumed = resolve; }),
    getLastAssistantText: () => "new result",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = {
    inner: {
      sessionManager: { getSessionId: () => "parent" },
      isStreaming: true,
      steeringMode: "all",
      agent: { steeringMode: "all", hasQueuedMessages: () => false, state: { streamingMessage: {} } },
      subscribe: () => () => {},
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    sessionFile: "/tmp/parent.jsonl",
    cwd: "/tmp",
    isAlive: () => true,
    isRunning: () => parentRunning,
    waitUntilReady: async () => {},
  };
  const controller = createSubagentController({
    getSession: (id) => id === "collect-and-resume-child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const first = await controller.extensionRuntime.get("collect-and-resume-child");

  // Run 1's notification is held while the parent turn runs; in that turn the parent
  // collects run 1 with get_subagent_result and immediately resumes the same child.
  const heldFirst = controller.extensionRuntime.notifyParent(first);
  await new Promise((resolve) => setTimeout(resolve, 250));
  controller.extensionRuntime.markResultConsumed(first);
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "collect-and-resume-child",
    task: "continue this",
    description: "Continue task",
  });
  parentRunning = false;
  await heldFirst;
  assert.equal(delivered.length, 0, "run 1 was already collected; delivering it again is the #889 duplicate");

  // The resumed run finishes later and is notified: the earlier mark names run 1, not this run.
  finishResumed();
  const second = await execution.completion;
  assert.notEqual(second.completedAt, first.completedAt);
  await controller.extensionRuntime.notifyParent(second);
  assert.equal(delivered.length, 1);
});

test("a resumed run that fails right away still notifies after the parent inspected the earlier failure (#987)", async () => {
  const delivered = [];
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "stream disconnected" } },
    { type: "custom", customType: "pi-web:subagent-result", data: {
      version: 1, status: "failed", completedAt: "2026-01-01T00:01:00.000Z", error: "stream disconnected",
    } },
  ];
  const childInner = {
    sessionId: "failed-resume-child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    // The resumed run is rejected by the provider at once; pi records that as an errored assistant message.
    prompt: async () => {
      entries.push({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "400 Bad Request" } });
    },
    getLastAssistantText: () => undefined,
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = {
    inner: {
      sessionManager: { getSessionId: () => "parent" },
      isStreaming: false,
      steeringMode: "all",
      agent: { steeringMode: "all", hasQueuedMessages: () => false, state: { streamingMessage: {} } },
      subscribe: () => () => {},
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    sessionFile: "/tmp/parent.jsonl",
    cwd: "/tmp",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
  };
  const controller = createSubagentController({
    getSession: (id) => id === "failed-resume-child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });

  // Run 1's failure is delivered, then the parent inspects it with get_subagent_result before retrying.
  const first = await controller.extensionRuntime.get("failed-resume-child");
  await controller.extensionRuntime.notifyParent(first);
  controller.extensionRuntime.markResultConsumed(first);

  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "retry-call",
    sessionId: "failed-resume-child",
    task: "retry with the fix",
    description: "Retry",
  });
  const second = await execution.completion;
  assert.equal(second.status, "failed");
  await controller.extensionRuntime.notifyParent(second);

  assert.equal(delivered.length, 2, "the retry's failure must reach the parent, or it waits forever");
  assert.match(delivered[1].message.content, /Subagent failed-resume-child failed: 400 Bad Request/);
  assert.deepEqual(delivered[1].options, { deliverAs: "followUp", triggerTurn: true });
});

test("resume rejects a child owned by another parent", async () => {
  const controller = createSubagentController({
    getSession: (id) => id === "parent" ? { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} } : undefined,
    registerSession: () => {},
    reopenSession: async () => { throw new Error("unused"); },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  await assert.rejects(controller.extensionRuntime.resume({
    parentContext: { sessionManager: { getSessionId: () => "parent" } },
    parentToolCallId: "call",
    sessionId: "missing",
    task: "continue",
    description: "Continue",
  }), /Subagent not found/);
});

test("a run whose last assistant message ended with a provider error is reported as failed, not completed", async () => {
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "builder",
      description: "old task",
      task: "old",
      runInBackground: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: { version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z" } },
  ];
  const childInner = {
    sessionId: "child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    // pi's agent loop records a provider stream error as an assistant message and resolves prompt() normally.
    prompt: async () => {
      entries.push({ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "t1", name: "edit", arguments: {} }], stopReason: "error", errorMessage: "stream error: stream disconnected before completion" } });
    },
    getLastAssistantText: () => undefined,
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === "child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: "child",
    task: "continue this",
    description: "Continue task",
  });
  const result = await execution.completion;
  assert.equal(result.status, "failed");
  assert.match(result.error, /stream disconnected/);
  const persisted = entries.at(-1);
  assert.equal(persisted.customType, "pi-web:subagent-result");
  assert.equal(persisted.data.status, "failed");
  assert.match(persisted.data.error, /stream disconnected/);
});

function orphanedEntries(status) {
  return [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "call",
      profile: "explore",
      description: "Find parser",
      task: "Find the parser",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    } },
    { type: "custom", customType: "pi-web:subagent-status", data: { version: 1, status } },
  ];
}

function orphanController(child) {
  return createSubagentController({
    getSession: () => child,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => undefined,
    invalidateSessionList: () => {},
  });
}

test("a live child left with a running status but no active run reads as interrupted", async () => {
  for (const status of ["running", "queued"]) {
    const entries = orphanedEntries(status);
    const child = {
      inner: { sessionManager: { getEntries: () => entries } },
      sessionFile: "/tmp/child.jsonl",
      isAlive: () => true,
      isRunning: () => false,
    };

    const run = await orphanController(child).extensionRuntime.get("orphan-child");

    assert.equal(run.status, "interrupted", `persisted ${status} without a result`);
  }
});

test("a child whose wrapper is still running keeps reporting running", async () => {
  const entries = orphanedEntries("running");
  const child = {
    inner: { sessionManager: { getEntries: () => entries } },
    sessionFile: "/tmp/child.jsonl",
    isAlive: () => true,
    isRunning: () => true,
  };

  const run = await orphanController(child).extensionRuntime.get("orphan-child");

  assert.equal(run.status, "running");
});

test("a child session read back from disk after a restart mid-run reads as interrupted", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-orphaned-subagent-"));
  try {
    const sessionPath = join(dir, "child.jsonl");
    const header = { type: "session", version: 3, id: "orphan-child", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir, parentSession: "/tmp/parent.jsonl" };
    const lines = [header, ...orphanedEntries("running").map((entry, index) => ({
      ...entry,
      id: `e${index}`,
      parentId: index === 0 ? null : `e${index - 1}`,
      timestamp: "2026-01-01T00:00:00.000Z",
    }))];
    await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
    const controller = createSubagentController({
      getSession: () => undefined,
      registerSession: () => {},
      reopenSession: async () => { throw new Error("unused"); },
      resolveSessionPath: async () => sessionPath,
      invalidateSessionList: () => {},
    });

    const run = await controller.extensionRuntime.get("orphan-child");

    assert.equal(run.status, "interrupted");
    assert.equal(run.completedAt, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function idleParentDependencies(delivered, overrides = {}) {
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
    inner: {
      // A parent not streaming: `steerIntoRun()` never sees a turn, so the delivery goes the
      // idle-parent way. The SDK session always has `subscribe`; a fake that omits it is not a parent.
      isStreaming: false,
      steeringMode: "all",
      agent: { steeringMode: "all", hasQueuedMessages: () => false, state: { streamingMessage: {} } },
      _listeners: [],
      subscribe(listener) {
        parent.inner._listeners.push(listener);
        return () => {
          const at = parent.inner._listeners.indexOf(listener);
          if (at >= 0) parent.inner._listeners.splice(at, 1);
        };
      },
      sendCustomMessage: async (message, options) => delivered.push({ message, options }),
    },
    ...overrides,
  };
  return {
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  };
}

/**
 * A parent whose run is going: `isStreaming` stands for the SDK run, so the fake stops running
 * the moment the report is steered into it, as a real run does at its last turn.
 *
 * `queued` stands for input typed in the parent's chat, `state` for the run's state, `signal` for
 * Stop, and `turnsUsed` for a parent that is itself a subagent that used its turns. All of them
 * refuse the steer, and the report then wakes the parent as a follow-up, as it always did.
 */
function runningParent(sent, { streaming = true, queued = false, state = { streamingMessage: {} }, signal, turnsUsed, rejectSteer = false } = {}) {
  const inner = {
    isStreaming: streaming,
    steeringMode: "all",
    agent: {
      steeringMode: "all",
      hasQueuedMessages: () => queued,
      state,
      ...(signal ? { signal } : {}),
    },
    _listeners: [],
    subscribe(listener) {
      inner._listeners.push(listener);
      return () => {
        const at = inner._listeners.indexOf(listener);
        if (at >= 0) inner._listeners.splice(at, 1);
      };
    },
    emit(event) {
      for (const listener of [...inner._listeners]) listener(event);
    },
    sendCustomMessage: async (message, options) => {
      sent.push({ message, options });
      if (rejectSteer && options?.deliverAs === "steer") throw new Error("steer refused");
      if (options?.deliverAs === "steer") {
        // pi appends a steer to the transcript when the next model request takes it, and only
        // that message event proves the parent's context has the report.
        inner.emit({ type: "message_end", message: { role: "custom", customType: message.customType, details: message.details } });
      }
    },
  };
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => inner.isStreaming,
    waitUntilReady: async () => {},
    inner,
    ...(turnsUsed ? { turnsUsed: true } : {}),
  };
  return parent;
}

function parentDependencies(parent) {
  return {
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  };
}

/** A turn the parent's run ends with, after its tool batch. */
const TURN_END = { type: "turn_end", message: { role: "assistant", stopReason: "end_turn" }, toolResults: [] };

/** Let a delivery reach the parent's event stream, so a turn the fake emits is seen by it. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

test("a running parent takes the report into its own run as a steer (#1727)", async () => {
  const sent = [];
  const parent = runningParent(sent);
  const controller = createSubagentController(parentDependencies(parent));
  const run = { ...completedRun(), sessionId: "steered-child" };

  const notifying = controller.extensionRuntime.notifyParent(run);
  await settled();
  parent.inner.emit(TURN_END);
  await notifying;

  assert.equal(sent.length, 1, "the report joins the run that is going and starts no other");
  assert.equal(sent[0].options.deliverAs, "steer");
  assert.equal(sent[0].options.triggerTurn, undefined);
  // It stays the report card, named for this very run, not a bare steer text the composer recalls.
  assert.equal(sent[0].message.customType, "pi-web:subagent-notification");
  assert.equal(sent[0].message.display, true);
  assert.equal(sent[0].message.details.sessionId, "steered-child");
  assert.equal(sent[0].message.details.completedAt, run.completedAt);
  assert.ok(sent[0].message.content.includes("Subagent steered-child completed."));
});


test("a steered report marks no report-driven run, so the parent's own run announces (#1727)", async () => {
  const sent = [];
  const parent = runningParent(sent);
  const controller = createSubagentController(parentDependencies(parent));
  const markedBefore = peekSubagentReportRuns();

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  await settled();
  parent.inner.emit(TURN_END);
  await notifying;

  assert.equal(sent[0].options.deliverAs, "steer");
  assert.deepEqual(peekSubagentReportRuns(), markedBefore, "a report that starts no run marks no run");
});


test("a report the parent wakes for is marked, as its run exists because of the report (#1434)", async () => {
  const sent = [];
  const parent = runningParent(sent, { queued: true });
  const controller = createSubagentController(parentDependencies(parent));

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  await settled();
  parent.inner.emit(TURN_END);
  parent.inner.isStreaming = false;
  await notifying;

  assert.deepEqual(sent.map((entry) => entry.options.deliverAs), ["followUp"]);
  assert.ok(peekSubagentReportRuns().includes("parent-session"), "the run the report starts announces nothing");
  // Drain every mark this file's deliveries left, so none leaks into the next test.
  for (const parentId of peekSubagentReportRuns()) takeSubagentReportRun(parentId);
});

test("a steer is refused where an earlier queued input goes first: the parent reads its own text (#1727)", async () => {
  const sent = [];
  // In `one-at-a-time` steering an earlier queued input goes first, so the report waits for a
  // turn whose queue is empty; the parent reads what its user typed, and the report wakes it.
  const parent = runningParent(sent, { queued: true });
  const controller = createSubagentController(parentDependencies(parent));

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  await settled();
  parent.inner.emit(TURN_END);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 0, "the report waits for a turn whose queue is empty");

  parent.inner.isStreaming = false;
  await notifying;
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("a steer is refused after Stop aborted the parent's run, and after a turn that ends it (#1727)", async () => {
  for (const turn of [
    { type: "turn_end", message: { role: "assistant", stopReason: "error" }, toolResults: [] },
    { type: "turn_end", message: { role: "assistant", stopReason: "aborted" }, toolResults: [] },
  ]) {
    const sent = [];
    const parent = runningParent(sent);
    const controller = createSubagentController(parentDependencies(parent));

    const notifying = controller.extensionRuntime.notifyParent(completedRun());
    await settled();
    parent.inner.emit(turn);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent.length, 0, `a ${turn.message.stopReason} turn ends the run: a steer there asks for one the parent did not ask for`);

    parent.inner.isStreaming = false;
    await notifying;
    assert.deepEqual(sent.map((entry) => entry.options.deliverAs), ["followUp"]);
  }

  const sent = [];
  const parent = runningParent(sent, { signal: { aborted: true } });
  const controller = createSubagentController(parentDependencies(parent));

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  await settled();
  parent.inner.emit(TURN_END);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.length, 0, "Stop ended the run: nothing takes a steer after it");

  parent.inner.isStreaming = false;
  await notifying;
  assert.deepEqual(sent.map((entry) => entry.options.deliverAs), ["followUp"]);
});

test("a report is never steered into a subagent that used its turns (#1727)", async () => {
  const previous = globalThis.__piSubagentRuns;
  try {
    globalThis.__piSubagentRuns = new Map([["parent-session", { turnLimitReached: false, turnsUsed: true }]]);
    const sent = [];
    const parent = runningParent(sent);
    const controller = createSubagentController(parentDependencies(parent));

    const notifying = controller.extensionRuntime.notifyParent(completedRun());
    await settled();
    parent.inner.emit(TURN_END);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(sent.length, 0, "a steer there would start a turn past the limit");

    parent.inner.isStreaming = false;
    await notifying;
    assert.deepEqual(sent.map((entry) => entry.options.deliverAs), ["followUp"]);
  } finally {
    globalThis.__piSubagentRuns = previous;
  }
});

test("a parent that collects the result before the steer lands is never told twice (#1727)", async () => {
  const sent = [];
  const parent = runningParent(sent);
  const controller = createSubagentController(parentDependencies(parent));
  const run = { ...completedRun(), sessionId: "collected-while-running" };

  const notifying = controller.extensionRuntime.notifyParent(run);
  await new Promise((resolve) => setImmediate(resolve));
  // The `get_subagent_result` call of the current tool batch returns, and marks the result.
  controller.extensionRuntime.markResultConsumed(run);
  await settled();
  parent.inner.emit(TURN_END);
  await notifying;

  assert.equal(sent.length, 0, "the report is dropped, not steered and not queued");
});

test("a report steered into a parent that settled appends nothing extra", async () => {
  const sent = [];
  const parent = runningParent(sent);
  const controller = createSubagentController(parentDependencies(parent));

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  await settled();
  parent.inner.emit(TURN_END);
  // The steer's message event arrives after the run ended, as pi appends a steer on the next
  // model request: the report is in the transcript, so nothing must ask for a turn.
  parent.inner.isStreaming = false;
  await notifying;

  assert.deepEqual(sent.map((entry) => entry.options.deliverAs), ["steer"]);
});

test("a steered report leaves the parent's unsettled count as soon as the run has it (#1727)", async () => {
  const sent = [];
  const parent = runningParent(sent);
  const controller = createSubagentController(parentDependencies(parent));

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  assert.deepEqual(getSessionIdsWithUnsettledSubagentRuns(), ["parent-session"]);
  await settled();
  parent.inner.emit(TURN_END);
  await notifying;

  assert.deepEqual(getSessionIdsWithUnsettledSubagentRuns(), []);
  assert.equal(sent[0].options.deliverAs, "steer");
});

test("a steer the SDK refuses falls back to waking the parent", async () => {
  const sent = [];
  const parent = runningParent(sent, { rejectSteer: true });
  const controller = createSubagentController(parentDependencies(parent));

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  await settled();
  parent.inner.emit(TURN_END);
  parent.inner.isStreaming = false;
  await notifying;

  assert.deepEqual(sent.map((entry) => entry.options.deliverAs), ["steer", "followUp"]);
});

test("a result already collected with get_subagent_result is never delivered again", async () => {
  const delivered = [];
  const controller = createSubagentController(idleParentDependencies(delivered));
  const run = { ...completedRun(), sessionId: "collected-child" };

  controller.extensionRuntime.markResultConsumed(run);
  await controller.extensionRuntime.notifyParent(run);

  assert.equal(delivered.length, 0);

  // The mark is consumed, so a later run reusing that session ID still notifies.
  await controller.extensionRuntime.notifyParent({ ...run, completedAt: "2026-01-01T00:05:00.000Z" });
  assert.equal(delivered.length, 1);
});

test("a mark left by an earlier run never swallows the next run's notification (#987)", async () => {
  const delivered = [];
  const controller = createSubagentController(idleParentDependencies(delivered));
  const first = { ...completedRun(), sessionId: "rerun-child" };

  // Run 1 notifies first; the parent then polls get_subagent_result and marks a result
  // whose notification has already been delivered, so no notifyParent ever takes that mark.
  await controller.extensionRuntime.notifyParent(first);
  controller.extensionRuntime.markResultConsumed(first);
  assert.equal(delivered.length, 1);

  const second = { ...first, parentToolCallId: "second-call", completedAt: "2026-01-01T00:05:00.000Z" };
  await controller.extensionRuntime.notifyParent(second);

  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].options.triggerTurn, true);
});

test("a notification waits for a busy parent and is dropped when that turn collects the result", async () => {
  const delivered = [];
  let running = true;
  const controller = createSubagentController(idleParentDependencies(delivered, { isRunning: () => running }));
  const run = { ...completedRun(), sessionId: "racing-child" };

  const notified = controller.extensionRuntime.notifyParent(run);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(delivered.length, 0, "must not deliver while the parent turn is still running");

  // The parent's in-flight get_subagent_result call returns the same result, then the turn ends.
  controller.extensionRuntime.markResultConsumed(run);
  running = false;
  await notified;

  assert.equal(delivered.length, 0);
});

test("a notification held for a busy parent is delivered once that parent goes idle", async () => {
  const delivered = [];
  let running = true;
  const controller = createSubagentController(idleParentDependencies(delivered, { isRunning: () => running }));
  const run = { ...completedRun(), sessionId: "waiting-child" };

  const notified = controller.extensionRuntime.notifyParent(run);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(delivered.length, 0);

  running = false;
  await notified;

  assert.equal(delivered.length, 1);
  assert.equal(
    delivered[0].message.content,
    `${SUBAGENT_NOTIFICATION_PREFIX}Subagent waiting-child completed.\n\nParser found`,
  );
  assert.deepEqual(delivered[0].options, { deliverAs: "followUp", triggerTurn: true });
});

test("a session has an unsettled subagent run while one under it, at any depth, is in the run map", () => {
  const previous = globalThis.__piSubagentRuns;
  const stored = (sessionId, parentSessionId) => [sessionId, { run: { sessionId, parentSessionId } }];
  try {
    // parent -> child (idle, settled) -> grandchild (still running): the grandchild's end
    // starts a turn in the child, whose end starts one in the parent.
    globalThis.__piSubagentRuns = new Map([stored("grandchild", "child"), stored("other-child", "other")]);
    assert.equal(hasUnsettledSubagentRun("child"), true);
    assert.equal(hasUnsettledSubagentRun("parent"), false);
    globalThis.__piSubagentRuns.set(...stored("child", "parent"));
    assert.equal(hasUnsettledSubagentRun("parent"), true);
    assert.equal(hasUnsettledSubagentRun("grandchild"), false);
    assert.equal(hasUnsettledSubagentRun("unrelated"), false);
  } finally {
    globalThis.__piSubagentRuns = previous;
  }
});

/** An assistant message entry of a fake run, in the shape a session file keeps. */
function assistantEntry(text, over = {}) {
  return { type: "message", message: { role: "assistant", content: text === null ? [] : [{ type: "text", text }] }, ...over };
}

/** An assistant entry that asked for tools, so its text is not the report. */
function toolCallEntry(text) {
  return { type: "message", message: { role: "assistant", content: [
    ...(text ? [{ type: "text", text }] : []),
    { type: "toolCall", id: "t1", name: "bash", arguments: {} },
  ] } };
}

test("a run's result keeps every report turn, oldest first, and its last text too (#1726)", () => {
  const entries = [
    toolCallEntry("working on it"),
    assistantEntry("All three are in lib/parser.ts"),
    assistantEntry("Steered: I stopped"),
  ];

  // The steer's acknowledgement is the last message; the report the run wrote stays in front of it.
  assert.equal(runResultText({ getEntries: () => entries }, 0), "All three are in lib/parser.ts\n\nSteered: I stopped");
});

test("a run whose tool turns carry no text keeps its report alone (#1726)", () => {
  const entries = [toolCallEntry(), assistantEntry("the report")];

  assert.equal(runResultText({ getEntries: () => entries }, 0), "the report");
});

test("a run ended with a tool call keeps its last text as the result (#1726)", () => {
  const entries = [assistantEntry("the report"), toolCallEntry()];

  assert.equal(runResultText({ getEntries: () => entries }, 0), "the report");
});

test("the run boundary leaves an earlier run's text out (#1726)", () => {
  const entries = [
    assistantEntry("FIRST_RESULT"),
    assistantEntry("RESUMED_RESULT"),
  ];

  assert.equal(runResultText({ getEntries: () => entries }, 1), "RESUMED_RESULT");
  // A window that holds no answer collects nothing, and the caller keeps the last assistant's text.
  assert.equal(runResultText({ getEntries: () => entries }, 2), undefined);
});

test("a message pi omitted for a retry is not part of the report (#1726)", () => {
  const entries = [
    toolCallEntry(),
    assistantEntry("TRUNCATED_PARTIAL_REPORT", { id: "m1" }),
    { type: "context_edit", targetId: "m1", replacement: null },
    assistantEntry("FULL_REPORT_AFTER_RETRY"),
  ];

  assert.equal(runResultText({ getEntries: () => entries }, 0), "FULL_REPORT_AFTER_RETRY");

  entries[2] = { type: "context_edit", targetId: "m1", replacement: { content: [{ type: "text", text: "REWRITTEN_REPORT" }] } };
  assert.equal(runResultText({ getEntries: () => entries }, 0), "REWRITTEN_REPORT\n\nFULL_REPORT_AFTER_RETRY");
});

test("a request stopped before any output does not end the report (#1726)", () => {
  const entries = [
    assistantEntry("the report"),
    { type: "message", message: { role: "assistant", content: [], stopReason: "aborted" } },
  ];

  assert.equal(runResultText({ getEntries: () => entries }, 0), "the report");
});

test("a steer that arrives as the child writes its report keeps the report (#1726)", async () => {
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "builder",
      description: "old task",
      task: "old",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: { version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z", result: "old result" } },
  ];
  const childInner = {
    sessionId: "steered-report-child",
    sessionFile: "/tmp/steered-report-child.jsonl",
    sessionManager: { getEntries: () => entries, appendCustomEntry: (type, data) => entries.push({ type: "custom", customType: type, data }) },
    // pi answers the steer with one more turn, so the acknowledgement is the session's last message.
    prompt: async () => {
      entries.push({ type: "message", timestamp: Date.now(), message: { role: "assistant", content: [{ type: "text", text: "Parser is in lib/parser.ts, with three entry points." }] } });
      entries.push({ type: "message", timestamp: Date.now(), message: { role: "assistant", content: [{ type: "text", text: "Steered: I stopped." }] } });
    },
    getLastAssistantText: () => "Steered: I stopped.",
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = { inner: { sessionManager: { getSessionId: () => "parent" } }, sessionFile: "/tmp/parent.jsonl", cwd: "/tmp", isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const controller = createSubagentController({
    getSession: (id) => id === childInner.sessionId ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });

  const execution = await controller.extensionRuntime.resume({
    parentContext: parent.inner,
    parentToolCallId: "new-call",
    sessionId: childInner.sessionId,
    task: "continue this",
    description: "Continue task",
  });
  const result = await execution.completion;

  assert.equal(result.status, "completed");
  assert.equal(result.result, "Parser is in lib/parser.ts, with three entry points.\n\nSteered: I stopped.");
  // The same text is what `get_subagent_result` reads back, and what the notification carries.
  assert.equal(entries.at(-1).customType, "pi-web:subagent-result");
  assert.equal(entries.at(-1).data.result, result.result);
  assert.ok(subagentNotificationText(result).includes("Parser is in lib/parser.ts"));
});

test("a background run counts as unsettled until its parent notification is delivered", async () => {
  const ready = Promise.withResolvers();
  const delivered = [];
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: () => ready.promise,
    inner: { sendCustomMessage: async (message) => delivered.push(message) },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });
  // The run has left the run map; the parent's turn has not started yet.
  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  assert.equal(hasUnsettledSubagentRun("parent-session"), true);
  ready.resolve();
  await notifying;
  assert.equal(delivered.length, 1);
  assert.equal(hasUnsettledSubagentRun("parent-session"), false);

  // A failed delivery lets go as well.
  parent.waitUntilReady = async () => { throw new Error("gone"); };
  await assert.rejects(controller.extensionRuntime.notifyParent(completedRun()), /gone/);
  assert.equal(hasUnsettledSubagentRun("parent-session"), false);
});

test("a parent notification stops counting once the turn it triggers has started (#1434)", async () => {
  const turn = Promise.withResolvers();
  let running = false;
  let unsettledInTurn;
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => running,
    waitUntilReady: async () => {},
    inner: {
      // pi marks the run active before its first await and resolves once that run settled.
      sendCustomMessage: (_message, options) => {
        assert.equal(options.triggerTurn, true);
        running = true;
        return turn.promise;
      },
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });

  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  assert.deepEqual(getSessionIdsWithUnsettledSubagentRuns(), ["parent-session"]);
  await new Promise((resolve) => setImmediate(resolve));
  // The parent's run is under way: its own end decides the completion, so the report is no longer pending there.
  unsettledInTurn = hasUnsettledSubagentRun("parent-session");
  running = false;
  turn.resolve();
  await notifying;
  assert.equal(unsettledInTurn, false);
  assert.deepEqual(getSessionIdsWithUnsettledSubagentRuns(), []);
});

test("a result the parent collected no longer counts while its notification waits to be dropped", async () => {
  let running = true;
  const delivered = [];
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => running,
    waitUntilReady: async () => {},
    inner: {
      isStreaming: true,
      steeringMode: "all",
      agent: { steeringMode: "all", hasQueuedMessages: () => false, state: { streamingMessage: {} } },
      subscribe: () => () => {},
      sendCustomMessage: async (message) => delivered.push(message),
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });
  const run = completedRun();
  const notifying = controller.extensionRuntime.notifyParent(run);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hasUnsettledSubagentRun("parent-session"), true);

  // get_subagent_result collects it inside the parent's run, which then ends with no report to wait for.
  controller.extensionRuntime.markResultConsumed(run);
  assert.equal(hasUnsettledSubagentRun("parent-session"), false);
  running = false;
  await notifying;
  assert.equal(delivered.length, 0);
});

test("a run whose status write throws leaves the run map, so its parent is not held forever (#1434)", async () => {
  let failOn = "running";
  let prompted = false;
  const entries = [
    { type: "custom", customType: "pi-web:subagent", data: {
      version: 1,
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      parentToolCallId: "old-call",
      profile: "explore",
      description: "old task",
      task: "old",
      runInBackground: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      resourceSnapshot: { version: 1, appendSystemPrompt: [], tools: [], loadSkills: false, loadExtensions: false },
    } },
    { type: "custom", customType: "pi-web:subagent-result", data: { version: 1, status: "completed", completedAt: "2026-01-01T00:01:00.000Z" } },
  ];
  const childInner = {
    sessionId: "unwritable-child",
    sessionFile: "/tmp/child.jsonl",
    sessionManager: {
      getEntries: () => entries,
      // The session file cannot be appended to (a full disk, its folder removed).
      appendCustomEntry: (type, data) => {
        if (data?.status === failOn) throw new Error("ENOSPC: no space left on device");
        entries.push({ type: "custom", customType: type, data });
      },
    },
    prompt: async () => { prompted = true; },
    getLastAssistantText: () => undefined,
    abort: async () => {},
  };
  const child = { inner: childInner, sessionFile: childInner.sessionFile, cwd: tmpdir(), isAlive: () => true, isRunning: () => false, waitUntilReady: async () => {} };
  const parent = {
    inner: { sessionManager: { getSessionId: () => "parent" } },
    sessionFile: "/tmp/parent.jsonl",
    cwd: "/tmp",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {},
  };
  const controller = createSubagentController({
    getSession: (id) => id === "unwritable-child" ? child : parent,
    registerSession: () => {},
    reopenSession: async () => child,
    resolveSessionPath: async () => child.sessionFile,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });
  const resumeRequest = {
    parentContext: parent.inner,
    parentToolCallId: "retry-call",
    sessionId: "unwritable-child",
    task: "try again",
    description: "Retry",
    runInBackground: true,
  };

  const execution = await controller.extensionRuntime.resume(resumeRequest);
  const run = await execution.completion;
  assert.equal(run.status, "failed");
  assert.match(run.error, /ENOSPC/);
  assert.equal(prompted, false);
  assert.equal(hasUnsettledSubagentRun("parent"), false);

  // The same when the write that fails is the queued status, before the run is enqueued.
  failOn = "queued";
  await assert.rejects(controller.extensionRuntime.resume(resumeRequest), /ENOSPC/);
  assert.equal(hasUnsettledSubagentRun("parent"), false);
});

test("the debug snapshot lists a session's family at any depth with states and times only, and changes nothing", () => {
  const previousRuns = globalThis.__piSubagentRuns;
  const previousNotifications = globalThis.__piSubagentParentNotifications;
  const calls = [];
  const mcpWait = new AbortController();
  const stored = (sessionId, parentSessionId, extra = {}) => [sessionId, {
    run: {
      ...completedRun(),
      sessionId,
      parentSessionId,
      sessionPath: `/secret/path/${sessionId}.jsonl`,
      task: "secret task text",
      result: "secret result text",
      error: "secret provider error",
      worktreePath: "/secret/worktree",
      worktreeBranch: "secret-branch",
      status: "running",
    },
    completion: new Promise(() => {}),
    abortRequested: false,
    cancelQueued: () => { calls.push(`cancel ${sessionId}`); return true; },
    ...extra,
  }];
  try {
    globalThis.__piSubagentRuns = new Map([
      stored("grandchild", "child", { dispatchedAt: 2_000, mcpWait }),
      stored("other-child", "other"),
      stored("child", "parent", { dispatchedAt: 1_000, abortRequested: true }),
    ]);
    // One delivery added before a hot reload carries no `since`.
    globalThis.__piSubagentParentNotifications = new Set([
      { sessionId: "done-child", parentSessionId: "child", since: 3_000 },
      { sessionId: "old-child", parentSessionId: "parent" },
      { sessionId: "elsewhere", parentSessionId: "other" },
    ]);
    const keys = [...globalThis.__piSubagentRuns.keys()];
    const rows = [...globalThis.__piSubagentRuns.values()].map((entry) => ({ ...entry, run: { ...entry.run } }));

    const snapshot = subagentDebugSnapshot("parent");
    assert.deepEqual(snapshot.runs.map((run) => run.sessionId), ["grandchild", "child"]);
    assert.deepEqual(snapshot.runs[0], {
      sessionId: "grandchild",
      parentSessionId: "child",
      status: "running",
      profile: "Explore",
      background: true,
      resumed: false,
      dispatchedAt: 2_000,
      abortRequested: false,
      mcpWaiting: true,
    });
    assert.equal(snapshot.runs[1].abortRequested, true);
    assert.deepEqual(snapshot.notifications, [
      { sessionId: "done-child", parentSessionId: "child", since: 3_000 },
      { sessionId: "old-child", parentSessionId: "parent", since: null },
    ]);
    assert.deepEqual(subagentDebugSnapshot("grandchild"), { runs: [], notifications: [] });
    assert.equal(subagentDebugSnapshot().runs.length, 3);
    assert.equal(subagentDebugSnapshot().notifications.length, 3);

    const json = JSON.stringify([subagentDebugSnapshot(), snapshot]);
    for (const secret of ["secret task", "secret result", "secret provider", "/secret/", "secret-branch"]) {
      assert.ok(!json.includes(secret), secret);
    }
    // Read as they are: nothing cancelled, aborted, removed or reordered.
    assert.deepEqual(calls, []);
    assert.equal(mcpWait.signal.aborted, false);
    assert.deepEqual([...globalThis.__piSubagentRuns.keys()], keys);
    assert.deepEqual([...globalThis.__piSubagentRuns.values()], rows);
    assert.equal(globalThis.__piSubagentParentNotifications.size, 3);
  } finally {
    globalThis.__piSubagentRuns = previousRuns;
    globalThis.__piSubagentParentNotifications = previousNotifications;
  }
});

test("the debug snapshot creates neither table when no run was ever stored", () => {
  const previousRuns = globalThis.__piSubagentRuns;
  const previousNotifications = globalThis.__piSubagentParentNotifications;
  try {
    globalThis.__piSubagentRuns = undefined;
    globalThis.__piSubagentParentNotifications = undefined;
    assert.deepEqual(subagentDebugSnapshot("parent"), { runs: [], notifications: [] });
    assert.deepEqual(subagentDebugSnapshot(), { runs: [], notifications: [] });
    assert.equal(globalThis.__piSubagentRuns, undefined);
    assert.equal(globalThis.__piSubagentParentNotifications, undefined);
  } finally {
    globalThis.__piSubagentRuns = previousRuns;
    globalThis.__piSubagentParentNotifications = previousNotifications;
  }
});

test("a parent notification shows in the debug snapshot from the moment its delivery starts", async () => {
  const ready = Promise.withResolvers();
  const parent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: () => ready.promise,
    inner: { sendCustomMessage: async () => {} },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async () => parent,
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });
  const before = Date.now();
  const notifying = controller.extensionRuntime.notifyParent(completedRun());
  const [pending] = subagentDebugSnapshot("parent-session").notifications;
  assert.equal(pending.sessionId, "child-session");
  assert.equal(pending.parentSessionId, "parent-session");
  assert.ok(pending.since >= before && pending.since <= Date.now(), String(pending.since));
  ready.resolve();
  await notifying;
  assert.deepEqual(subagentDebugSnapshot("parent-session").notifications, []);
});
