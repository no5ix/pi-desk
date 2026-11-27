/**
 * A limited chat has no shell. When the model asks for one, the server refuses the call
 * with a reason that starts with this marker, and the conversation page uses it to offer
 * "allow this chat to use my computer" right where the need came up. Client-safe.
 */
export const CHAT_SHELL_BLOCK_MARKER = "[chat-no-shell]";

interface ToolResultLike {
  role: string;
  content?: unknown;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && typeof block === "object" && (block as { type?: string }).type === "text"
      ? String((block as { text?: unknown }).text ?? "")
      : ""))
    .join("");
}

/** Whether a shell call was refused during the latest turn (after the last user message). */
export function lastTurnHitChatShellBlock(messages: readonly ToolResultLike[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return false;
    if (message.role === "toolResult" && textOf(message.content).includes(CHAT_SHELL_BLOCK_MARKER)) return true;
  }
  return false;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The tool the latest reply is about, when it is one this chat withholds; null when it is not.
 *
 * A chat does not declare an installed extension's tools, so the model cannot call one and says
 * so — in a developer's words, "re-expose the `bg_run` tool", when the app has a switch the user
 * can reach and a project to open. The reply naming the tool is the need: finding it lets the
 * same offer appear where the need came up, instead of leaving the user with a paragraph about
 * function lists.
 *
 * Deliberately narrow. Only the reply's own words count (a tool result is the extension talking,
 * and the scan stops at the user's message, so the prompt that asked for the tool is not the
 * evidence), only whole names count (`bg_run` does not match `bg_runner`), and a tool the chat
 * has is never in the list it is measured against.
 */
export function lastTurnNamesUnavailableTool(
  messages: readonly ToolResultLike[],
  unavailableToolNames: readonly string[],
): string | null {
  const names = unavailableToolNames.filter((name) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(name));
  if (names.length === 0) return null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") return null;
    if (message.role !== "assistant") continue;
    const text = textOf(message.content);
    if (!text) continue;
    for (const name of names) {
      if (new RegExp(`(^|[^A-Za-z0-9_])${escapeForRegExp(name)}([^A-Za-z0-9_]|$)`).test(text)) return name;
    }
  }
  return null;
}
