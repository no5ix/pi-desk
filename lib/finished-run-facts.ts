import type { AgentMessage, AssistantMessage } from "./types";

/**
 * What the run that just ended was, for the notification rules.
 *
 * A run whose newest anchor is a subagent's report answered that report: it is the
 * subagent's ending, not the end of a task the user is waiting on, and the user asked for
 * no notice when a subagent ends. A run whose last reply carries an error failed: the
 * provider's failure text belongs in the chat, not in a notification.
 *
 * Neither is announced. This is the page's own view (its banner, `components/AppShell.tsx`);
 * the server decides the same two ways from its side (`lib/subagent-report-runs.ts` marks
 * the report's run, `lib/task-completion-server.ts` skips a failure), so no channel says
 * what this page would say.
 */
export function finishedRunFacts(messages: readonly AgentMessage[]): { answeredSubagentReport: boolean; failed: boolean } {
  let promptIdx = -1;
  let reportIdx = -1;
  for (let idx = messages.length - 1; idx >= 0; idx--) {
    const message = messages[idx];
    if (promptIdx < 0 && getUserPromptText(message) !== null) promptIdx = idx;
    if (reportIdx < 0 && isSubagentReportMessage(message)) reportIdx = idx;
    if (promptIdx >= 0 && reportIdx >= 0) break;
  }
  const last = messages[messages.length - 1];
  const failed = last?.role === "assistant" && Boolean((last as AssistantMessage).errorMessage);
  return { answeredSubagentReport: reportIdx > promptIdx, failed };
}

/** The text of a user prompt, and null for a custom message, a notice, an empty entry. */
function getUserPromptText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  const text = typeof message.content === "string"
    ? message.content
    : message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  return text.trim().length > 0 ? text.trim() : null;
}

/** The card a finished subagent leaves in its parent's conversation. */
function isSubagentReportMessage(message: AgentMessage): boolean {
  return message.role === "custom"
    && (message.customType === "pi-web:subagent-notification" || message.customType === "subagent-notification");
}
