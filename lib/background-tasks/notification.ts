/**
 * The message `pi-background-tasks` injects when one of its tasks finishes.
 *
 * The extension's completion notice is a custom message in the conversation
 * (`customType: "background-task-notification"`), written for a terminal where a finished task
 * has nowhere else to be seen. Here it has somewhere else: the header's Background Tasks card
 * lists the task, its status, its exit and its output, and its row wears the unacknowledged
 * failure mark the extension's dock wears. So the chat does not repeat it — the conversation
 * keeps running, and its own replies stay the only thing that appears in it.
 *
 * Nothing is deleted: the record stays in the session file, in the transcript, in the export
 * and in what the model was shown. Only the chat card is left out, and it is left out by the
 * extension's own type name, so an unrelated custom message is untouched.
 */
export const BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE = "background-task-notification";

/** True for the extension's finished-task message, the one the card reports instead. */
export function isBackgroundTaskNotification(customType: string | undefined): boolean {
  return customType === BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE;
}
