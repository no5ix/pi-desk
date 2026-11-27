import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The server's own announcement of a finished run: the phone push, the ntfy message and the
// Mac's Notification Center row, sent by the process that owns the run so they arrive with
// no browser page open. One announcement per run, none for a run this process is only
// catching up on, none for a run the user stopped, and none that cannot speak the format:
// the title is the session's name — the live name, or the first prompt the sidebar titles
// the row with — and the content is the run's one sentence, so a run with no span, or a
// session with no name and no prompt at all, stays silent.
const {
  ATTENTION_COOLDOWN_MS,
  COMPLETION_NOTICE_COOLDOWN_MS,
  CONVERSATION_QUIET_MS,
  DEFERRED_NOTICE_MAX_WAIT_MS,
  announceAttention,
  announceRunEnd,
  noteBackgroundTasksSettled,
  noteConversationRunSettled,
  quietTick,
  releaseConversationCompletion,
  resetCompletionAnnouncements,
  runAnnounceKey,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./task-completion-server.ts");

const ENDED = Date.parse("2026-01-27T08:14:51.000Z");
const STARTED = ENDED - (1 * 60 + 49) * 1000;

function harness({ enabled = true, locale = "en", now = ENDED + 500, lastRun = null, sessionTitle = null, overrides = {} } = {}) {
  const push = [];
  const ntfy = [];
  const local = [];
  const titles = [];
  const env = {
    now: () => now,
    notifyPush: async (sessionId, event, sessionName) => { push.push({ sessionId, event, sessionName }); },
    publishNtfy: async (message) => { ntfy.push(message); return { sent: true, status: "sent" }; },
    raiseLocal: async (options) => { local.push(options); return true; },
    localSettings: () => ({ enabled, locale }),
    lastRun: async () => lastRun,
    sessionTitle: async (sessionId) => {
      titles.push(sessionId);
      return sessionTitle;
    },
    ...overrides,
  };
  return { env, push, ntfy, local, titles };
}

test.beforeEach(() => resetCompletionAnnouncements());

test("a finished run is announced on every channel that needs no page", async () => {
  const { env, push, ntfy, local } = harness();
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Fix the parser", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, env);

  assert.equal(outcome.skipped, undefined);
  assert.deepEqual(outcome.sent, { push: true, ntfy: true, local: true });
  assert.equal(push.length, 1);
  assert.deepEqual(push[0].event, { kind: "complete", startedAt: STARTED, endedAt: ENDED });
  assert.equal(push[0].sessionName, "Fix the parser", "the live session's name travels, so no file scan is needed");

  // One sentence, three channels: the phone, the topic and Notification Center agree.
  assert.equal(ntfy.length, 1);
  assert.equal(local.length, 1);
  for (const message of [ntfy[0], local[0]]) {
    assert.equal(message.title, "Fix the parser");
    assert.match(message.body, /^The task lasted 0h1m49s, started at \d\d:\d\d:\d\d, and ended at \d\d:\d\d:\d\d\. This notification pops up at \d\d:\d\d:\d\d\.$/);
  }
  assert.ok(ntfy[0].priority >= 4, "a finished task is the message the user is waiting for");
});

test("the ntfy message and the Mac's row speak the app's language", async () => {
  const { env, ntfy, local } = harness({ locale: "zh-CN" });
  await announceRunEnd({ sessionId: "s-1", sessionName: "修复解析器", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, env);
  assert.match(ntfy[0].body, /^任务历时 0h1m49s，开始于 \d\d:\d\d:\d\d，结束于 \d\d:\d\d:\d\d。此通知在 \d\d:\d\d:\d\d 弹出。$/);
  assert.match(local[0].body, /^任务历时/);
});

test("a run the user stopped announces nothing", async () => {
  const { env, push, ntfy, local } = harness();
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "aborted", startedAt: STARTED, endedAt: ENDED } }, env);
  assert.equal(outcome.skipped, "aborted");
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0]);
});

test("a run that failed says nothing out loud", async () => {
  const { env, push, ntfy, local } = harness();
  const failed = await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "failed", error: "429 rate limited", startedAt: STARTED, endedAt: ENDED } },
    env,
  );
  // The sentence a failure would carry is the provider's own text (a 400 from an offline
  // proxy, a quota, a test fixture), and the user asked not to be shown it: the failure is
  // in the chat and in the session file, and no channel gets a copy.
  assert.equal(failed.skipped, "failed");
  assert.deepEqual(failed.sent, { push: false, ntfy: false, local: false });
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0]);

  // The skip is per run, not per session: the run that finishes is announced as usual.
  const done = await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } },
    env,
  );
  assert.equal(done.skipped, undefined);
  assert.equal(push.length, 1);
  assert.match(ntfy[0].body, /The task lasted/);
});

test("one run is announced once, whatever path settles it", async () => {
  const { env, push, ntfy, local } = harness();
  const request = { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } };
  assert.equal((await announceRunEnd(request, env)).skipped, undefined);
  // agent_settled, then the prompt promise, then a wrapper re-created mid-run: one run.
  assert.equal((await announceRunEnd(request, env)).skipped, "announced");
  assert.equal((await announceRunEnd(request, env)).skipped, "announced");
  assert.deepEqual([push.length, ntfy.length, local.length], [1, 1, 1]);

  // The next run of the same session is a new task.
  const next = { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: ENDED, endedAt: ENDED + 60_000 } };
  assert.equal((await announceRunEnd(next, env)).skipped, undefined);
  assert.equal(push.length, 2);
});

test("a run this process is only catching up on says nothing", async () => {
  const longAgo = ENDED - 20 * 60_000;
  const { env, push, ntfy, local } = harness();
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: longAgo - 60_000, endedAt: longAgo } }, env);
  assert.equal(outcome.skipped, "stale");
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
    "a wrapper restored mid-run, or a restart settling a run that ended while this process was away, is not news");
});

test("a run with no span says nothing: the format needs the run's numbers", async () => {
  const { env, push, ntfy, local } = harness();
  const request = { sessionId: "s-1", sessionName: "From the phone", outcome: { status: "done" } };
  assert.equal((await announceRunEnd(request, env)).skipped, "no-span");
  assert.deepEqual((await announceRunEnd(request, env)).skipped, "no-span");
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
    "no channel is sent the short \"Task finished.\": a notification that cannot name its span cannot say which task ended");
});

test("a run this process has no numbers for takes them from the session file", async () => {
  // A queued prompt, a wrapper restored mid-run, a run started from a phone: the server
  // knows it ended, and the session file knows how long it took.
  const { env, ntfy, local } = harness({ lastRun: { startedAt: STARTED, endedAt: ENDED } });
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "From the phone", outcome: { status: "done" } }, env);
  assert.match(ntfy[0].body, /^The task lasted 0h1m49s, started at /);
  assert.match(local[0].body, /^The task lasted 0h1m49s, started at /);
  assert.equal(outcome.key, `s-1|complete|${STARTED}|${ENDED}`, "the run's key is its real span, so a second path cannot repeat it");
});

test("a span read from the file that is older than the window is a catch-up, not news", async () => {
  const longAgo = ENDED - 20 * 60_000;
  const { env, push, ntfy } = harness({ lastRun: { startedAt: longAgo - 60_000, endedAt: longAgo } });
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "done" } }, env);
  assert.equal(outcome.skipped, "stale");
  assert.deepEqual([push.length, ntfy.length], [0, 0]);
});

test("a session file that cannot be read leaves the run unannounced, and is not an error", async () => {
  // The file is the only source of the span for a run this process did not time. Without
  // it there is no sentence, so the run is silent; the failed read must not throw, and it
  // must not be reported as a send failure.
  const { env, ntfy, push } = harness({ overrides: { lastRun: async () => { throw new Error("the file is gone"); } } });
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "done" } }, env);
  assert.equal(outcome.skipped, "no-span");
  assert.deepEqual([push.length, ntfy.length], [0, 0]);
});

test("the Mac's row is the installation's switch; the push and the topic are not gated by it", async () => {
  const { env, push, ntfy, local } = harness({ enabled: false });
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, env);
  assert.deepEqual(outcome.sent, { push: true, ntfy: true, local: false });
  assert.equal(local.length, 0);
  assert.equal(push.length + ntfy.length, 2);
});

test("a channel that fails is reported, not thrown", async () => {
  const { env, push } = harness({
    overrides: {
      notifyPush: async () => { throw new Error("Apple rejected the VAPID subject"); },
      publishNtfy: async () => { throw new Error("ntfy is unreachable"); },
      raiseLocal: async () => { throw new Error("osascript is gone"); },
    },
  });
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, env);
  assert.deepEqual(outcome.sent, { push: false, ntfy: false, local: false });
  assert.equal(push.length, 0);
});

test("the key is the run: a span is its fingerprint, the clock stands in when there is none", () => {
  const withSpan = runAnnounceKey("s-1", "complete", { status: "done", startedAt: STARTED, endedAt: ENDED }, ENDED);
  assert.equal(withSpan, runAnnounceKey("s-1", "complete", { status: "done", startedAt: STARTED, endedAt: ENDED }, ENDED + 1000));
  assert.notEqual(withSpan, runAnnounceKey("s-2", "complete", { status: "done", startedAt: STARTED, endedAt: ENDED }, ENDED));
  assert.notEqual(withSpan, runAnnounceKey("s-1", "failed", { status: "failed", startedAt: STARTED, endedAt: ENDED }, ENDED));

  const noSpanA = runAnnounceKey("s-1", "complete", { status: "done" }, ENDED);
  const noSpanB = runAnnounceKey("s-1", "complete", { status: "done" }, ENDED + 5_000);
  assert.equal(noSpanA, noSpanB, "two paths settling the same run a few seconds apart share one key");
  assert.notEqual(noSpanA, runAnnounceKey("s-1", "complete", { status: "done" }, ENDED + 60_000));
});

test("a dialog pushes once, and a session is not buzzed twice in ten minutes", async () => {
  const { env, push } = harness();
  const first = await announceAttention({ sessionId: "s-1", sessionName: "Work", prompt: "Trust this MCP server?", requestId: "req-1" }, env);
  assert.equal(first.skipped, undefined);
  assert.equal(push.length, 1);
  assert.equal(push[0].event.kind, "attention");
  assert.equal(push[0].event.detail, "Trust this MCP server?");

  // The same dialog replayed to a reconnecting page: no second push.
  assert.equal((await announceAttention({ sessionId: "s-1", sessionName: "Work", prompt: "Trust this MCP server?", requestId: "req-1" }, env)).skipped, "announced");
  assert.equal(push.length, 1);

  // A different dialog in the same session, inside the cooldown: no buzz.
  assert.equal((await announceAttention({ sessionId: "s-1", sessionName: "Work", prompt: "Pick one", requestId: "req-2" }, env)).skipped, "cooldown");
  assert.equal(push.length, 1, "this is the buzz people hear with no task running");

  // Past the cooldown, a session waiting again is worth saying again.
  const later = harness({ now: ENDED + ATTENTION_COOLDOWN_MS + 1000 });
  assert.equal((await announceAttention({ sessionId: "s-1", sessionName: "Work", prompt: "Pick one", requestId: "req-3" }, later.env)).skipped, undefined);
  assert.equal(later.push.length, 1);

  // A different session is not silenced by this one.
  const other = harness();
  assert.equal((await announceAttention({ sessionId: "s-2", sessionName: "Other", prompt: "Pick one", requestId: "req-4" }, other.env)).skipped, undefined);
  assert.equal(other.push.length, 1);
});

test("a caller that overrides parts keeps the parts it did not name", async () => {
  // The real callers pass no env at all. A caller that fakes the sending (a test, a caller
  // with its own clock) must not lose the clock or the sentence building.
  const sent = [];
  const outcome = await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } },
    {
      now: () => ENDED + 500,
      notifyPush: async () => { sent.push("push"); },
      publishNtfy: async () => { sent.push("ntfy"); return { sent: true, status: "sent" }; },
      raiseLocal: async () => { sent.push("local"); return true; },
    },
  );
  assert.deepEqual(sent, ["push", "ntfy", "local"]);
  assert.deepEqual(outcome.sent, { push: true, ntfy: true, local: true });
  assert.match(outcome.body, /The task lasted/, "the sentence is built by the real payload builder");
});

test("an unnamed session is titled by its first prompt, the sidebar's own rule", async () => {
  // A session nobody renamed, with "name sessions automatically" off, is still a finished
  // task the user wants to hear about. The sidebar row says "don't modify anything, …", so
  // the phone, the topic and Notification Center say the same.
  const { env, push, ntfy, local, titles } = harness({ sessionTitle: "don't modify anything, just say hi to me." });
  const outcome = await announceRunEnd({
    sessionId: "s-1",
    sessionName: null,
    outcome: { status: "done", startedAt: STARTED, endedAt: ENDED },
  }, env);

  assert.equal(outcome.skipped, undefined, "a session with no live name is not a reason for silence");
  assert.deepEqual(titles, ["s-1"], "the file's first prompt is asked for, once");
  for (const message of [ntfy[0], local[0]]) {
    assert.equal(message.title, "don't modify anything, just say hi to me.");
    assert.match(message.body, /^The task lasted 0h1m49s, started at /);
  }
  assert.equal(push[0].sessionName, "don't modify anything, just say hi to me.", "the phone's title matches");
});

test("the live session's name wins, and the file is not read for a title", async () => {
  const { env, ntfy, titles } = harness({ sessionTitle: "the first prompt" });
  await announceRunEnd({
    sessionId: "s-1",
    sessionName: "  Fix the parser  ",
    outcome: { status: "done", startedAt: STARTED, endedAt: ENDED },
  }, env);

  assert.equal(ntfy[0].title, "Fix the parser", "the user's own name, trimmed");
  assert.deepEqual(titles, [], "a named session never asks its own file");
});

test("a title read that fails stays silent: a broken read never becomes a fallback title", async () => {
  const attempted = [];
  const { env, push, local } = harness({
    overrides: {
      sessionTitle: async (sessionId) => {
        attempted.push(sessionId);
        throw new Error("session file unreadable");
      },
    },
  });
  const outcome = await announceRunEnd({
    sessionId: "s-2",
    sessionName: null,
    outcome: { status: "done", startedAt: STARTED, endedAt: ENDED },
  }, env);

  assert.equal(outcome.skipped, "unnamed");
  assert.deepEqual(attempted, ["s-2"], "the read was attempted, and its failure was swallowed");
  assert.deepEqual([push.length, local.length], [0, 0]);
});

test("a session that opened with a screenshot announces its finished run", async () => {
  // The real default readers, not a stub: the announcer resolves the session's path and titles
  // the run with its first prompt, and that prompt's JSONL line carries the screenshot's base64
  // (hundreds of KB). A reader that opens a fixed window of the file cuts that line in half,
  // the title comes back null, and the run announces nothing on any channel — which is the
  // report "four tasks were running, one finished, and nothing popped".
  const dir = await mkdtemp(join(tmpdir(), "pi-web-announce-screenshot-"));
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const sessionId = "0f100000-0000-7000-8000-000000000001";
    const fixtureCwd = "/tmp/pi-web-announce-screenshot-fixture";
    const sessionDir = join(dir, "sessions", `--${fixtureCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
    await mkdir(sessionDir, { recursive: true });
    const endedAt = Date.now() - 1_000;
    const startedAt = endedAt - 90_000;
    const lines = [
      JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date(startedAt).toISOString(), cwd: fixtureCwd }),
      JSON.stringify({
        type: "message", id: "m1", parentId: null, timestamp: new Date(startedAt).toISOString(),
        message: {
          role: "user",
          content: [
            { type: "text", text: "fix the agents panel\nsubagent   highlight, text, alignment" },
            { type: "image", data: "A".repeat(400 * 1024) },
          ],
        },
      }),
    ];
    await writeFile(join(sessionDir, `2026-01-27T08:00:00.000Z_${sessionId}.jsonl`), lines.join("\n") + "\n");

    // No harness: only the senders and the clock are fake. The session-path lookup, the
    // first-prompt title and the last-run span go through the announcer's own default readers.
    const ntfy = [];
    const local = [];
    const outcome = await announceRunEnd({
      sessionId,
      sessionName: null,
      outcome: { status: "done", startedAt, endedAt },
    }, {
      now: () => endedAt + 500,
      notifyPush: async () => undefined,
      publishNtfy: async (message) => { ntfy.push(message); return { sent: true, status: "sent" }; },
      raiseLocal: async (options) => { local.push(options); return true; },
      localSettings: () => ({ enabled: true, locale: "en" }),
    });

    assert.equal(outcome.skipped, undefined, "the screenshot in the first prompt is no reason for silence");
    assert.equal(ntfy[0].title, "fix the agents panel subagent highlight, text, alignment");
    assert.equal(local[0].title, ntfy[0].title, "Notification Center reads the row's own title");
    assert.match(ntfy[0].body, /^The task lasted 0h1m30s, started at /);
  } finally {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test("an untitled session says nothing: the title is the session's name", async () => {
  for (const sessionName of [null, undefined, "   "]) {
    resetCompletionAnnouncements();
    const { env, push, ntfy, local } = harness();
    const outcome = await announceRunEnd({ sessionId: "s-1", sessionName, outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, env);
    assert.equal(outcome.skipped, "unnamed", `${JSON.stringify(sessionName)}: no name and no prompt, no notification`);
    assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
      "no channel gets a \"Session complete\" row that cannot say which task it is");
  }
  // The run that gets a name is announced as usual, and the unnamed one did not spend the key.
  const named = harness();
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Fix the parser", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, named.env);
  assert.equal(outcome.skipped, undefined);
  assert.equal(named.ntfy[0].title, "Fix the parser");
});

test("a finished background task pops no notification: the conversation's end is announced, once, on every channel", async () => {
  // The shape the user reported: the prompt started three shell tasks and answered in fifteen
  // seconds while the tasks ran for two minutes. The old code said "The task lasted 0h2m24s" the
  // moment the last task settled, and the conversation's own end said it again 12 seconds later —
  // two rows in Notification Center, and the Safari push of the second arrived under the same tag
  // as the first, quietly. A finished task is news the card tells. The conversation finishing is
  // the notification, and it is the only one.
  let running = 1;
  const { env, push, ntfy, local } = harness({ overrides: { backgroundTasksRunning: () => running } });
  const first = await announceRunEnd(
    { sessionId: "s-1", sessionName: "Three tasks", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    env,
  );
  assert.equal(first.skipped, "background-tasks");
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
    "the run that only started the work says nothing about a task that has not finished");

  // The last task settles, and the bridge reports it. Nothing is said: the task manager is about to
  // ask the agent for a turn about the result, and that turn's end is the end of the job.
  running = 0;
  const settled = ENDED + 2 * 60_000;
  noteBackgroundTasksSettled("s-1", settled);
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
    "a finished background task pops no notification at all");

  // The turn that task woke ends. That is the conversation going quiet, and the notice the user is
  // owed is said: the kept run's start, this run's end — the whole job in one sentence, on the
  // phone, the topic, and this Mac, all at once.
  const wakeEnd = settled + 12_000;
  const outcome = await noteConversationRunSettled("s-1", { startedAt: settled + 1_000, endedAt: wakeEnd }, env);
  assert.equal(outcome?.skipped, undefined);
  assert.deepEqual(push[0].event, { kind: "complete", startedAt: STARTED, endedAt: wakeEnd },
    "one sentence about the whole job: the prompt's start, the conversation's end");
  assert.deepEqual([push.length, ntfy.length, local.length], [1, 1, 1], "push, ntfy and the Mac's row, once");

  // The rest of the wake-up burst has nothing left to spend: the notice was said.
  const after = await noteConversationRunSettled("s-1", { startedAt: wakeEnd + 1_000, endedAt: wakeEnd + 5_000 }, env);
  assert.equal(after, null, "the next turn the task manager woke has no notice of its own");
  assert.equal(push.length, 1, "one notification for one job");
});

test("a conversation with no turn to wake is announced when it goes quiet", async () => {
  // `notifyOnCompletion: false`, or a task started by an extension that wakes nothing: the last
  // task settles and no run follows, so the quiet window is the only thing that can say the notice.
  let running = 1;
  const { env, push, ntfy, local } = harness({ overrides: { backgroundTasksRunning: () => running } });
  assert.equal((await announceRunEnd(
    { sessionId: "s-1", sessionName: "One task", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    env,
  )).skipped, "background-tasks");
  running = 0;
  const settled = ENDED + 60_000;
  noteBackgroundTasksSettled("s-1", settled);
  assert.equal(push.length, 0, "the settlement itself is not an announcement");
  const outcome = await quietTick("s-1", env);
  assert.equal(outcome?.skipped, undefined, "the conversation is quiet, so the notice is due");
  assert.deepEqual(push[0].event, { kind: "complete", startedAt: STARTED, endedAt: settled });
  assert.deepEqual([push.length, ntfy.length, local.length], [1, 1, 1]);
});

test("the quiet window says nothing while the conversation works, and the cap never swallows a notice", async () => {
  const { env, push } = harness({ overrides: { backgroundTasksRunning: () => 1 } });
  assert.equal((await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    env,
  )).skipped, "background-tasks");
  assert.equal(await quietTick("s-1", env), null, "a task of this conversation is running: it is not over");
  assert.equal(push.length, 0);

  // A run of this conversation starting disarms the window; its end is the announcement.
  noteBackgroundTasksSettled("s-1", ENDED + 1_000);
  const cap = harness({ now: ENDED + DEFERRED_NOTICE_MAX_WAIT_MS + 1_000, overrides: { backgroundTasksRunning: () => 1 } });
  const outcome = await quietTick("s-1", cap.env);
  assert.equal(outcome?.skipped, undefined, "a task that never settles must not swallow the notice");
  assert.deepEqual(cap.push[0].event, { kind: "complete", startedAt: STARTED, endedAt: ENDED + DEFERRED_NOTICE_MAX_WAIT_MS + 1_000 },
    "at the cap the notice is news now, not a run this process is catching up on");
});

test("the turn a finished task woke says nothing when nothing of the user's is waiting on it", async () => {
  const { env, push, ntfy, local } = harness({ overrides: { runWokeByBackgroundTask: () => true, backgroundTasksObserved: () => false } });
  const outcome = await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: ENDED, endedAt: ENDED + 12_000 }, requestedAt: STARTED },
    env,
  );
  assert.equal(outcome.skipped, "machine-woken");
  assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
    "the card is where a finished task is read: no desktop row, no push, no ntfy");
});

test("a notice kept for a conversation that ended is dropped", async () => {
  let running = 1;
  const { env } = harness({ overrides: { backgroundTasksRunning: () => running } });
  assert.equal((await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    env,
  )).skipped, "background-tasks");
  releaseConversationCompletion("s-1");
  running = 0;
  noteBackgroundTasksSettled("s-1", ENDED + 1_000);
  const later = harness({ now: ENDED + 1_000, overrides: { backgroundTasksRunning: () => 0 } });
  assert.equal(await quietTick("s-1", later.env), null, "a released conversation has nobody to notify");
  assert.equal(await noteConversationRunSettled("s-1", { endedAt: ENDED + 2_000 }, later.env), null);
  assert.equal(later.push.length, 0);
});

test("the push channel reports what the push service answered", async () => {
  // Three silences that used to be one: nobody subscribed, and every device refused. `sent.push`
  // claims the truth, and the server's log names the endpoints, so "Safari never buzzed" is a line
  // in the log and not a theory.
  const refused = harness({
    overrides: {
      notifyPush: async () => ({
        attempted: 2, sent: 0, pruned: 0,
        failures: [{ endpoint: "https://web.push.apple.com/QAAAA", statusCode: 403 }],
      }),
    },
  });
  const outcome = await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    refused.env,
  );
  assert.equal(outcome.sent.push, false, "no device took the message, so the push channel did not answer");
  assert.equal(outcome.sent.ntfy, true, "the other channels are their own news");

  const nobody = harness({ overrides: { notifyPush: async () => ({ attempted: 0, sent: 0, pruned: 0, failures: [] }) } });
  const second = await announceRunEnd(
    { sessionId: "s-2", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    nobody.env,
  );
  assert.equal(second.sent.push, false, "no subscription is not a delivered notification");
});

test("the quiet window is a real timer, and a run of the conversation disarms it", async () => {
  // The timers are the part a fake clock never exercises. A conversation that goes quiet is
  // announced by the window itself; one that starts a run is announced by that run, not the timer.
  const quietMs = CONVERSATION_QUIET_MS;
  assert.ok(quietMs > 0 && quietMs < 60_000, "the window is short enough to be the app's latency, long enough to catch the turn a task wakes");
  let running = 1;
  const { env, push } = harness({ overrides: { backgroundTasksRunning: () => running } });
  assert.equal((await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED }, requestedAt: STARTED },
    env,
  )).skipped, "background-tasks");
  running = 0;
  noteBackgroundTasksSettled("s-1", Date.now());
  assert.equal(push.length, 0, "the window has not closed yet");
  await new Promise((resolve) => setTimeout(resolve, quietMs + 300));
  assert.equal(push.length, 1, "the quiet window closed on a conversation with nothing running: the notice is said");
});

test("one notice per session per window, where background work is producing the runs", async () => {
  // The task manager settles a run per finished task; the user asked once. A conversation the
  // extensions have background work for is announced by the quiet window, so that is the path the
  // burst travels, and the window is what keeps it to one notice.
  const overrides = { backgroundTasksObserved: () => true };
  const first = harness({ overrides });
  assert.equal((await announceRunEnd({ sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, first.env)).skipped, "background-tasks",
    "a conversation with background work is never announced on the moment its answer lands");
  assert.equal((await quietTick("s-1", first.env))?.skipped, undefined);
  assert.equal(first.push.length, 1);
  // A queued prompt in the same session finishes a moment later. The task the user is waiting for
  // has been announced; a second row of the same sentence about the same session is noise.
  const second = harness({ now: ENDED + 5_000, overrides });
  assert.equal((await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: ENDED, endedAt: ENDED + 5_000 } },
    second.env,
  )).skipped, "background-tasks");
  assert.equal((await quietTick("s-1", second.env))?.skipped, "cooldown");
  assert.equal(second.push.length, 0);
  // Past the window the session is owed its notice again.
  const later = harness({ now: ENDED + COMPLETION_NOTICE_COOLDOWN_MS + 1_000, overrides });
  assert.equal((await announceRunEnd(
    { sessionId: "s-1", sessionName: "Work", outcome: { status: "done", startedAt: ENDED + 6_000, endedAt: ENDED + COMPLETION_NOTICE_COOLDOWN_MS + 1_000 } },
    later.env,
  )).skipped, "background-tasks");
  assert.equal((await quietTick("s-1", later.env))?.skipped, undefined);
  assert.equal(later.push.length, 1);
});

test("another session's notice is not this session's cooldown", async () => {
  const a = harness();
  assert.equal((await announceRunEnd({ sessionId: "s-1", sessionName: "One", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, a.env)).skipped, undefined);
  const b = harness({ overrides: { backgroundTasksRunning: () => 0 } });
  assert.equal((await announceRunEnd({ sessionId: "s-2", sessionName: "Two", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, b.env)).skipped, undefined);
  assert.equal(b.push.length, 1);
});

test("a session with no background work is owed a notice for every finished task", async () => {
  // The cooldown is for the burst a task manager produces, not a rule about sessions: two prompts
  // in a row, with no background tasks, are two finished tasks and both are news.
  const a = harness();
  assert.equal((await announceRunEnd({ sessionId: "s-1", sessionName: "One", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, a.env)).skipped, undefined);
  const b = harness({ now: ENDED + 3_000 });
  assert.equal((await announceRunEnd({ sessionId: "s-1", sessionName: "One", outcome: { status: "done", startedAt: ENDED, endedAt: ENDED + 3_000 } }, b.env)).skipped, undefined);
  assert.equal(b.push.length, 1);
});

test("a re-armed quiet window keeps the channels of the run it is holding", async () => {
  // The bridge's timers carry no channels of their own. The kept notice must keep the ones its
  // conversation's run chose, or a re-arm (a task still running when the window closed) sends the
  // user's notification through this process's real push, ntfy and Notification Center.
  let running = 1;
  const { env, push, ntfy, local } = harness({ overrides: { backgroundTasksRunning: () => running } });
  const request = {
    sessionId: "s-1",
    sessionName: "Work",
    outcome: { status: "done", startedAt: STARTED, endedAt: ENDED },
    requestedAt: STARTED,
  };
  assert.equal((await announceRunEnd(request, env)).skipped, "background-tasks");
  assert.equal(await quietTick("s-1", env), null, "a task is still running: the window re-arms and says nothing");
  running = 0;
  const outcome = await quietTick("s-1");
  assert.equal(outcome?.skipped, undefined, "the notice is said when the window closes on a quiet conversation");
  assert.equal(push.length, 1, "the push goes to the channel the conversation chose, not to this process's real one");
  assert.equal(ntfy.length, 1);
  assert.equal(local.length, 1);
});
