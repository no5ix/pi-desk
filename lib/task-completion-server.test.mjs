import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// The server's own announcement of a finished run: the phone push, the ntfy message and the
// Mac's Notification Center row, sent by the process that owns the run so they arrive with
// no browser page open. One announcement per run, none for a run this process is only
// catching up on, none for a run the user stopped, and none that cannot speak the format:
// the title is the session's name and the content is the run's one sentence, so an unnamed
// session or a run with no span stays silent.
const {
  ATTENTION_COOLDOWN_MS,
  announceAttention,
  announceRunEnd,
  resetCompletionAnnouncements,
  runAnnounceKey,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./task-completion-server.ts");

const ENDED = Date.parse("2026-01-27T08:14:51.000Z");
const STARTED = ENDED - (1 * 60 + 49) * 1000;

function harness({ enabled = true, locale = "en", now = ENDED + 500, lastRun = null, overrides = {} } = {}) {
  const push = [];
  const ntfy = [];
  const local = [];
  const env = {
    now: () => now,
    notifyPush: async (sessionId, event, sessionName) => { push.push({ sessionId, event, sessionName }); },
    publishNtfy: async (message) => { ntfy.push(message); return { sent: true, status: "sent" }; },
    raiseLocal: async (options) => { local.push(options); return true; },
    localSettings: () => ({ enabled, locale }),
    lastRun: async () => lastRun,
    ...overrides,
  };
  return { env, push, ntfy, local };
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

test("an untitled session says nothing: the title is the session's name", async () => {
  for (const sessionName of [null, undefined, "   "]) {
    resetCompletionAnnouncements();
    const { env, push, ntfy, local } = harness();
    const outcome = await announceRunEnd({ sessionId: "s-1", sessionName, outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, env);
    assert.equal(outcome.skipped, "unnamed", `${JSON.stringify(sessionName)}: no name, no notification`);
    assert.deepEqual([push.length, ntfy.length, local.length], [0, 0, 0],
      "no channel gets a \"Session complete\" row that cannot say which task it is");
  }
  // The run that gets a name is announced as usual, and the unnamed one did not spend the key.
  const named = harness();
  const outcome = await announceRunEnd({ sessionId: "s-1", sessionName: "Fix the parser", outcome: { status: "done", startedAt: STARTED, endedAt: ENDED } }, named.env);
  assert.equal(outcome.skipped, undefined);
  assert.equal(named.ntfy[0].title, "Fix the parser");
});
