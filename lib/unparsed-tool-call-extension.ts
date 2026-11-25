import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import {
  assistantEndedOnUnparsedToolCall,
  UNPARSED_TOOL_CALL_CUSTOM_TYPE,
  unparsedToolCallNoticeText,
  type UnparsedToolCallDetails,
} from "./unparsed-tool-call.ts";

export const UNPARSED_TOOL_CALL_EXTENSION_NAME = "pi-web-unparsed-tool-call";

/**
 * Continuations one session may spend between two real tool calls. A model that
 * keeps printing its calls as text is broken, not unlucky: two asks are enough
 * to prove it, and a third would only burn the user's tokens. A run that does
 * manage a real tool call gets the budget back.
 */
export const UNPARSED_TOOL_CALL_BUDGET = 2;

export interface UnparsedToolCallExtensionOptions {
  /** Ask for at most this many continuations between two real tool calls. */
  budget?: number;
  /** Read per boundary, so a switch can turn the extension off without a reload. */
  isEnabled?: () => boolean;
}

/**
 * Ask a run that ended on a printed tool call for one more request.
 *
 * pi's settle boundary (`agent_before_settle`) is the last actionable point of
 * a run: it may append session entries and request one continuation. A reply
 * whose only content is an unparsed XML tool call is not a finished turn — the
 * model meant to call a tool and the provider never ran one — so the boundary
 * appends a short note naming what it wrote and continues. The note is a
 * displayed custom message, so the chat shows why the run carried on instead of
 * stopping in silence.
 *
 * Only a completed turn is continued. An aborted or failed one is the user's
 * Stop or the provider's failure, and answering it would be inventing work.
 */
export function createUnparsedToolCallExtension(
  options: UnparsedToolCallExtensionOptions = {},
): InlineExtension {
  const budget = options.budget ?? UNPARSED_TOOL_CALL_BUDGET;
  const isEnabled = options.isEnabled ?? (() => true);
  return {
    name: UNPARSED_TOOL_CALL_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      let used = 0;
      // A tool that really ran means the session is speaking the tool language
      // again; the next printed call is a fresh accident, not the same loop.
      pi.on("tool_call", () => {
        used = 0;
        return undefined;
      });
      pi.on("agent_start", () => {
        used = 0;
        return undefined;
      });
      pi.on("agent_before_settle", (event) => {
        if (used >= budget || !isEnabled()) return undefined;
        if (event.outcome !== "completed") return undefined;
        // Another handler already asked for the continuation, and a context pi
        // cannot continue (no user or tool result to append to) is a refusal.
        if (event.continue || !event.context.canContinue) return undefined;
        const messages = event.context.contextMessages;
        const last = messages[messages.length - 1];
        const printed = assistantEndedOnUnparsedToolCall(last as never);
        if (!printed) return undefined;
        used += 1;
        const details: UnparsedToolCallDetails = {
          toolNames: printed.names,
          sample: printed.sample,
          attempt: used,
          budget,
        };
        return {
          entries: [...event.entries, {
            type: "custom_message" as const,
            customType: UNPARSED_TOOL_CALL_CUSTOM_TYPE,
            content: unparsedToolCallNoticeText(printed),
            display: true,
            details,
          }],
          continue: true,
        };
      });
    },
  };
}
