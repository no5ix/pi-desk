import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { formatClockTime } from "./completion-notification.ts";

// The subject is a browser module (it reaches for Notification and fetch), so it is
// loaded the way the other browser modules are: through jiti.
const {
  COMPLETION_NOTICE_MAX_AGE_MS,
  NO_TIMES_NOTICE_BUCKET_MS,
  completionNoticeTag,
  notifyTaskCompletion,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./task-completion-notice.ts");

// The banner this browser shows for a finished task. The task itself is announced by the
// server (lib/task-completion-server.test.mjs pins that), and what is left here is the
// part no server can do: put a banner in the browser the user is looking at. The rules
// that matter to a person:
//   - a run with no numbers says the short sentence, it does not go silent,
//   - a run this page is only catching up on is not announced
//     (that is the notification people read as "there was no task"),
//   - a finished run is announced once, whatever path reported its end,
//   - one banner: the tag is the push payload's tag, so the push for the same completion
//     replaces this banner instead of alerting beside it (#1515).

const MESSAGES = {
  "i18n.sessionComplete": "Session complete",
  "i18n.taskFinished": "Task finished.",
  "safariNotify.summary": "The task lasted {duration}, started at {started}, and ended at {ended}. This notification pops up at {now}.",
};

const translate = (key) => MESSAGES[key] ?? key;
const ENDED = Date.parse("2026-01-27T08:14:51.000Z");
const STARTED = ENDED - (1 * 60 + 49) * 1000;

function harness(overrides = {}) {
  const pages = [];
  const deps = {
    translate,
    locale: "en-US",
    now: ENDED + 500,
    pageEnabled: () => true,
    showPage: async (options) => { pages.push(options); return "window"; },
    attentionState: { visibilityState: "hidden", hasFocus: () => false },
    notified: new Set(),
    ...overrides,
  };
  return { deps, pages };
}

const finished = (overrides = {}) => ({
  sessionId: "s-1",
  sessionName: "Work",
  end: { aborted: false, startedAt: STARTED, endedAt: ENDED },
  ...overrides,
});

test("a finished task raises the banner in the session's words", async () => {
  const { deps, pages } = harness();
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Project Skill Behavior", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.equal(outcome.skipped, undefined);
  assert.deepEqual(outcome.sent, { page: true });

  const sentence = `The task lasted 0h1m49s, started at ${formatClockTime(STARTED, "en-US")}, and ended at ${formatClockTime(ENDED, "en-US")}. This notification pops up at ${formatClockTime(ENDED + 500, "en-US")}.`;
  assert.equal(pages[0].title, "Project Skill Behavior", "the banner is titled with the session's name");
  assert.equal(pages[0].body, sentence, "the banner carries the sentence and nothing beside it");
  assert.equal(pages[0].tag, completionNoticeTag("s-1"), "the banner is tagged, so the next task replaces it");
  assert.match(pages[0].sessionUrl, /session=s-1/);
});

test("the tag is the push payload's tag, so one finished task is one banner (#1515)", async () => {
  const { sessionNotificationTag } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./notification-tags.ts");
  const { sessionPushPayload } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./web-push.ts");
  const pageTag = completionNoticeTag("s-1");
  assert.equal(pageTag, sessionNotificationTag("s-1"));
  assert.equal(sessionPushPayload("s-1", "Work", { kind: "complete" }, "en").tag, pageTag,
    "the page's banner and the server's push share the tag: the worker's 10-second rule looks it up by tag");
  assert.equal(completionNoticeTag(null), sessionNotificationTag(null));
});

test("the window in the foreground gets no banner", async () => {
  const { deps, pages } = harness({ attentionState: { visibilityState: "visible", hasFocus: () => true } });
  const outcome = await notifyTaskCompletion(finished(), deps);
  assert.equal(outcome.skipped, "foreground");
  assert.deepEqual(outcome.sent, { page: false });
  assert.equal(pages.length, 0, "an answer you are looking at needs no banner");
});

test("this browser's switch switched off sends nothing", async () => {
  const { deps, pages } = harness({ pageEnabled: () => false });
  const outcome = await notifyTaskCompletion(finished(), deps);
  assert.equal(outcome.skipped, "off");
  assert.equal(pages.length, 0);
});

test("a task started elsewhere gets its numbers from the session file", async () => {
  const asked = [];
  const { deps, pages } = harness({
    fetchLastRun: async (sessionId) => { asked.push(sessionId); return { startedAt: STARTED, endedAt: ENDED }; },
  });
  // The page never saw this run begin (a phone over the relay, a queued prompt, a reload).
  const outcome = await notifyTaskCompletion({ sessionId: "s-9", sessionName: "From the phone", end: { aborted: false } }, deps);
  assert.deepEqual(asked, ["s-9"]);
  assert.deepEqual(outcome.times, { startedAt: STARTED, endedAt: ENDED });
  assert.equal(pages.length, 1, "it is announced, which is what used to go missing");
  assert.match(pages[0].body, /The task lasted 0h1m49s/);
});

test("a task with no numbers says the short sentence, once per window", async () => {
  const { deps, pages } = harness({ fetchLastRun: async () => null });
  const outcome = await notifyTaskCompletion({ sessionId: "s-1", sessionName: "Work", end: { aborted: false } }, deps);
  assert.equal(outcome.skipped, undefined, "the page watched this run end: silence is what the \u201cno notification at all\u201d report came from");
  assert.equal(pages[0].title, "Work");
  assert.equal(pages[0].body, "Task finished.");
  assert.deepEqual(outcome.sent, { page: true });

  // The same run reported by a second path, inside the window, is one banner.
  const again = { sessionId: "s-1", sessionName: "Work", end: { aborted: false } };
  assert.equal((await notifyTaskCompletion(again, deps)).skipped, "notified");
  assert.equal(pages.length, 1);

  // Past the window, a fresh run with no numbers is announced again.
  const later = harness({ fetchLastRun: async () => null, now: ENDED + NO_TIMES_NOTICE_BUCKET_MS });
  await notifyTaskCompletion({ sessionId: "s-1", sessionName: "Work", end: { aborted: false } }, later.deps);
  assert.equal(later.pages.length, 1);
});

test("a run read out of the file that finished while the page was catching up is silent", async () => {
  const longAgo = ENDED - 2 * 60 * 60 * 1000;
  const stale = harness();
  const first = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: longAgo - 60_000, endedAt: longAgo } },
    stale.deps,
  );
  assert.equal(first.skipped, undefined,
    "a span the page timed itself is this page's own run: a three-hour task is announced when it lands");

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
  const { deps, pages } = harness();
  const request = finished();
  assert.equal((await notifyTaskCompletion(request, deps)).skipped, undefined);
  assert.equal((await notifyTaskCompletion(request, deps)).skipped, "notified");
  assert.equal(pages.length, 1);
  // A different end time is a different task, and is announced.
  const third = { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: ENDED, endedAt: ENDED + 60_000 } };
  assert.equal((await notifyTaskCompletion(third, deps)).skipped, undefined);
  assert.equal(pages.length, 2);
});

test("a stopped run announces nothing", async () => {
  const { deps, pages } = harness();
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: true, startedAt: STARTED, endedAt: ENDED } },
    deps,
  );
  assert.equal(outcome.skipped, "aborted");
  assert.equal(pages.length, 0);
});

test("a session with no name is titled by the app's own words", async () => {
  const { deps, pages } = harness();
  await notifyTaskCompletion({ sessionId: null, sessionName: "   ", end: { aborted: false, startedAt: STARTED, endedAt: ENDED } }, deps);
  assert.equal(pages[0].title, "Session complete");
  assert.equal(completionNoticeTag(null), "pi-session-complete:current");
});

test("the channel failing does not break the finished task's handler", async () => {
  const { deps } = harness({
    showPage: async () => { throw new Error("no Notification constructor"); },
  });
  const outcome = await notifyTaskCompletion(finished(), deps);
  assert.deepEqual(outcome.sent, { page: false });
});

test("an impossible span is not a span, and the run is still announced", async () => {
  const { deps, pages } = harness();
  const outcome = await notifyTaskCompletion(
    { sessionId: "s-1", sessionName: "Work", end: { aborted: false, startedAt: ENDED, endedAt: STARTED } },
    deps,
  );
  assert.equal(outcome.times, undefined, "an end before the start is not a span");
  assert.equal(pages[0].body, "Task finished.", "no numbers, so the short sentence: the page saw the run end");
});
