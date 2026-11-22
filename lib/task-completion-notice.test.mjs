import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { formatClockTime } from "./completion-notification.ts";

// The subject is a browser module (it reaches for Notification and fetch), so it is
// loaded the way the other browser modules are: through jiti.
const {
  COMPLETION_NOTICE_MAX_AGE_MS,
  completionNoticeTag,
  notifyTaskCompletion,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./task-completion-notice.ts");

// One notice per finished task, said the same way on every channel. The three rules
// that matter to a person, not to a log:
//   - a task that has no numbers says nothing (never "0h0m0s"),
//   - a run that finished while the page was catching up is not announced
//     (that is the notification people read as "there was no task"),
//   - a finished run is announced once, whatever path reported its end.

const MESSAGES = {
  "i18n.sessionComplete": "Session complete",
  "safariNotify.summary": "The task lasted {duration}, started at {started}, and ended at {ended}. This notification pops up at {now}.",
};

const translate = (key) => MESSAGES[key] ?? key;
const ENDED = Date.parse("2026-01-27T08:14:51.000Z");
const STARTED = ENDED - (1 * 60 + 49) * 1000;

function harness(overrides = {}) {
  const local = [];
  const ntfy = [];
  const pages = [];
  const deps = {
    translate,
    locale: "en-US",
    now: ENDED + 500,
    localEnabled: () => true,
    sendLocal: async (options) => { local.push(options); return true; },
    sendNtfy: async (options) => { ntfy.push(options); return { sent: true }; },
    showPage: async (options) => { pages.push(options); return "window"; },
    attentionState: { visibilityState: "hidden", hasFocus: () => false },
    notified: new Set(),
    ...overrides,
  };
  return { deps, local, ntfy, pages };
}

test("a finished task says the same sentence on every channel", async () => {
  const { deps, local, ntfy, pages } = harness();
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Project Skill Behavior", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.equal(outcome.skipped, undefined);
  assert.deepEqual(outcome.sent, { local: true, ntfy: true, page: true });

  const sentence = `The task lasted 0h1m49s, started at ${formatClockTime(STARTED, "en-US")}, and ended at ${formatClockTime(ENDED, "en-US")}. This notification pops up at ${formatClockTime(ENDED + 500, "en-US")}.`;
  for (const [channel, sent] of [["local", local[0]], ["ntfy", ntfy[0]], ["page", pages[0]]]) {
    assert.equal(sent.title, "Project Skill Behavior", `${channel} is titled with the session's name`);
    assert.equal(sent.body, sentence, `${channel} carries the sentence and nothing beside it`);
  }
  assert.equal(pages[0].tag, completionNoticeTag("s-1"), "the banner is tagged, so the next task replaces it");
  assert.match(pages[0].sessionUrl, /session=s-1/);
});

test("the window in the foreground gets no banner; the Mac and the phone still hear about it", async () => {
  const { deps, local, ntfy, pages } = harness({ attentionState: { visibilityState: "visible", hasFocus: () => true } });
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.deepEqual(outcome.sent, { local: true, ntfy: true, page: false });
  assert.equal(pages.length, 0, "an answer you are looking at needs no banner");
  assert.equal(local.length + ntfy.length, 2);
});

test("the section switched off sends nothing local, and ntfy is still asked", async () => {
  const { deps, local, ntfy, pages } = harness({ localEnabled: () => false });
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.deepEqual(outcome.sent, { local: false, ntfy: true, page: false });
  assert.equal(local.length, 0);
  assert.equal(pages.length, 0);
  assert.equal(ntfy.length, 1, "ntfy has its own switch, on the server");
});

test("a task started elsewhere gets its numbers from the session file", async () => {
  const asked = [];
  const { deps, local } = harness({
    fetchLastRun: async (sessionId) => { asked.push(sessionId); return { startedAt: STARTED, endedAt: ENDED }; },
  });
  // The page never saw this run begin (a phone over the relay, a queued prompt, a reload).
  const outcome = await notifyTaskCompletion({ sessionId: "s-9", sessionName: "From the phone", end: { aborted: false } }, deps);
  assert.deepEqual(asked, ["s-9"]);
  assert.deepEqual(outcome.times, { startedAt: STARTED, endedAt: ENDED });
  assert.equal(local.length, 1, "it is announced, which is what used to go missing");
  assert.match(local[0].body, /The task lasted 0h1m49s/);
});

test("a task with no numbers says nothing", async () => {
  const { deps, local, ntfy, pages } = harness({ fetchLastRun: async () => null });
  const outcome = await notifyTaskCompletion({ sessionId: "s-1", sessionName: "Work", end: { aborted: false } }, deps);
  assert.equal(outcome.skipped, "no-times");
  assert.deepEqual([local.length, ntfy.length, pages.length], [0, 0, 0]);
});

test("a run that finished while the page was catching up is silent", async () => {
  const longAgo = ENDED - 2 * 60 * 60 * 1000;
  const stale = harness();
  const first = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: longAgo - 60_000, endedAt: longAgo } },
    stale.deps,
  );
  assert.equal(first.skipped, "stale");
  assert.deepEqual([stale.local.length, stale.ntfy.length, stale.pages.length], [0, 0, 0],
    "this is the notification people read as \u201cthere was no task\u201d");

  const byFile = harness({ fetchLastRun: async () => ({ startedAt: longAgo - 60_000, endedAt: longAgo }) });
  assert.equal((await notifyTaskCompletion({ sessionId: "s-1", sessionName: "Work", end: { aborted: false } }, byFile.deps)).skipped, "stale");

  // The window itself is the rule, and a run inside it is announced.
  const justNow = ENDED - COMPLETION_NOTICE_MAX_AGE_MS + 60_000;
  const inside = harness();
  const insideOutcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: justNow - 30_000, endedAt: justNow } },
    inside.deps,
  );
  assert.equal(insideOutcome.skipped, undefined);
});

test("a finished run is announced once, whatever path reported its end", async () => {
  const { deps, local, ntfy, pages } = harness();
  const request = { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } };
  assert.equal((await notifyTaskCompletion(request, deps)).skipped, undefined);
  const second = await notifyTaskCompletion(request, deps);
  assert.equal(second.skipped, "notified");
  assert.equal(local.length, 1);
  assert.equal(ntfy.length, 1);
  assert.equal(pages.length, 1);
  // A different end time is a different task, and is announced.
  const third = { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: ENDED, endedAt: ENDED + 60_000 } };
  assert.equal((await notifyTaskCompletion(third, deps)).skipped, undefined);
  assert.equal(local.length, 2);
});

test("a stopped run announces nothing", async () => {
  const { deps, local, ntfy, pages } = harness();
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: true, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.equal(outcome.skipped, "aborted");
  assert.deepEqual([local.length, ntfy.length, pages.length], [0, 0, 0]);
});

test("a session with no name is titled by the app's own words", async () => {
  const { deps, local } = harness();
  await notifyTaskCompletion({ sessionId: null, sessionName: "   ", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } }, deps);
  assert.equal(local[0].title, "Session complete");
  assert.equal(completionNoticeTag(null), "pi-task-complete:current");
});

test("a channel that fails does not break the finished task's handler", async () => {
  const { deps, ntfy } = harness({
    sendLocal: async () => { throw new Error("osascript is gone"); },
    sendNtfy: async (options) => { ntfy.push(options); return { sent: false, error: "timed out" }; },
    showPage: async () => { throw new Error("no Notification constructor"); },
  });
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.deepEqual(outcome.sent, { local: false, ntfy: false, page: false });
  assert.equal(ntfy.length, 1);
});

test("a span that cannot be a run is not a task", async () => {
  const { deps, local } = harness();
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: ENDED, endedAt: STARTED } },
    deps,
  );
  assert.equal(outcome.skipped, "no-times", "an end before the start is not a span");
  assert.equal(local.length, 0);
});
