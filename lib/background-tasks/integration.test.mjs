import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  createEventBus,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

/**
 * The panel's client against the real `pi-background-tasks` extension, on a real pi session and
 * a real EventBus. `host-client.test.mjs` pins the client's rules against a contract-exact fake;
 * this test pins the seam between the two packages — the channels, the payload shapes, the
 * limits, the lease rules, the answers for ids that do not exist, the live feed, and the
 * shutdown frame — as the extension actually answers them.
 *
 * The task is started the way a conversation starts one: pi's faux model calls the extension's
 * own `bg_run` tool. The published host interface has no create operation — the extension is the
 * only registry — so this is the only honest way for the panel's reader to have a task to read.
 * The model is faux and no provider credential is read.
 */
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { BackgroundTaskHostClient, BackgroundTaskHostError } = await jiti.import("./host-client.ts");
const { resolveBackgroundTasksEntryForCwd, resolveInstalledBackgroundTasksEntry } = await jiti.import("./extension.ts");
const { attachBackgroundTasksBridge, releaseBackgroundTasksBridge } = await jiti.import("./bridges.ts");
const { runWokeByBackgroundTask } = await jiti.import("./completion-gate.ts");
const { listBackgroundTasksRunning } = await jiti.import("./running-index.ts");
const {
  announceRunEnd,
  noteConversationRunSettled,
  noteConversationRunStart,
  resetCompletionAnnouncements,
} = await jiti.import("../task-completion-server.ts");

/**
 * The seam needs the published package. It is installed as this app's dependency, or as a pi
 * plugin (`pi install npm:pi-background-tasks`) under the agent dir — a linked worktree of this
 * repo ships no dependency of its own, so the suite skips there rather than failing, and names
 * the way to make it run.
 */
const installedEntry = resolveBackgroundTasksEntryForCwd(process.cwd()) ?? resolveInstalledBackgroundTasksEntry();
const skipWithoutPackage = installedEntry
  ? false
  : "pi-background-tasks is not installed here: npm install pi-background-tasks, or pi install npm:pi-background-tasks";

async function createSession(dir, faux, eventBus) {
  const entry = installedEntry;
  assert.ok(entry, "the extension package is installed");
  const modelRuntime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const services = await createAgentSessionServices({
    cwd: dir,
    agentDir: dir,
    settingsManager: SettingsManager.inMemory(),
    modelRuntime,
    resourceLoaderOptions: {
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      eventBus,
      additionalExtensionPaths: [entry],
    },
  });
  const loaded = services.resourceLoader.getExtensions();
  assert.deepEqual(loaded.errors, [], "the extension loads clean under this SDK");
  const extension = loaded.extensions.find((item) => item.path.includes("pi-background-tasks"));
  assert.ok(extension, "the extension is registered on the session");
  assert.ok([...extension.tools.keys()].includes("bg_run"), "the extension's task tool is on the session");
  assert.ok([...extension.commands.keys()].includes("bg"), "the extension's /bg command is on the session");
  const { session } = await createAgentSessionFromServices({
    services,
    sessionManager: SessionManager.inMemory(dir),
    model: faux.getModel("faux-model"),
  });
  // Extensions run bound to the session; the host interface gets its session context there,
  // which is what the activation's `ready` frame announces.
  await session.bindExtensions({ mode: "rpc", shutdownHandler: () => {}, onError: () => {} });
  return session;
}

/** The app's own closing order: extensions first, with a deadline, then dispose. */
async function emitSessionShutdown(session) {
  const runner = session.extensionRunner;
  const emit = runner?.emit;
  if (typeof emit !== "function") return;
  const deadline = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 5000);
    timer.unref?.();
  });
  const handled = (async () => {
    await emit.call(runner, { type: "session_shutdown", reason: "quit" });
  })();
  await Promise.race([handled, deadline]);
  session.dispose();
}

/** Poll until the extension answers as expected, or the clock runs out. */
async function until(read, { timeoutMs = 10000, label = "the extension" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (last.done) return last.value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`${label} did not answer as expected within ${String(timeoutMs)}ms (last: ${JSON.stringify(last?.value)})`);
}

test("the panel reads, watches and stops a task the conversation started, through the extension's own interface", { skip: skipWithoutPackage }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-bg-tasks-integration-"));
  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const eventBus = createEventBus();
  const host = new BackgroundTaskHostClient(eventBus, { clientId: "pi-web:integration-test" });
  // The app's order, which is the one that works: the bus and the panel's client exist before
  // the session binds, so the activation's `ready` frame is heard, not missed.
  const changes = [];
  host.onChanges((frame) => changes.push(frame.kind));
  let session;
  try {
    session = await createSession(dir, faux, eventBus);

    // Capabilities: the contract's own version and bounds, which the panel asks with.
    const capabilities = await until(() => host.capabilities().then(
      (value) => ({ done: true, value }),
      (error) => (error.code === "UNAVAILABLE" || error.code === "TIMEOUT"
        ? { done: false, value: error.code }
        : { done: true, value: { code: error.code } }),
    ), { label: "the host interface" });
    assert.equal(capabilities.api_version, 1);
    for (const operation of ["capabilities", "subscribe", "unsubscribe", "list", "detail", "logs", "stop", "stop_all", "rerun", "mark_seen"]) {
      assert.ok(capabilities.operations.includes(operation), `the contract names ${operation}`);
    }
    assert.equal(capabilities.max_log_bytes, 65536);

    // A registry with nothing in it: the shape the panel's "no tasks" state is built from.
    const empty = await host.list();
    assert.ok(empty.activationId.length > 0, "every answer carries the activation it came from");
    assert.deepEqual(empty.tasks, []);
    assert.deepEqual(empty.counts, {
      running: 0, completed: 0, failed: 0, killed: 0,
      unseenCompleted: 0, unseenFailed: 0, unseenKilled: 0, total: 0,
    });
    assert.equal(empty.nextCursor, null);
    assert.ok(changes.includes("ready"), "the activation announced itself on the change channel");

    // A second consumer on the same bus gets its own lease, never the panel's.
    const other = new BackgroundTaskHostClient(eventBus, { clientId: "pi-web:second" });
    assert.equal((await other.list()).activationId, empty.activationId);
    other.dispose();

    // The conversation starts the task, through the extension's own tool.
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("bg_run", { command: "echo starting; sleep 30", name: "sleeper", description: "integration sleeper", isAgent: false }, { id: "call-1" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("started")]),
    ]);
    await session.prompt("start the sleeper");

    const started = await until(async () => {
      const list = await host.list();
      const entry = list.tasks.find((task) => task.task.name === "sleeper" && task.task.status === "running");
      return entry ? { done: true, value: entry } : { done: false, value: list.tasks.map((task) => [task.task.name, task.task.status]) };
    }, { label: "the started task" });
    assert.equal(started.kind, "shell");
    assert.equal(started.seen, false, "a task nobody has opened is unseen");
    assert.ok(started.task.pid > 0, "the task is a process the extension can stop");
    assert.ok(started.task.outputPath.length > 0);

    // The live feed: a task that appeared is a change frame, so a panel can refresh without a
    // timer. The frame rides the registry's revision, so it lands just after the list sees it.
    await until(() => (changes.includes("changed") ? { done: true, value: changes } : { done: false, value: changes }), {
      label: "the change feed",
    });
    const running = await host.list();
    assert.ok(running.counts.running >= 1, "the badge's running count is the extension's");
    assert.ok(running.counts.total >= 1);
    assert.equal(running.counts.unseenKilled, 0, "a running task is not an unseen failure");
    assert.ok(running.tasks.some((entry) => entry.task.id === started.task.id));

    // `detail` answers one complete task view: the snapshot under `task`, the panel's own fields
    // beside it. The contract's nesting, pinned here because a client that flattens it reads
    // undefined where the panel shows a working directory.
    const detail = (await host.detail(started.task.id)).task;
    assert.equal(detail.task.id, started.task.id);
    assert.equal(detail.kind, "shell");
    assert.equal(detail.canRerun, true, "a shell task can be run again");
    // The working directory the panel shows is the session's own folder — the one the task was
    // started in, so a row's "where" is the conversation's project, not the server's home.
    assert.equal(detail.task.cwd, dir, `task cwd=${detail.task.cwd} session dir=${dir}`);
    assert.equal(detail.task.description, "integration sleeper", "detail carries the full strings, not a preview");

    const logs = await host.logs(started.task.id, { maxBytes: 4096 });
    assert.equal(logs.task.id, started.task.id);
    const withOutput = await until(async () => {
      const entry = await host.logs(started.task.id, { maxBytes: 4096 });
      return entry.text.includes("starting") ? { done: true, value: entry } : { done: false, value: entry.text };
    }, { label: "the task's output" });
    assert.ok(withOutput.totalBytes >= withOutput.text.length);
    assert.equal(withOutput.tail, true, "the window is the tail, which is what a monitor shows");

    // Viewing a running task acknowledges nothing: its unseen mark stays, because the completion
    // it has not reached yet cannot have been read.
    const early = await host.markSeen([started.task.id]);
    assert.equal(early.results.find((entry) => entry.taskId === started.task.id)?.outcome, "not_terminal");
    assert.equal((await host.list()).tasks.find((entry) => entry.task.id === started.task.id)?.seen, false);

    // The panel stops it: SIGTERM, and the row settles at `killed` with a signal recorded.
    const stopped = await host.stop(started.task.id);
    assert.equal(stopped.task.status, "killed");
    assert.equal(stopped.alreadyTerminal, false);
    const settled = await until(async () => {
      const list = await host.list();
      const entry = list.tasks.find((task) => task.task.id === started.task.id);
      return entry && entry.task.status === "killed" ? { done: true, value: entry } : { done: false, value: entry?.task.status };
    }, { label: "the killed task" });
    assert.ok(["SIGTERM", "SIGKILL", "SIGINT", null, undefined].includes(settled.task.signal));
    assert.ok(settled.task.endTime >= settled.task.startTime);

    // Reading it acknowledges it, as the dock does.
    const seen = await host.markSeen([started.task.id]);
    assert.equal(seen.results.find((entry) => entry.taskId === started.task.id)?.outcome, "marked");
    assert.equal(seen.counts.unseenKilled, 0, "the unseen failure the badge wore is gone");

    // Stopping an ended task is an answer, not a hang.
    assert.equal((await host.stop(started.task.id)).alreadyTerminal, true);

    // Ids the registry never issued answer with the documented code.
    for (const [label, call] of [
      ["detail", () => host.detail("no-such-task")],
      ["logs", () => host.logs("no-such-task", { maxBytes: 4096 })],
      ["stop", () => host.stop("no-such-task")],
    ]) {
      await assert.rejects(call(), (error) => {
        assert.ok(error instanceof BackgroundTaskHostError, `${label} answers a host error`);
        assert.equal(error.code, "NOT_FOUND", `${label} on a missing task`);
        return true;
      });
    }

    // The selection is the caller's, frozen, never a fresh registry-wide scan — and it must
    // carry at least one id. That is why the panel's "Stop all" appears only when something runs,
    // and why the server refuses an empty selection before the extension is asked.
    await assert.rejects(host.stopAll([]), (error) => {
      assert.equal(error.code, "INVALID_REQUEST");
      return true;
    });
    const notMine = await host.stopAll(["no-such-task"]);
    assert.deepEqual(notMine.results, [{ taskId: "no-such-task", outcome: "not_found" }]);
    assert.equal(notMine.notFound, 1);
  } finally {
    host.dispose();
    if (session) await emitSessionShutdown(session);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the extension announces its closure when the session ends, and the client stops leasing", { skip: skipWithoutPackage }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-bg-tasks-shutdown-"));
  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const eventBus = createEventBus();
  const host = new BackgroundTaskHostClient(eventBus, { clientId: "pi-web:shutdown-test" });
  const changes = [];
  host.onChanges((frame) => changes.push(frame.kind));
  let session;
  try {
    session = await createSession(dir, faux, eventBus);
    await host.list();
    const changes = [];
    host.onChanges((frame) => changes.push(frame.kind));
    // The way the app closes a session: extensions hear `session_shutdown` first, and only then
    // is the SDK session disposed. The extension's `closed` frame is its shutdown handler.
    await emitSessionShutdown(session);
    await until(() => (changes.includes("closed") ? { done: true, value: changes } : { done: false, value: changes }), {
      label: "the shutdown frame",
    });
    // The activation is gone: the client knows, and a request on it is refused, not queued.
    assert.equal(host.getState().leased, false);
    await assert.rejects(host.list(), (error) => {
      assert.equal(error.code, "CLOSED");
      return true;
    });
  } finally {
    host.dispose();
    if (session && !session.isDisposed) await emitSessionShutdown(session);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a client on a bus with no extension says so, and the panel's availability follows", { skip: skipWithoutPackage }, async () => {
  const eventBus = createEventBus();
  const host = new BackgroundTaskHostClient(eventBus, { clientId: "pi-web:no-extension", requestTimeoutMs: 60 });
  await assert.rejects(host.list(), (error) => {
    // Nobody answers: that is the signal the service maps to "the panel has no source".
    assert.equal(error.code, "TIMEOUT");
    return true;
  });
  host.dispose();
});

/**
 * The notification bug, pinned where it actually happens: a real pi session, the real
 * `pi-background-tasks` extension, the app's own bridge, and the app's own announcer.
 *
 * The user's report: a prompt started three background tasks, and when the last task finished a
 * notification popped out ("The task lasted 0h2m24s …"), and 12 seconds later a second one popped
 * out when the conversation finished. Two rows for one job, and the Safari push of the second
 * arrived under the same tag as the first, so it replaced it quietly: the phone and the Mac buzzed
 * for a task, and the browser said nothing about the finished conversation.
 *
 * The rule that answers it, end to end: **a finished background task pops nothing**, and the
 * conversation's end is announced **once**, on every channel, with the span of the whole job.
 */
test("a conversation with background tasks is announced once, when it ends — never when a task does", { skip: skipWithoutPackage }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-bg-tasks-announce-"));
  const faux = fauxProvider({ models: [{ id: "faux-model" }] });
  const eventBus = createEventBus();
  const host = new BackgroundTaskHostClient(eventBus, { clientId: "pi-web:announce-test" });
  const announcements = [];
  const env = {
    now: () => Date.now(),
    notifyPush: async (sessionId, event, sessionName) => {
      announcements.push({ channel: "push", sessionId, event, sessionName });
      return { attempted: 1, sent: 1, pruned: 0, failures: [] };
    },
    publishNtfy: async (message) => {
      announcements.push({ channel: "ntfy", ...message });
      return { sent: true, status: "sent" };
    },
    raiseLocal: async (options) => {
      announcements.push({ channel: "local", ...options });
      return true;
    },
    localSettings: () => ({ enabled: true, locale: "en" }),
    lastRun: async () => null,
    sessionTitle: async () => "Three tasks",
  };
  resetCompletionAnnouncements();
  let session;
  let unsubscribe = () => {};
  try {
    session = await createSession(dir, faux, eventBus);
    const sessionId = session.sessionId;
    // The app's bridge: it feeds the running index (the announcer's `backgroundTasksRunning`) and
    // the completion gate (its verdict on a turn the extension woke) from the extension's frames.
    attachBackgroundTasksBridge(sessionId, dir, eventBus);
    // As in the app: the bridge is attached when the session opens, so its first counts — the
    // subscribe answer, taken before any task exists — are recorded before a prompt runs. Without
    // that, the announcer sees a conversation with no background work at all and says the answer.
    const bridgeCounts = await until(async () => {
      const counts = (await host.list()).counts;
      return counts.total >= 0 ? { done: true, value: counts } : { done: false, value: counts };
    }, { label: "the extension's answer" });
    assert.equal(bridgeCounts.total, 0, "the conversation starts with no background work");

    // `AgentSessionWrapper`'s driver in miniature: a run starts, its end is announced — and a turn
    // the extension woke is handed to the announcer as a machine-woken end, exactly as the session
    // does. The channels are fakes; the running index, the gate and the announcer are the app's own.
    const runs = [];
    const pending = [];
    let requestedAt = 0;
    let runStartedAt = null;
    let runOwed = false;
    let announcesRun = true;
    let backgroundWorkStarted = false;
    unsubscribe = session.subscribe((event) => {
      if (typeof event.toolName === "string" && event.toolName === "bg_run") backgroundWorkStarted = true;
      if (event.type === "agent_start") {
        if (!runOwed) {
          announcesRun = !runWokeByBackgroundTask(sessionId, requestedAt);
          runOwed = true;
          runStartedAt = Date.now();
          backgroundWorkStarted = false;
        }
        noteConversationRunStart(sessionId);
      }
      if (event.type === "agent_settled" && runOwed) {
        runOwed = false;
        const startedAt = runStartedAt;
        const finishedAt = Date.now();
        runStartedAt = null;
        const startedWork = backgroundWorkStarted;
        backgroundWorkStarted = false;
        runs.push({ startedAt, finishedAt, announces: announcesRun, startedWork });
        const outcome = { status: "done", startedAt: startedAt ?? undefined, endedAt: finishedAt };
        pending.push(announcesRun
          ? announceRunEnd({ sessionId, sessionName: "Three tasks", outcome, requestedAt, backgroundWorkStarted: startedWork }, env)
          : noteConversationRunSettled(sessionId, { startedAt: startedAt ?? undefined, endedAt: finishedAt, backgroundWorkStarted: startedWork }, env));
      }
    });

    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("bg_run", { command: "sleep 1", name: "ticks", description: "one second", isAgent: false }, { id: "call-1" }),
          fauxToolCall("bg_run", { command: "echo about to fail; sleep 1; exit 7", name: "boom", description: "fails", isAgent: false }, { id: "call-2" }),
          fauxToolCall("bg_run", { command: "sleep 4", name: "sleeper", description: "the long one", isAgent: false }, { id: "call-3" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxText("three task ids"),
      fauxText("the sleeper is done"),
      fauxText("the boom failed"),
      fauxText("the ticks are done"),
      fauxText("all three settled"),
    ]);

    requestedAt = Date.now();
    await session.prompt("start exactly three background tasks and reply with their ids");

    // The run that started the tasks has ended, and the tasks are running: no channel says anything.
    await until(async () => {
      const counts = (await host.list()).counts;
      const indexed = listBackgroundTasksRunning()[sessionId];
      return counts.running >= 1 && (indexed?.running ?? 0) >= 1
        ? { done: true, value: { counts, indexed } }
        : { done: false, value: { counts, indexed } };
    }, { label: "the three started tasks, in the app's own running index" });
    await Promise.all(pending.splice(0));
    assert.equal(announcements.length, 0, "the prompt's answer pops no notification: its work is still running");
    // The last task settles. The bridge hears it, and this is the moment the bug announced at.
    await until(async () => {
      const counts = (await host.list()).counts;
      const indexed = listBackgroundTasksRunning()[sessionId];
      return counts.running === 0 && (indexed?.running ?? 0) === 0
        ? { done: true, value: { counts, indexed } }
        : { done: false, value: { counts, indexed } };
    }, { label: "the tasks settling, as the app's running index reports them", timeoutMs: 30_000 });
    const allSettledAt = Date.now();
    assert.equal(announcements.length, 0, "a finished background task pops no notification at all");

    // The turns those tasks woke run and settle. The last of them is the conversation's end, and it
    // is the one announcement — push, ntfy and the Mac's row, together.
    await until(async () => {
      await Promise.all(pending.splice(0));
      return announcements.length > 0 ? { done: true, value: announcements.length } : { done: false, value: { runs: runs.length } };
    }, { label: "the conversation's one announcement", timeoutMs: 30_000 });
    // A moment for any further wake-up turn of the burst, then the count is final.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await Promise.all(pending.splice(0));

    const woke = runs.filter((run) => !run.announces);
    assert.ok(woke.length >= 1, `the extension woke a turn of its own (runs: ${JSON.stringify(runs)})`);
    for (const channel of ["push", "ntfy", "local"]) {
      const sent = announcements.filter((entry) => entry.channel === channel);
      assert.equal(sent.length, 1, `exactly one ${channel} notice for one job (got ${String(sent.length)}: ${JSON.stringify(announcements)})`);
    }
    const event = announcements.find((entry) => entry.channel === "push").event;
    assert.equal(event.kind, "complete");
    const promptRun = runs[0];
    assert.ok(event.startedAt <= requestedAt + 2_000, `the sentence opens with the prompt, not the wake-up turn (${String(event.startedAt)} vs ${String(requestedAt)})`);
    // The `sleeper` task runs four seconds after the prompt was sent, so a sentence that ends less
    // than four seconds after the answer landed is the old bug: news about the fifteen-second
    // answer, in the words of a finished job.
    assert.ok(
      event.endedAt >= promptRun.finishedAt + 4_000,
      `the sentence ends with the conversation, not the answer (ended ${String(event.startedAt)}→${String(event.endedAt)}, answer landed ${String(promptRun.finishedAt)})`,
    );
    assert.ok(event.endedAt - event.startedAt >= 4_000, "the number the user is waiting for is the whole job, not the fifteen seconds of the answer");
    // Not the cap: the notice is the conversation's own end, not a ten-minute fallback.
    assert.ok(event.endedAt <= allSettledAt + 60_000, `the notice is the conversation's end, not a fallback (${String(event.endedAt)} vs ${String(allSettledAt)})`);
  } finally {
    unsubscribe();
    releaseBackgroundTasksBridge(sessionIdOf(session));
    resetCompletionAnnouncements();
    host.dispose();
    if (session) await emitSessionShutdown(session);
    await rm(dir, { recursive: true, force: true });
  }
});

function sessionIdOf(session) {
  return session?.sessionId;
}
