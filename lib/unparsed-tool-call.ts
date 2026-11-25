/**

 *
 * A small model served from a GGUF file writes the XML tool-call grammar of its
 * chat template badly: the `antml:` namespace is gone, `<parameter=path>` is
 * closed by `</parameter>`, the call opens with `<tool_call>` and closes with
 * `</function>`. Nothing parses that, so the call stays a plain text block. The
 * reply then carries zero tool calls, the provider reported a normal stop, and
 * pi ends the run: the agent stops mid-thought with its next tool call printed
 * as prose, and the user sees an interruption with no explanation.
 *
 * The rule lives here, pure and importable by the browser, and
 * `lib/unparsed-tool-call-extension.ts` acts on it at pi's settle boundary.
 */

/** The custom message the settle boundary appends, and the card the chat draws for it. */
export const UNPARSED_TOOL_CALL_CUSTOM_TYPE = "pi-web:unparsed-tool-call";

/** A call a model printed as text, as far as it can be recovered. */
export interface UnparsedToolCall {
  /** Tool names the text names, in order, de-duplicated (`read`, `bash`, …). */
  names: string[];
  /** The mangled fragment, trimmed and capped, so the model sees what it wrote. */
  sample: string;
}

/** A call opening: the name of the tool, in one of the shapes templates produce. */
const CALL_OPEN = [
  /^<tool_call\b/,
  /^<antml:tool_call\b/,
  /^<antml:invoke\b/,
  /^<invoke\b/,
  /^<function[ =]/,
  // The collapsed `<=read>` a quantized Qwen template emits for `<antml:invoke name="read">`.
  /^<=[A-Za-z_][\w.:-]*>/,
];

/** A parameter row, in any of the same shapes. A call with none is prose. */
const PARAMETER = /<\/?(?:antml:)?parameter[\s/>=]/;

const MAX_SAMPLE_CHARS = 400;

/** Code fences quote a tool call for the reader; a reply *is* one. */
export function stripFencedCode(text: string): string {
  return text.replace(/^`{3,}[\s\S]*?^`{3,}[ \t]*$/gm, "").replace(/^~{3,}[\s\S]*?^~{3,}[ \t]*$/gm, "");
}

/** The tool a printed call names, when the text says it. */
function toolNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/<(?:antml:)?invoke\s+name\s*=\s*["']?([\w.:-]+)/gi)) {
    names.push(match[1]);
  }
  for (const match of text.matchAll(/<function\s*=\s*["']?([\w.:-]+)/gi)) names.push(match[1]);
  for (const match of text.matchAll(/<=([\w.:-]+)>/g)) names.push(match[1]);
  return [...new Set(names)];
}

/**
 * A text block that is a tool call the provider failed to parse: it opens with
 * a call marker on its first line and carries at least one parameter row,
 * outside any code fence. A message that quotes the format starts with prose
 * and keeps the grammar in a fence, so it does not match.
 */
export function findUnparsedToolCall(text: string): UnparsedToolCall | null {
  const body = stripFencedCode(text);
  const opening = body.trimStart();
  if (!CALL_OPEN.some((marker) => marker.test(opening))) return null;
  if (!PARAMETER.test(opening)) return null;
  return { names: toolNames(opening), sample: opening.slice(0, MAX_SAMPLE_CHARS) };
}

/** Loose on purpose: the caller hands a session entry's message, any SDK shape. */
export interface PrintedCallMessageShape {
  role?: unknown;
  content?: unknown;
  stopReason?: unknown;
}

function textBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is { type: string } => typeof block === "object" && block !== null)
    .filter((block) => block.type === "text")
    .map((block) => String((block as { text?: unknown }).text ?? ""));
}

function hasToolCallBlock(content: unknown): boolean {
  return Array.isArray(content)
    && content.some((block) => typeof block === "object" && block !== null
      && (block as { type?: unknown }).type === "toolCall");
}

/**
 * The reply that ended a run on a printed tool call: an assistant message with
 * no tool call of its own, a stop that is not an abort or a provider error, and
 * a text block that is the call. `undefined` when the message is fine, so a
 * caller only reads the result as "the run has work left".
 */
export function assistantEndedOnUnparsedToolCall(
  message: PrintedCallMessageShape | undefined,
): UnparsedToolCall | null {
  if (!message || message.role !== "assistant") return null;
  if (message.stopReason === "aborted" || message.stopReason === "error") return null;
  if (hasToolCallBlock(message.content)) return null;
  for (const text of textBlocks(message.content)) {
    const found = findUnparsedToolCall(text);
    if (found) return found;
  }
  return null;
}

/** What the settle boundary writes into the session, read by the card and by tests. */
export interface UnparsedToolCallDetails {
  toolNames: string[];
  sample: string;
  /** This run's nth continuation, from 1. */
  attempt: number;
  /** How many continuations the extension spends between two real tool calls. */
  budget: number;
}

/**
 * The note the model is handed and the user reads: what happened, that nothing
 * ran, and what to do instead. Short because it is one more turn of context,
 * and blunt because the model has to drop the format it just used.
 */
export function unparsedToolCallNoticeText(call: UnparsedToolCall): string {
  const named = call.names.length > 0
    ? `It names ${call.names.map((name) => `${name}`).join(", ")}.`
    : "";
  return [
    `Pi Web: the reply above printed a tool call as text instead of sending one, so nothing ran and the task stopped. ${named}`,
    "Send that call as a real tool call now, with the tool interface, not as tags in your message text, and keep working.",
    "Do not repeat the XML.",
    call.sample ? `\nWhat you wrote:\n${call.sample}` : "",
  ].join(" ").trim();
}
