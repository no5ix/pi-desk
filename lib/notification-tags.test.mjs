import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

// One finished task, several senders: the page's banner, the server's push payload, and the
// service worker that turns a push into a notification. They cannot see each other, and the
// only thing they share is the tag and the two windows. A worker script is standalone
// (`public/sw.js` cannot import this file), so the numbers are repeated in it — and this is
// the test that fails when they drift.

const {
  COMPLETION_NOTICE_MAX_AGE_MS,
  LATE_PUSH_MAX_AGE_MS,
  LATE_PUSH_TAG,
  PUSH_TTL_SECONDS,
  RECENT_NOTIFICATION_MS,
  SESSION_TAG_PREFIX,
  sessionNotificationTag,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./notification-tags.ts");

const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function workerConstant(name) {
  const match = worker.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, `public/sw.js declares ${name}`);
  return match[1].trim();
}

test("a session's tag is built from one prefix, and an unnamed session still gets one", () => {
  assert.equal(sessionNotificationTag("abc"), "pi-session-complete:abc");
  assert.equal(sessionNotificationTag(null), `${SESSION_TAG_PREFIX}current`);
  assert.equal(sessionNotificationTag("  "), `${SESSION_TAG_PREFIX}current`);
  assert.equal(sessionNotificationTag(undefined), `${SESSION_TAG_PREFIX}current`);
});

test("the worker repeats the shared tag and windows, not a private copy", () => {
  assert.equal(workerConstant("RECENT_NOTIFICATION_MS"), String(RECENT_NOTIFICATION_MS));
  assert.equal(workerConstant("LATE_PUSH_MAX_AGE_MS"), String(LATE_PUSH_MAX_AGE_MS));
  assert.equal(workerConstant("LATE_PUSH_TAG"), `"${LATE_PUSH_TAG}"`);
  assert.match(worker, /tag: LATE_PUSH_TAG/, "a late push collapses under the catch-up tag");
});

test("a push that arrives late is a queued delivery, and is shown quiet and collapsed", () => {
  // iOS revokes a subscription when a push is handled without a notification, so the late
  // path shows one — silently, under one tag — instead of suppressing it.
  const late = worker.match(/function showPushNotification[\s\S]*?\n}/);
  assert.ok(late, "showPushNotification found");
  assert.match(late[0], /sentAt/, "the payload's send stamp decides");
  assert.match(late[0], /shownAt - sentAt > LATE_PUSH_MAX_AGE_MS/);
  assert.match(late[0], /silent: true/);
  assert.match(late[0], /renotify: false/);
});

test("the TTL is short enough that a phone offline for a day does not inherit its whole week", () => {
  assert.ok(PUSH_TTL_SECONDS > 0 && PUSH_TTL_SECONDS <= 15 * 60, `PUSH_TTL_SECONDS=${PUSH_TTL_SECONDS}`);
  // The collapse window and the TTL are the same decision seen from the two ends.
  assert.ok(LATE_PUSH_MAX_AGE_MS >= PUSH_TTL_SECONDS * 1000);
});

test("the staleness window is the same rule on both sides", () => {
  assert.equal(COMPLETION_NOTICE_MAX_AGE_MS, 5 * 60_000);
  const page = readFileSync(new URL("./task-completion-notice.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("./task-completion-server.ts", import.meta.url), "utf8");
  assert.match(page, /COMPLETION_NOTICE_MAX_AGE_MS/);
  assert.match(server, /COMPLETION_NOTICE_MAX_AGE_MS/);
  assert.doesNotMatch(`${LATE_PUSH_TAG}`, /task-complete/, "the catch-up tag is the one name; the old page tag is gone");
});
