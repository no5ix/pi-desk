import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE, isBackgroundTaskNotification } =
  await jiti.import("./notification.ts");

/**
 * The extension's own completion notice, recognised so the chat can leave it out.
 *
 * `pi-background-tasks` appends a custom message when a task finishes, aimed at a terminal's
 * status line. In this app a finished task is news the card already carries — its row moves to
 * done, its exit code and its log are there, and the header chip keeps the unacknowledged
 * failure — so the same news printed into the conversation is a second notice of one event, in
 * the place where the user is writing the next prompt. The card is the announcer.
 *
 * The rule that makes hiding it safe lives here: the name is the extension's, matched exactly,
 * and only that name. Every other custom message — a subagent's report, an extension's own card
 * — reaches the chat exactly as it always did.
 */

test("the completion notice is named exactly, and nothing else is", () => {
  assert.equal(BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE, "background-task-notification");
  assert.equal(isBackgroundTaskNotification("background-task-notification"), true);

  for (const customType of [
    undefined,
    null,
    "",
    "background-task",
    "background-tasks-notification",
    "background-task-notification-v2",
    "subagent-report",
    "  background-task-notification  ",
    "BACKGROUND-TASK-NOTIFICATION",
  ]) {
    assert.equal(isBackgroundTaskNotification(customType), false, `${String(customType)} is not the notice`);
  }
});

test("the chat leaves that notice out, and shows every other custom message", () => {
  const messages = readFileSync(new URL("../../components/MessageView.tsx", import.meta.url), "utf8");
  // The hide is the first thing done with a custom message, and it is keyed on the one name.
  assert.match(
    messages,
    /if \(isBackgroundTaskNotification\(\(message as CustomMessage\)\.customType\)\) return null;/,
  );
  // The custom-message renderer is still there for every other extension message: a subagent's
  // report card and an extension's own card are news of their own, and are not this notice.
  assert.match(messages, /function CustomMessageView/);
  const hideIndex = messages.indexOf("isBackgroundTaskNotification((message as CustomMessage).customType)");
  const rendererIndex = messages.indexOf("function CustomMessageView");
  assert.ok(hideIndex > 0 && rendererIndex > 0 && hideIndex < rendererIndex, "the notice is dropped before the renderer runs");
});
