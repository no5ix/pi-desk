"use client";

import { memo, useState, useRef, useEffect, useMemo, useCallback, useContext } from "react";
import ReactMarkdown from "react-markdown";
import { MarkdownBody } from "./MarkdownBody";
import { ImagePreview } from "./ImagePreview";
import { ThinkingIcon } from "./ThinkingIcon";
import { copyText } from "@/lib/clipboard";
import { stripAnsi } from "@/lib/ansi";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useDiffViewMode } from "@/hooks/useDiffViewMode";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { formatDurationHms } from "@/lib/completion-notification";
import { formatTurnDurationCompact } from "@/lib/turn-duration";
import { UNPARSED_TOOL_CALL_CUSTOM_TYPE } from "@/lib/unparsed-tool-call";
import { isBackgroundTaskNotification } from "@/lib/background-tasks/notification";
import { ClockIcon } from "./ClockIcon";
import { ProcessDetailsContext } from "./process-details-context";
import { MessageBranchAction } from "./message-branch-action";
import { getAssistantErrorMessage, getThinkingPreview, hasAssistantAnswer, isAssistantTruncated, isEmptyThinkingBlock } from "@/lib/message-display";
import { fillContentGaps } from "@/lib/assistant-content";
import { isThinkingLevelRefusal, refusalAllowedValues } from "@/lib/thinking-level-error";
import { diffGapLabel, parseUnifiedPatch, type SplitDiffCell, type SplitDiffFile } from "@/lib/patch";
import { applyPatchPreviewToFiles, applyPatchResultHasFailures, extractApplyPatchPaths, getApplyPatchInputText, parseApplyPatchInput } from "@/lib/apply-patch";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "@/lib/tool-names";
import { isToolCallExpanded, setToolCallExpanded } from "@/lib/tool-call-expansion";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import { TurnWrittenFiles } from "./TurnWrittenFiles";
import type { WrittenFile } from "@/lib/turn-written-files";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { splitAttachedFiles } from "@/lib/chat-attachments";
import { userImageDisplayText } from "@/lib/user-image-display";
import { AttachedFileList } from "./AttachedFileList";
import { SavedFileCard, isSavedFileInfo } from "./SavedFileCard";
import type { SubagentToolDetails } from "@/lib/subagent-extension";
import { CODEMODE_TOOL_NAME, codemodeCalls, codemodeScript, codemodeScriptPreview, stripCodemodeHeader } from "@/lib/codemode-view";
import { CodemodeCallList } from "./CodemodeToolView";
import { imageSource, resultImageFileName } from "@/lib/result-image";
import { mcpToolLabel, prettyMcpResultText } from "@/lib/mcp-tool-display";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  BashExecutionMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
  PayloadTruncation,
} from "@/lib/types";
import { isRecord } from "@/lib/is-record";
import { errorMessage } from "@/lib/errors";
import {
  registerContentCache,
  RetainedTextCache,
  shouldReleaseOnCollapse,
} from "@/lib/content-retention";

// CJK chars ~1 token each (GLM/DeepSeek/GPT-o200k); other chars ~4 chars/token.
const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;
function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

interface TokenEstimateCacheEntry {
  text: string;
  tokens: number;
}

export function getTokenEstimateText(block: AssistantContentBlock): string | null {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  if (block.type === "toolCall") return block.rawInput ?? JSON.stringify(block.input ?? {}) ?? "";
  return null;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function estimateUpdatedTokens(previous: TokenEstimateCacheEntry | undefined, text: string): number {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);

  let baseTokens = previous.tokens;
  let suffixStart = previous.text.length;
  // A streamed delta can complete a surrogate pair that was counted as two
  // non-CJK code points in the previous update.
  if (
    suffixStart > 0
    && suffixStart < text.length
    && isHighSurrogate(previous.text.charCodeAt(suffixStart - 1))
    && isLowSurrogate(text.charCodeAt(suffixStart))
  ) {
    baseTokens -= 1 / 4;
    suffixStart--;
  }
  return baseTokens + estimateTokens(text.slice(suffixStart));
}

const MAX_THINKING_CACHE_ENTRIES = 100;
/** The bytes of full reasoning one tab keeps for re-expanding cards. */
const MAX_RETAINED_THINKING_BYTES = 4 * 1024 * 1024;
/** A request in flight is accounted at this size until its text is known. */
const THINKING_INFLIGHT_ESTIMATE_BYTES = 64 * 1024;
/**
 * Fetched full thinking blocks, bounded by entries *and* bytes (Phase 6): a
 * hundred 3 MB reasoning blocks is not a cache, it is a leak with a size limit
 * on the count. The cache also answers to the page's own memory pressure.
 */
const thinkingContentCache = new RetainedTextCache<Promise<string>>(
  MAX_THINKING_CACHE_ENTRIES,
  MAX_RETAINED_THINKING_BYTES,
);
registerContentCache(thinkingContentCache);

// Messages larger than this skip markdown rendering entirely. react-markdown +
// KaTeX + syntax highlighting on multi-hundred-KB payloads (e.g. pasted HAR or
// log dumps) freezes the browser main thread.
const MAX_MARKDOWN_CHARS = 100_000;

function formatMessageBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

/**
 * MarkdownBody with an oversized-content guard: huge messages render as a
 * click-to-reveal plain-text <pre> instead of running the markdown pipeline.
 */
function SafeMarkdownBody({ children, className, ...props }: React.ComponentProps<typeof MarkdownBody>) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);

  if (children.length <= MAX_MARKDOWN_CHARS) {
    return <MarkdownBody className={className} {...props}>{children}</MarkdownBody>;
  }
  if (!showRaw) {
    return (
      <button
        onClick={() => setShowRaw(true)}
        style={{
          display: "block",
          width: "100%",
          margin: "4px 0",
          padding: "7px 10px",
          border: "var(--hairline) solid var(--border)",
          borderRadius: "var(--radius-sm)",
          background: "var(--bg-panel)",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "var(--fs-caption)",
          textAlign: "left",
        }}
      >
        ⚠ {t("i18n.largeMessageReveal", { size: formatMessageBytes(children.length) })}
      </button>
    );
  }
  return (
    <div className={className} style={{ maxHeight: 420, overflow: "auto", fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", lineHeight: 1.5 }}>
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
        }}
      >
        {children}
      </pre>
    </div>
  );
}

// Cap the user "sent" bubble's height so an abnormally long message does not
// push the conversation off screen; overflow scrolls inside the bubble. It sits
// above USER_TEXT_COLLAPSE_HEIGHT: the inner box is the reading cap, and a bubble
// shorter than it would scroll the bubble instead of the text.
const USER_BUBBLE_MAX_HEIGHT = 900;

function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) return cached;

  const request = fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { thinking?: unknown };
    if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
    return data.thinking;
  }).then((thinking) => {
    // The bytes are known now: account for them, so the byte cap can evict.
    thinkingContentCache.set(key, Promise.resolve(thinking), thinking.length);
    return thinking;
  }).catch((error) => {
    thinkingContentCache.delete(key);
    throw error;
  });

  // In flight the entry must already be in the cache, so a second expand of the
  // same block does not fire a second request.
  thinkingContentCache.set(key, request, THINKING_INFLIGHT_ESTIMATE_BYTES);
  return request;
}

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  /**
   * Opens one written file's diff in the preview pane, with the session that
   * wrote it, so the `Edited files` card shows the change and not the file.
   */
  onOpenFileDiff?: (filePath: string, sessionId?: string) => void;
  onOpenSession?: (sessionId: string) => void;
  entryId?: string;
  searchBlock?: AssistantContentBlock;
  /**
   * The footer's "Branch in new chat" on a finished reply: pi's `fork_branch` at
   * this entry, so the copy carries the conversation through this reply and the
   * current session keeps running. Only a saved session gets the button.
   */
  onBranchInNewChat?: (entryId: string) => void;
  /** This message's branch request is in flight; the button shows "Creating…". */
  forking?: boolean;
  onEditContent?: (message: UserMessage, entryId: string) => void;
  /** Shared with MessageView so the disabled reason can travel with the button. */
  editDisabled?: boolean;
  onCancelEdit?: () => void;
  isEditing?: boolean;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  /**
   * Files this turn wrote, derived by the caller from the whole turn's
   * successful write/edit tool calls. ChatWindow computes this because the
   * saved-message path splits tool calls into their own entries, leaving the
   * final answer text-only.
   */
  writtenFiles?: WrittenFile[];
  onCompact?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  /** Opens Settings › Models on this provider/model (a refused thinking level's error). */
  onOpenModelSettings?: (provider: string, modelId: string) => void;
  /**
   * How long the turn this reply answers took, computed by ChatWindow over the whole
   * message list (getTurnDurationMs in lib/turn-duration.ts). Shown in the footer beside
   * Copy, in the completion notification's `0h31m10s` form, once the reply is finished.
   */
  turnDurationMs?: number;
  /** This message is the newest reply (or the live one). Its last thinking block is open,
   *  and the "expand thinking by default" switch reaches this reply's thinking — not every
   *  thinking card in the file, which turned a long conversation into a wall of open text. */
  expandLatestThinking?: boolean;
  /** Called with the control element when a row's Expand/Collapse is about to grow the
   *  page, so the scroll viewport can keep the row in place. See ChatWindow. */
  onContentToggle?: (control: HTMLElement | null, entryId?: string) => void;
}

// Dates follow the app language, not the OS locale, so an English UI never
// shows "10月31日" (and vice versa).
function formatTime(ts?: number, locale?: string): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(locale ?? [], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString(locale ?? [], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

export function replaceUserMessageText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };

  const content: Array<TextContent | ImageContent> = [];
  let replaced = false;
  for (const block of message.content) {
    // A user message read from disk can carry a slot with no block in it.
    if (!block || typeof block !== "object") continue;
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (!replaced) {
      content.push({ ...block, text });
      replaced = true;
    }
  }
  if (!replaced) content.unshift({ type: "text", text });
  return { ...message, content };
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of fillContentGaps((message as AssistantMessage).content)) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, cwd, onOpenFile, onOpenFileDiff, onOpenSession, entryId, searchBlock, onBranchInNewChat, forking, onEditContent, editDisabled, onCancelEdit, isEditing, showTimestamp, prevTimestamp, sessionId, writtenFiles, onCompact, isCompacting, compactError, onOpenModelSettings, turnDurationMs, expandLatestThinking, onContentToggle }: Props) {
  // The row's own entry id rides with the control, so the viewport knows which row is
  // about to grow. The prop from ChatWindow stays a stable reference, which the memo
  // comparator below relies on.
  const notifyContentToggle = useCallback(
    (control: HTMLElement | null) => { onContentToggle?.(control, entryId); },
    [onContentToggle, entryId],
  );
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} cwd={cwd} onOpenFile={onOpenFile} entryId={entryId} onEditContent={onEditContent} editDisabled={editDisabled} onCancelEdit={onCancelEdit} isEditing={isEditing} onContentToggle={notifyContentToggle} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} cwd={cwd} onOpenFile={onOpenFile} onOpenFileDiff={onOpenFileDiff} onOpenSession={onOpenSession} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} sessionId={sessionId} entryId={entryId} searchBlock={searchBlock} onBranchInNewChat={onBranchInNewChat} forking={forking} writtenFiles={writtenFiles} onCompact={onCompact} isCompacting={isCompacting} compactError={compactError} onOpenModelSettings={onOpenModelSettings} turnDurationMs={turnDurationMs} expandLatestThinking={expandLatestThinking} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    // A finished background task is reported by the header's Background Tasks card: its row,
    // its status, its exit code, its output, and the unacknowledged-failure mark the
    // extension's own dock wears. The extension injects this message for a terminal, where a
    // finished task has nowhere else to be shown; here it has somewhere else, so the chat
    // leaves it out rather than raising a second notice for one event. The record itself is
    // untouched: the session file, the transcript, the export and what the model was shown all
    // keep it.
    if (isBackgroundTaskNotification((message as CustomMessage).customType)) return null;
    if ((message as CustomMessage).customType === "compaction") {
      return <CompactionMessageView message={message as CustomMessage} onContentToggle={notifyContentToggle} />;
    }
    if ((message as CustomMessage).customType === "branch_summary") {
      return <CompactionMessageView message={message as CustomMessage} kind="branch_summary" onContentToggle={notifyContentToggle} />;
    }
    return <CustomMessageView message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} onContentToggle={notifyContentToggle} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.onOpenFileDiff === next.onOpenFileDiff
    && prev.onOpenSession === next.onOpenSession
    && prev.entryId === next.entryId
    && prev.searchBlock === next.searchBlock
    && prev.onBranchInNewChat === next.onBranchInNewChat
    && prev.forking === next.forking
    && prev.onEditContent === next.onEditContent
    && prev.onCancelEdit === next.onCancelEdit
    && prev.isEditing === next.isEditing
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.writtenFiles === next.writtenFiles
    && prev.sessionId === next.sessionId
    && prev.onCompact === next.onCompact
    && prev.isCompacting === next.isCompacting
    && prev.compactError === next.compactError
    && prev.onOpenModelSettings === next.onOpenModelSettings
    && prev.turnDurationMs === next.turnDurationMs
    && prev.onContentToggle === next.onContentToggle;
});

function UserMessageView({ message, cwd, onOpenFile, entryId, onEditContent, editDisabled, onCancelEdit, isEditing, onContentToggle }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  entryId?: string;
  onEditContent?: (message: UserMessage, entryId: string) => void;
  editDisabled?: boolean;
  onCancelEdit?: () => void;
  isEditing?: boolean;
  /** A row that grows the page under the finger tells the scroll viewport, so the row
   *  keeps its place and the control stays in reach: ChatWindow's `handleContentToggle`. */
  onContentToggle?: (control: HTMLElement | null) => void;
}) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // A long prompt's own "Expand" grows the bubble past its collapsed cap, so the
  // whole prompt is visible without scrolling. The bubble's cap is lifted here in
  // the parent, which owns it.
  const [promptExpanded, setPromptExpanded] = useState(false);

  // Session files can hold `\r\n` or lone `\r` line endings (#680). Chrome renders
  // a lone `\r` as a space even in the pre-wrap command-args and raw-text views.
  // Copy uses this text too; the session file keeps the original endings.
  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  // SDK image normalization appends coordinate hints to persisted user text.
  // Project those out of display/copy and newly created edit drafts. The source
  // message and existing model context retain the exact original data.
  const content = userImageDisplayText((
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n")
  ).replace(/\r\n?/g, "\n"), imageBlocks.length);

  // Files attached in a chat travel inside the text; show them as chips, not a wall of text.
  const { text: bodyText, files: attachedFiles } = splitAttachedFiles(content);

  const commandText = skillExpansionToCommand(content);
  const commandSeparator = commandText?.search(/\s/) ?? -1;
  const commandName = commandText
    ? commandSeparator === -1 ? commandText : commandText.slice(0, commandSeparator)
    : "";
  const commandArgs = commandText && commandSeparator !== -1
    ? commandText.slice(commandSeparator + 1)
    : "";

  const time = formatTime(message.timestamp, locale);
  const copyTarget = commandText ?? content;
  // Editing is a new user submission, not a replay of SDK transport metadata.
  // Build a copy with cleaned text while preserving every non-text attachment;
  // otherwise each edit/resend can accumulate another generated image hint.
  const editTarget = commandText || imageBlocks.length > 0
    ? replaceUserMessageText(message, commandText ?? content)
    : message;

  const imageBlocksNode = imageBlocks.length > 0 && (
    <div data-image-gallery style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
      {imageBlocks.map((img, i) => {
        const src = imageSource(img);
        return (
          <ImagePreview key={i} src={src}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              style={{ maxWidth: 240, maxHeight: 240, borderRadius: "var(--radius-sm)", objectFit: "contain", display: "block", border: "var(--hairline) solid rgba(59,130,246,0.15)" }}
            />
          </ImagePreview>
        );
      })}
    </div>
  );
  const canEdit = !!entryId && !!onEditContent;
  const editBlocked = canEdit && editDisabled;
  const editTitle = editBlocked
    ? t("i18n.editFromHereBusyTitle")
    : t("i18n.editFromHereTitle");
  const canCancelEdit = !!isEditing && !!onCancelEdit;

  const copyContent = () => {
    copyText(copyTarget).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      className="message-user"
      style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "min(78%, 660px)" }}>
        <div
          className={`message-user-bubble${isEditing ? " is-editing" : ""}`}
          style={{
            flex: 1,
            minWidth: 0,
            // Expanded (the slash command's argument, or a long prompt's own
            // "Expand") the bubble grows to the whole message; collapsed it is a
            // capped box the user scrolls, with the text's own scrollbar.
            maxHeight: expanded || promptExpanded ? "none" : USER_BUBBLE_MAX_HEIGHT,
            overflowY: expanded || promptExpanded ? "visible" : "auto",
          }}
        >
          {commandText ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              {imageBlocksNode}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={(event) => {
                    onContentToggle?.(event.currentTarget);
                    setExpanded((prev) => !prev);
                  }}
                  title={expanded ? t("i18n.collapse") : t("i18n.expand")}
                  aria-expanded={expanded}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    flexShrink: 0,
                    padding: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "calc(13px + var(--chat-font-size-offset, 0px))",
                    textAlign: "left",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {commandName}
                  </span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ flexShrink: 0, opacity: 0.75, transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--dur-base) var(--ease-native)" }}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {commandArgs && (
                  <span style={{
                    color: "var(--text)",
                    fontSize: "calc(14px + var(--chat-font-size-offset, 0px))",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    minWidth: 0,
                    flex: 1,
                  }}>
                    {commandArgs}
                  </span>
                )}
              </div>
              {expanded && (
                <MarkdownBody className="markdown-user-message" keepLineBreaks cwd={cwd} onOpenFile={onOpenFile}>{content}</MarkdownBody>
              )}
            </div>
          ) : (
            <>
              {imageBlocksNode}
              {attachedFiles.length > 0 && <AttachedFileList files={attachedFiles} />}
              {bodyText && (
                <CollapsibleUserText
                  text={bodyText}
                  cwd={cwd}
                  onOpenFile={onOpenFile}
                  onExpandedChange={setPromptExpanded}
                  onContentToggle={onContentToggle}
                />              )}
            </>
          )}
        </div>

      </div>

      {/* Bottom row: action buttons + timestamp */}
      {(time || canEdit || canCancelEdit || true) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          <div className="message-copy-actions">
            <button
              onClick={copyContent}
               title={t("i18n.copyMessage")}
              aria-live="polite"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: "var(--control-h-sm)",
                background: "none", border: "none",
                borderRadius: "var(--radius-sm)",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: "var(--fs-micro)", fontWeight: "var(--fw-regular)",
                whiteSpace: "nowrap",
                transition: "color var(--dur-fast) var(--ease-native)",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
               {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
          </div>
          {(canEdit || canCancelEdit) && (
            <div
              className="user-msg-actions"
              style={{ opacity: canCancelEdit ? 1 : undefined }}
            >
              {canEdit && !canCancelEdit && (
                <button
                  onClick={() => onEditContent!(editTarget, entryId!)}
                  disabled={editBlocked}
                  aria-disabled={editBlocked || undefined}
                  title={editTitle}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: "var(--control-h-sm)",
                    background: "none", border: "none",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-dim)",
                    cursor: editBlocked ? "not-allowed" : "pointer",
                    fontSize: "var(--fs-micro)", fontWeight: "var(--fw-regular)",
                    whiteSpace: "nowrap",
                    transition: "color var(--dur-fast) var(--ease-native)",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.128 3.58a1 1 0 0 0 1.212 1.212l3.58-1.128a2 2 0 0 0 .83-.5Z" />
                    <path d="m15 5 4 4" />
                  </svg>
                   {t("i18n.editFromHere")}
                </button>
              )}
              {canCancelEdit && (
                <button
                  type="button"
                  onClick={onCancelEdit}
                  title={t("i18n.cancel")}
                  aria-label={t("i18n.cancel")}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: "var(--control-h-sm)",
                    background: "none", border: "none",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--accent)",
                    cursor: "pointer",
                    fontSize: "var(--fs-micro)", fontWeight: "var(--fw-medium)",
                    whiteSpace: "nowrap",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                  {t("i18n.cancel")}
                </button>
              )}
            </div>
          )}
          {time && <span className="message-meta" style={{ fontSize: "var(--fs-micro)", color: "var(--text-dim)" }}>{time}</span>}
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  cwd,
  onOpenFile,
  onOpenFileDiff,
  onOpenSession,
  showTimestamp,
  prevTimestamp,
  sessionId,
  entryId,
  searchBlock,
  writtenFiles,
  onCompact,
  isCompacting,
  compactError,
  onOpenModelSettings,
  turnDurationMs,
  expandLatestThinking,
  onBranchInNewChat,
  forking,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenFileDiff?: (filePath: string, sessionId?: string) => void;
  onOpenSession?: (sessionId: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  entryId?: string;
  searchBlock?: AssistantContentBlock;
  onBranchInNewChat?: (entryId: string) => void;
  forking?: boolean;
  writtenFiles?: WrittenFile[];
  onCompact?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  onOpenModelSettings?: (provider: string, modelId: string) => void;
  turnDurationMs?: number;
  expandLatestThinking?: boolean;
}) {
  const { t, locale } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp, locale) : null;
  // The model line carries the reply's own time: the Process details card runs one
  // model line per reply, and a finished run with no times on them reads as one
  // undated block. The footer keeps its own, sparser timestamp rules.
  const modelTime = formatTime(message.timestamp, locale);
  const blockItems = useMemo(() => (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming })), [message.content, isStreaming]);
  // The newest thinking of this reply is the one that opens by default, and it is
  // the newest one of the newest reply that opens at all (see expandLatestThinking).
  const lastThinkingOrderIndex = useMemo(() => {
    for (let index = blockItems.length - 1; index >= 0; index -= 1) {
      if (blockItems[index].block.type === "thinking") return index;
    }
    return -1;
  }, [blockItems]);
  const blocks = useMemo(() => blockItems.map(({ block }) => block), [blockItems]);
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  const levelRefused = isThinkingLevelRefusal(providerError);
  const refusedAllowed = levelRefused ? refusalAllowedValues(providerError) : [];
  const truncated = isAssistantTruncated(message, { isStreaming });
  const unansweredTruncation = truncated && !hasAssistantAnswer(message);
  const [copied, setCopied] = useState(false);
  // A finished, saved reply has an entry to branch from; the streaming tail has none
  // (its entry is not on disk, and forking it would copy a half answer). The caller hands
  // the callback to the row that ENDS a turn — the report — so every turn has exactly one
  // branch control, below the blocks it produced. A step inside the turn is never handed
  // it: that was a column of identical buttons that all fork the same conversation.
  const insideProcessDetails = useContext(ProcessDetailsContext);
  const canBranchInNewChat = !isStreaming && !!entryId && !!onBranchInNewChat && !insideProcessDetails;
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;
  const tokenEstimateCacheRef = useRef<Map<number, TokenEstimateCacheEntry>>(new Map());
  const estimatedTokens = useMemo(() => {
    if (!isStreaming) {
      tokenEstimateCacheRef.current = new Map();
      return 0;
    }
    const nextCache = new Map<number, TokenEstimateCacheEntry>();
    let total = 0;
    for (const { block, originalIndex } of blockItems) {
      const text = getTokenEstimateText(block);
      if (text === null) continue;
      const tokens = estimateUpdatedTokens(tokenEstimateCacheRef.current.get(originalIndex), text);
      nextCache.set(originalIndex, { text, tokens });
      total += tokens;
    }
    tokenEstimateCacheRef.current = nextCache;
    return total;
  }, [blockItems, isStreaming]);
  const estimatedTokensRef = useRef(estimatedTokens);
  estimatedTokensRef.current = estimatedTokens;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      const tokens = estimatedTokensRef.current;
      if (tokens === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(tokens / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (blocks.length === 0 && !isStreaming && !providerError && !truncated) return null;

  return (
    <div
      className="message-assistant"
      data-message-role="assistant"
      data-entry-id={entryId}
      style={{ marginBottom: 16 }}
    >
      {/* Model label */}
      <div
        className="message-assistant-model"
        style={{
          fontSize: "var(--fs-micro)",
          color: "var(--text-dim)",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {modelTime && (
          <span className="message-assistant-model-time">
            <ClockIcon size={12} />
            {modelTime}
          </span>
        )}
        {isStreaming && (() => {
          const est = Math.round(estimatedTokens);
          return (
            <>

              {est > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title={t("i18n.estimatedTokens")}>
                  <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: "var(--fs-micro)", fontWeight: "var(--fw-regular)" }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {est}
                  </span>
                  {tps !== null && (() => {
                    const bg = tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f";
                    return (
                      <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: "var(--radius-xs)", background: bg, color: "#fff", fontSize: "var(--fs-micro)", fontWeight: "var(--fw-regular)" }}>
                        {tps.toFixed(1)} t/s
                      </span>
                    );
                  })()}
                </span>
              )}
            </>
          );
        })()}
      </div>

      <div className="message-assistant-content" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blockItems.map(({ block, originalIndex }, orderIndex) => (
          <BlockView key={`${entryId ?? "stream"}-${originalIndex}`} block={block} searchTarget={block === searchBlock} toolResults={toolResults} isStreaming={isStreaming} streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} cwd={cwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} sessionId={sessionId} entryId={entryId} blockIndex={originalIndex} expandByDefault={expandLatestThinking && orderIndex === lastThinkingOrderIndex} latestReply={expandLatestThinking} />
        ))}
      </div>

      {providerError && (
        <div
          role="alert"
          style={{
            marginTop: blocks.length > 0 ? 8 : 0,
            padding: "7px 10px",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: "color-mix(in srgb, var(--danger) 7%, transparent)",
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-caption)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          Error: {providerError}
        </div>
      )}

      {/* Phase 7: a reply the stream cut to its payload budget says so. A short
          reply is not a complete one. */}
      {message.payloadTruncated && (
        <PayloadCutNote marker={message.payloadTruncated} />
      )}

      {levelRefused && (
        <div className="thinking-refusal-hint" role="note">
          <span>
            {t("chat.thinkingLevelRefused")}
            {refusedAllowed.length > 0 && <> {t("chat.thinkingLevelRefusedAllowed", { values: refusedAllowed.join(", ") })}</>}
          </span>
          {onOpenModelSettings && message.provider && message.model && (
            <button type="button" className="thinking-refusal-action" onClick={() => onOpenModelSettings(message.provider, message.model)}>
              {t("chat.thinkingLevelRefusedOpen")}
            </button>
          )}
        </div>
      )}

      {truncated && (
        <div
          role="alert"
          style={{
            marginTop: blocks.length > 0 || providerError ? 8 : 0,
            padding: "7px 10px",
            border: "none",
            borderRadius: "var(--radius-sm)",
            background: "rgba(234,179,8,0.07)",
            color: "var(--warning)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-caption)",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {t(unansweredTruncation ? "chat.truncatedWithoutAnswer" : "chat.truncatedByOutputLimit")}
          {unansweredTruncation && onCompact && (
            <button
              type="button"
              onClick={onCompact}
              disabled={isCompacting}
              style={{
                display: "block",
                marginTop: 8,
                padding: "3px 8px",
                border: "none",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-selected)",
                color: "inherit",
                cursor: isCompacting ? "default" : "pointer",
                font: "inherit",
              }}
            >
              {t(isCompacting ? "chat.compacting" : "chat.compactContext")}
            </button>
          )}
          {unansweredTruncation && compactError && (
            <div style={{ marginTop: 8, color: "var(--danger)", whiteSpace: "pre-wrap" }}>{compactError}</div>
          )}
        </div>
      )}

      {writtenFiles && writtenFiles.length > 0 && (
        <TurnWrittenFiles
          files={writtenFiles}
          onOpenFile={onOpenFileDiff
            ? (filePath: string) => { onOpenFileDiff(filePath, sessionId); }
            : onOpenFile ? (filePath: string) => { onOpenFile(filePath); } : undefined}
          sessionId={sessionId}
        />
      )}

      <div className="message-assistant-footer" style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 4,
      }}>
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
             title={t("i18n.copyMessage")}
            className="message-copy-action message-assistant-action"
            aria-live="polite"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", height: "var(--control-h-sm)",
              background: "var(--bg-selected)", border: "none",
              borderRadius: "var(--radius-sm)",
              color: copied ? "var(--accent)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: "var(--fs-micro)", fontWeight: "var(--fw-regular)",
              whiteSpace: "nowrap",
              transition: "opacity var(--dur-fast) var(--ease-native), color var(--dur-fast) var(--ease-native)",
            }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {copied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
             {/* The label is a span so a phone under 380px can drop it and keep the
                 glyph (globals.css `message-action-label`); the title carries the words. */}
             <span className="message-action-label">{copied ? t("i18n.copied") : t("i18n.copy")}</span>
          </button>
        )}
        {/* "Branch in new chat", the chip beside Copy: pi's `fork_branch` at this
            entry, so the new session starts with the conversation through this
            answer — the report included — and this chat keeps running. The footer's
            own row, because the report is what a new chat wants to continue from. */}
        {canBranchInNewChat && (
          <MessageBranchAction forking={forking} onBranch={() => { onBranchInNewChat!(entryId!); }} />
        )}
        {/* How long this turn took, between Copy and the timestamp: the task is over
            when the reply is, so it appears with the finished footer. The compact
            `1h50m` shape a glance at the footer needs, with a clock to say what the
            number is; the completion notification keeps its own full `0h50m12s`. */}
        {turnDurationMs !== undefined && !isStreaming && (
          <span
            className="message-turn-duration"
            title={t("chat.turnDurationHint", { duration: formatDurationHms(turnDurationMs) })}
          >
            <ClockIcon size={11} />
            {formatTurnDurationCompact(turnDurationMs)}
          </span>
        )}
        {time && !isStreaming && (
          <span className="message-meta" style={{ fontSize: "var(--fs-micro)", color: "var(--text-dim)", marginLeft: "auto" }}>{time}</span>
        )}
      </div>
    </div>
  );
}

function BlockView({ block, searchTarget, toolResults, isStreaming, streamingDuration, toolCallDurations, cwd, onOpenFile, onOpenSession, sessionId, entryId, blockIndex, expandByDefault, latestReply }: { block: AssistantContentBlock; searchTarget?: boolean; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void; onOpenSession?: (sessionId: string) => void; sessionId?: string; entryId?: string; blockIndex: number; expandByDefault?: boolean; latestReply?: boolean }) {
  if (block.type === "text") {
    return <div data-message-text data-search-target={searchTarget || undefined}><TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} /></div>;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} sessionId={sessionId} entryId={entryId} blockIndex={blockIndex} expandByDefault={expandByDefault} latestReply={latestReply} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    // A loaded (non-streaming) message whose toolCall has no paired result
    // means the run was interrupted before the tool finished — render that
    // honestly instead of the success styling.
    return <ToolCallBlock block={tc} result={result} duration={duration} onOpenSession={onOpenSession} aborted={!isStreaming && !result} />;
  }
  return null;
}

function TextBlock({ block, isStreaming, cwd, onOpenFile }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void }) {
  return <SafeMarkdownBody isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} artifacts>{block.text}</SafeMarkdownBody>;
}

export function ThinkingBlock({ block, duration, sessionId, entryId, blockIndex, expandByDefault = false, latestReply = false }: {
  block: ThinkingContent;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  /** The newest thinking in the conversation: it is open while it streams, stays open
   *  when it ends and nothing follows, and closes itself when the next thinking takes
   *  its place. Open even when the preference is off. */
  expandByDefault?: boolean;
  /** This block belongs to the newest reply. The "expand thinking by default" preference
   *  reaches the turn the user is reading — not every thinking card in the file, which
   *  is what turned a long conversation into a wall of open reasoning. */
  latestReply?: boolean;
}) {
  const { t } = useI18n();
  // One thinking card is open at a time: the newest one (the turn being read), by the
  // position rule below. A thinking card inside a turn's Process details does not follow
  // the preference — opening the group reveals the turn's steps, not all of their text —
  // and the newest block opens regardless of that, because it is the reasoning behind the
  // answer on screen. The card is clickable either way.
  const insideProcessDetails = useContext(ProcessDetailsContext);
  const expandedByRule = () =>
    expandByDefault || (latestReply && isThinkingExpandedByDefault() && !insideProcessDetails);
  const [expanded, setExpanded] = useState(expandedByRule);
  // A click is the user's own choice: after that the rule stops moving this card.
  const touchedRef = useRef(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const preview = getThinkingPreview(block.thinking);

  // A is the newest while it streams and stays open after it ends with nothing following
  // it. The moment B starts, A is history and closes on its own: the conversation keeps
  // open the thinking being written, never the pile behind it. Same rule for a preference
  // change, and never over a card the user opened by hand.
  useEffect(() => {
    if (!touchedRef.current) setExpanded(expandedByRule());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandByDefault, latestReply, insideProcessDetails]);

  // Keep already-mounted blocks in sync when the preference changes.
  useEffect(() => {
    const onChange = () => {
      if (!touchedRef.current) setExpanded(expandedByRule());
    };
    window.addEventListener(THINKING_EXPANDED_EVENT, onChange);
    return () => window.removeEventListener(THINKING_EXPANDED_EVENT, onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insideProcessDetails, expandByDefault, latestReply]);

  // Load deferred history content whenever the block is expanded.
  // loadThinkingContent() memoizes in-flight promises and drops failed ones
  // from its cache, so re-running this effect is cheap and a failed load can
  // be retried by collapsing and expanding the block again.
  useEffect(() => {
    if (!expanded || !block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(tRef.current("i18n.thinkingUnavailable"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadThinkingContent(sessionId, entryId, blockIndex)
      .then((value) => {
        if (!cancelled) {
          setContent(value);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, block.deferred, content, sessionId, entryId, blockIndex]);

  // Phase 6: a collapsed card hands its fetched reasoning back once it is big
  // enough that re-reading it is cheaper than holding it. The effect (not the
  // click) is the rule: a card that closes for any reason — the position rule,
  // the switch, a click — releases the same way, and the next expand fills it
  // in again, from the cache while the cache holds it.
  useEffect(() => {
    if (expanded) return;
    if (shouldReleaseOnCollapse(content)) {
      setContent(null);
      setLoading(false);
      setError(null);
    }
  }, [expanded, content]);

  return (
    <div className="thinking-card" style={{
      display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0,
      borderRadius: "var(--radius-md)",
      padding: "6px 10px",
      // The fill is the stylesheet's (`.thinking-card` in app/native-theme.css), not an
      // inline colour: the card is a tint over whatever it stands on — the page, or a
      // turn's Process details plate — and the app ships a dozen palettes.
      fontFamily: "var(--font-mono)",
      fontSize: "calc(11px + var(--chat-font-size-offset, 0px))",
      lineHeight: 1.5,
    }}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${t("i18n.thinking")}${preview ? `: ${preview}` : ""}`}
        title={t("i18n.thinking")}
        onClick={() => {
          // The user's own click outranks the position rule from here on: a card they
          // opened stays open when the next thinking starts, and one they closed stays shut.
          touchedRef.current = true;
          setExpanded((v) => !v);
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          width: expanded ? 14 : "100%",
          flexShrink: expanded ? 0 : 1,
          minWidth: 0,
          minHeight: "1.5em",
          padding: 0,
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <ThinkingIcon active={expanded} />
        {!expanded && (
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {preview ? <ReactMarkdown allowedElements={[]} unwrapDisallowed skipHtml>{preview}</ReactMarkdown> : "..."}
          </span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            color: error ? "var(--danger)" : "var(--text-muted)",
            fontSize: "var(--fs-caption)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
           {loading ? t("i18n.loadingThinking") : error ?? (block.deferred ? content : block.thinking)}
        </div>
      )}
      {duration !== undefined && (
        <span style={{ flexShrink: 0, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
      )}
    </div>
  );
}

function isSubagentToolDetails(value: unknown): value is SubagentToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<SubagentToolDetails>;
  return details.kind === "pi-web-subagent" && typeof details.sessionId === "string";
}

function ToolCallBlock({ block, result, duration, aborted, defaultExpanded, onOpenSession, onExpandedChange }: { block: ToolCallContent; result?: ToolResultMessage; duration?: number; aborted?: boolean; defaultExpanded?: boolean; onOpenSession?: (sessionId: string) => void; onExpandedChange?: (expanded: boolean) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(() => defaultExpanded ?? isToolCallExpanded(block.toolCallId));
  const toggleExpanded = () => {
    const next = !expanded;
    setToolCallExpanded(block.toolCallId, next);
    setExpanded(next);
    // Phase 6: the pane a collapsed card used to show can be bytes nobody is
    // looking at. Callers use this to give fetched content back.
    onToolExpandedChange(next);
  };
  const inputStr = getWrittenFileText(block) ?? getToolCallInputText(block);
  const isStreamingInput = block.rawInput !== undefined;
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const patchFiles = getApplyPatchFiles(block, result);
  const patchLabel = isApplyPatchToolName(block.toolName)
    ? summarizeApplyPatchInput(block)
    : null;
  // A script and the calls it made, instead of the input JSON. Streamed input is
  // still incomplete JSON and keeps the generic view.
  const codemodeCode = block.toolName === CODEMODE_TOOL_NAME && !isStreamingInput ? codemodeScript(block.input) : null;
  const codemode = codemodeCode === null ? null : { code: codemodeCode, ...codemodeCalls(result?.details) };
  // A running script's progress snapshot has calls but no content yet.
  const codemodeRunning = codemode !== null && result !== undefined && result.content.length === 0;

  // `server/tool` instead of the registered `mcp__server__tool`, as pi's TUI shows it.
  const mcpLabel = mcpToolLabel(block.toolName, result?.details);

  // Result display
  const resultContent = result ? (codemode ? stripCodemodeHeader(result.content) : result.content) : [];
  const joinedResultText = result
    ? resultContent.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultText = mcpLabel && joinedResultText !== null ? prettyMcpResultText(joinedResultText) : joinedResultText;
  // This pane is plain text, so a command's colour escapes (eslint, tsc, jest) would
  // render as escape-code boxes and an escape-only result would look like output.
  // The interactive bash pane is the place that colours them (AnsiText).
  const resultDisplayText = resultText === null ? null : stripAnsi(resultText);
  const resultImages = getMessageImages(resultContent);
  const resultIsEmpty = resultDisplayText === null ? false : (resultDisplayText.trim() === "(no output)" || resultDisplayText.trim() === "");
  const isError = (result?.isError ?? false)
    || (isApplyPatchToolName(block.toolName) && applyPatchResultHasFailures(result?.details));
  const subagent = isSubagentToolDetails(result?.details) ? result.details : null;
  const savedFile = block.toolName === "save_to_downloads" && !isError && isSavedFileInfo(result?.details)
    ? result.details
    : null;
  const codemodeCallCount = codemode ? codemode.calls.length + codemode.omitted : 0;

  /**
   * Phase 7: the stream cut this tool result to its per-event payload budget.
   * The card says so — a shortened value never renders as if it were complete —
   * and offers the entry's full block, which the session file keeps.
   */
  const payloadCut = result?.payloadTruncated;
  const payloadContentUrl = payloadCut?.contentUrl;
  const [cappedFull, setCappedFull] = useState<string | null>(null);
  const [cappedLoading, setCappedLoading] = useState(false);
  const [cappedError, setCappedError] = useState<string | null>(null);
  const loadCappedContent = async () => {
    if (!payloadContentUrl) return;
    setCappedLoading(true);
    setCappedError(null);
    try {
      const response = await fetch(payloadContentUrl);
      const data = await response.json() as { text?: unknown; error?: string };
      if (!response.ok || typeof data.text !== "string") {
        setCappedError(data.error ?? `HTTP ${response.status}`);
      } else {
        setCappedFull(data.text);
      }
    } catch (error) {
      setCappedError(errorMessage(error));
    } finally {
      setCappedLoading(false);
    }
  };
  const onToolExpandedChange = (next: boolean) => {
    // Phase 6: the full text loaded for a cut result is the card's biggest
    // fetchable payload; a collapsed card hands it back.
    if (!next && shouldReleaseOnCollapse(cappedFull)) {
      setCappedFull(null);
      setCappedError(null);
    }
    onExpandedChange?.(next);
  };

  // The card collapsed (by its header, a preference, or a re-render): give the
  // loaded full text back, so a session of collapsed cards keeps no output.
  useEffect(() => {
    if (expanded) return;
    if (shouldReleaseOnCollapse(cappedFull)) {
      setCappedFull(null);
      setCappedError(null);
    }
  }, [expanded, cappedFull]);

  return (
    <div
      // The tool call's own tint. It is a class, not an inline fill, so the phone's
      // stylesheet owns how deep it sits on the page (app/native-theme.css).
      className={`tool-call-card${isError ? " is-error" : aborted ? " is-aborted" : ""}`}
      style={{
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        fontSize: "var(--fs-caption)",
      }}
    >
      {/* ── Tool call header ── */}
      <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
        <button
          onClick={toggleExpanded}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            flex: 1,
            minWidth: 0,
            padding: "6px 10px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "var(--fs-caption)",
            textAlign: "left",
          }}
        >
          <span
            title={mcpLabel ? block.toolName : undefined}
            style={{ color: isError ? "var(--danger)" : aborted ? "var(--text-dim)" : "var(--success)", fontFamily: "var(--font-mono)", fontWeight: "var(--fw-semibold)", fontSize: "var(--fs-micro)", flexShrink: 0 }}
          >
            {mcpLabel ? (
              <>
                <span style={{ fontWeight: "var(--fw-medium)", opacity: 0.75 }}>{mcpLabel.server}/</span>
                {mcpLabel.tool}
              </>
            ) : block.toolName}
          </span>
          {aborted && (
            <span title={t("chat.toolCancelled")} style={{ flexShrink: 0, fontSize: "var(--fs-micro)", color: "var(--text-dim)", border: "none", background: "var(--bg-selected)", borderRadius: "var(--radius-xs)", padding: "1px 5px" }}>
              {t("chat.toolCancelled")}
            </span>
          )}
          <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
            {isStreamingInput
              ? t("chat.generatingToolInput")
              : (patchLabel ?? (codemode ? codemodeScriptPreview(codemode.code) : getToolPreview(block)))}
          </span>
          {codemodeCallCount > 0 && (
            <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
              {codemodeCallCount === 1 ? t("codemode.callCountOne") : t("codemode.callCount", { count: codemodeCallCount })}
            </span>
          )}
          {duration !== undefined && (
            <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
          )}
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--dur-base) var(--ease-native)" }}>
            <polyline points="2 3.5 5 6.5 8 3.5" />
          </svg>
        </button>
        {subagent && onOpenSession && (
          <button
            type="button"
            className="tool-call-open"
            onClick={() => onOpenSession(subagent.sessionId)}
            title={t("subagent.open")}
            aria-label={t("subagent.open")}
            style={{ width: 32, display: "grid", placeItems: "center", border: "none", background: "none", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
          </button>
        )}
      </div>

      {/* ── Expanded: input args (only when no richer view exists); a codemode script in place of its JSON ── */}
      {expanded && (isStreamingInput || !isEditTool) && !patchFiles && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.5,
            overflow: "auto",
            background: "var(--bg-subtle)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {codemode ? codemode.code.replace(/\r/g, "").trimEnd() : inputStr}
        </pre>
      )}

      {/* ── Expanded: the calls a codemode script made ── */}
      {expanded && codemode && (
        <CodemodeCallList calls={codemode.calls} omitted={codemode.omitted} isError={isError} />
      )}

      {/* ── Result images — always visible, independent of the collapsed details ── */}
      {resultImages.length > 0 && <ResultImages images={resultImages} />}

      {/* ── A file the chat saved to Downloads — always visible ── */}
      {savedFile && <SavedFileCard file={savedFile} />}

      {/* ── Expanded: applied-patch split diff ── */}
      {expanded && patchFiles && (
        <div style={{ background: "var(--bg)" }}>
          <ApplyPatchDiffView files={patchFiles} />
        </div>
      )}

      {/* ── Paired result — only shown when expanded ── */}
      {expanded && result && patchFiles && isError && (
        <PairedResult
          text={resultDisplayText ?? ""}
          isEmpty={resultIsEmpty}
          isError={isError}
        />
      )}
      {expanded && result && !patchFiles && !codemodeRunning && (
        resultDiff ? (
          <PairedDiffResult
            diff={resultDiff}
          />
        ) : (!resultIsEmpty || resultImages.length === 0) && (
          <PairedResult
            text={resultDisplayText ?? ""}
            isEmpty={resultIsEmpty}
            isError={isError}
          />
        )
      )}

      {/* ── Phase 7: the stream cut this result to its payload budget ── */}
      <PayloadCutNote
        marker={payloadCut}
        onLoad={payloadContentUrl && cappedFull === null ? loadCappedContent : undefined}
        loading={cappedLoading}
        error={cappedError}
      />
      {payloadCut && cappedFull !== null && (
        <PairedResult text={cappedFull} isEmpty={cappedFull.trim() === ""} isError={false} />
      )}
    </div>
  );
}

interface ResultDiff {
  text: string;
}

function PairedDiffResult({ diff }: {
  diff: ResultDiff;
}) {
  return (
    <div
      style={{
        background: "var(--bg)",
      }}
    >
      <SplitPatchView text={diff.text} />
    </div>
  );
}

// Two columns of code do not fit a phone; it always reads the patch as one column (upstream #1325).
function usePatchLayout(): "split" | "unified" {
  const { mode } = useDiffViewMode();
  const isMobile = useIsMobile();
  return isMobile ? "unified" : mode;
}

function ApplyPatchDiffView({ files }: { files: SplitDiffFile[] }) {
  const mode = usePatchLayout();
  return <SplitFilesView files={files} mode={mode} />;
}

function SplitPatchView({ text }: { text: string }) {
  const mode = usePatchLayout();
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  return <SplitFilesView files={files} mode={mode} />;
}

function SplitFilesView({ files, mode = "split" }: { files: SplitDiffFile[]; mode?: "split" | "unified" }) {
  const { t } = useI18n();
  const showFileHeaders = files.length > 1;
  const unified = mode === "unified";

  return (
    <div style={{ maxHeight: 560, overflowY: "auto", overflowX: "hidden", background: "var(--bg)" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={{
            minWidth: 0,
            borderTop: fileIndex === 0 ? "none" : "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.55,
          }}
        >
          {showFileHeaders && (
            unified ? (
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: "var(--bg-panel)",
                  borderBottom: "var(--hairline) solid var(--border)",
                }}
              >
                <SplitDiffHeader title={file.newPath || file.oldPath || t("i18n.after")} side="right" />
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: "var(--bg-panel)",
                  borderBottom: "var(--hairline) solid var(--border)",
                }}
              >
                 <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
                 <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
              </div>
            )
          )}

          {unified ? (
            <div>
              {file.rows.flatMap((row, rowIndex) => {
                if (row.type === "hunk") return [];
                if (row.type === "gap") return [<DiffGapRow key={`${rowIndex}-g`} count={row.count} />];
                const cells = [];
                const { left, right } = row;
                if (left.type === "removed") {
                  cells.push(<UnifiedDiffLine key={`${rowIndex}-l`} cell={left} />);
                }
                if (right.type === "added") {
                  cells.push(<UnifiedDiffLine key={`${rowIndex}-r`} cell={right} />);
                }
                if (left.type === "context" && right.type === "context") {
                  cells.push(<UnifiedDiffLine key={`${rowIndex}-c`} cell={right} />);
                }
                return cells;
              })}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
              {file.rows.map((row, rowIndex) => {
                if (row.type === "hunk") {
                  return null;
                }
                if (row.type === "gap") {
                  return <DiffGapRow key={rowIndex} count={row.count} spanBoth />;
                }

                return (
                  <div key={rowIndex} style={{ display: "contents" }}>
                    <SplitDiffCellView cell={row.left} side="left" />
                    <SplitDiffCellView cell={row.right} side="right" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Unchanged lines a patch leaves out between two hunks (upstream #1304). */
function DiffGapRow({ count, spanBoth }: { count: number | null; spanBoth?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="patch-diff-gap" style={spanBoth ? { gridColumn: "1 / -1" } : undefined}>
      {count === null ? "⋯" : diffGapLabel(count, t)}
    </div>
  );
}

function UnifiedDiffLine({ cell }: { cell: SplitDiffCell }) {
  const bg =
    cell.type === "added"
      ? "rgba(34,197,94,0.12)"
      : cell.type === "removed"
      ? "rgba(248,113,113,0.13)"
      : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "var(--success)" : cell.type === "removed" ? "var(--danger)" : "var(--text-dim)";

  return (
    <div style={{ display: "flex", minWidth: 0, background: bg }}>
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "var(--hairline) solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || " "}
      </span>
    </div>
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      style={{
        padding: "5px 10px",
        color: "var(--text-dim)",
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "rgba(34,197,94,0.12)"
      : cell.type === "removed"
      ? "rgba(248,113,113,0.13)"
      : cell.type === "empty"
      ? "var(--bg-subtle)"
      : "transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "var(--success)" : cell.type === "removed" ? "var(--danger)" : "var(--text-dim)";

  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        background: bg,
        borderRight: side === "left" ? "1px solid var(--border)" : "none",
      }}
    >
      <span
        style={{
          width: 42,
          padding: "0 6px",
          textAlign: "right",
          color: "var(--text-dim)",
          userSelect: "none",
          background: "var(--bg-panel)",
          borderRight: "var(--hairline) solid var(--border)",
          flexShrink: 0,
        }}
      >
        {cell.lineNo ?? ""}
      </span>
      <span
        style={{
          width: 18,
          padding: "0 5px",
          color: markerColor,
          userSelect: "none",
          fontWeight: cell.type === "context" || cell.type === "empty" ? 400 : 700,
          flexShrink: 0,
        }}
      >
        {marker}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0 10px 0 0",
          color: cell.type === "empty" ? "var(--text-dim)" : "var(--text)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", fontFamily: "var(--font-mono)", fontSize: "calc(12px + var(--chat-font-size-offset, 0px))", lineHeight: 1.55, minWidth: 0 }}>
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bg =
          kind === "added" ? "rgba(34,197,94,0.12)" :
          kind === "removed" ? "rgba(248,113,113,0.13)" :
          kind === "hunk" ? "rgba(96,165,250,0.12)" :
          "transparent";
        const color =
          kind === "added" ? "var(--success)" :
          kind === "removed" ? "var(--danger)" :
          kind === "hunk" ? "var(--accent)" :
          "var(--text)";

        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: bg,
              borderLeft: kind === "added"
                ? "3px solid var(--success)"
                : kind === "removed"
                ? "3px solid var(--danger)"
                : kind === "hunk"
                ? "3px solid var(--accent)"
                : "3px solid transparent",
            }}
          >
            <span
              style={{
                width: 48,
                padding: "0 8px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                borderRight: "var(--hairline) solid var(--border)",
                textAlign: "right",
                userSelect: "none",
                flexShrink: 0,
              }}
            >
              {i + 1}
            </span>
            <span style={{ padding: "0 10px", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color }}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Split diff rows for an apply_patch-style tool call.
 *
 * Prefers parsing the V4A patch document from the call input. The extension's
 * applied result preview contains the complete old/new file with unchanged
 * lines, so it is only used as a fallback when the call input is unavailable.
 * A single call may contain several file operations — each becomes its own
 * file section.
 */
function getApplyPatchFiles(block: ToolCallContent, result?: ToolResultMessage): SplitDiffFile[] | null {
  if (!isApplyPatchToolName(block.toolName)) return null;

  const fromInput = parseApplyPatchInput(getApplyPatchInputText(block.input, block.rawInput));
  if (fromInput) return fromInput;

  const details = result && !result.isError ? (result as ToolResultMessage & { details?: unknown }).details : undefined;
  if (isRecord(details)) {
    const fromPreview = applyPatchPreviewToFiles(details.preview);
    if (fromPreview) return fromPreview;
  }

  return null;
}

/** Header label listing the files targeted by an apply_patch call. */
function summarizeApplyPatchInput(block: ToolCallContent): string | null {
  const paths = extractApplyPatchPaths(getApplyPatchInputText(block.input, block.rawInput));
  if (paths.length === 0) return null;
  return paths.join(", ").slice(0, 120);
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}

// Images a tool returned — including ones a codemode script generated with an image model,
// which pi never writes to disk — so each one can be saved.
function ResultImages({ images }: { images: ImageContent[] }) {
  const { t } = useI18n();
  return (
    <div
      data-image-gallery
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        padding: "10px",
        background: "var(--bg)",
      }}
    >
      {images.map((image, index) => {
        const src = imageSource(image);
        if (!src) return null;
        return (
          <div key={index} className="result-image" style={{ maxWidth: "100%" }}>
            <ImagePreview src={src} style={{ maxWidth: "100%" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                loading="lazy"
                style={{
                  display: "block",
                  maxWidth: "min(100%, 720px)",
                  maxHeight: 520,
                  borderRadius: "var(--radius-sm)",
                  objectFit: "contain",
                  border: "var(--hairline) solid var(--border)",
                }}
              />
            </ImagePreview>
            <button
              type="button"
              className="result-image-save"
              onClick={() => {
                void import("@/lib/desktop-native")
                  .then(({ downloadUrlAsFile }) => downloadUrlAsFile(src, resultImageFileName(imageMediaType(image), index)))
                  .catch((error: unknown) => console.error("Failed to save image:", error));
              }}
            >
              {t("chat.saveImage")}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Phase 7: the stream cut this message to its per-event payload budget.
 *
 * A shortened value must never render as if it were complete, so every cut
 * event carries `payloadTruncated` and every card that shows one says what fell
 * off. Where the session entry keeps the bytes (a tool result's text), the note
 * carries the way back.
 */
function PayloadCutNote({ marker, onLoad, loading, error }: {
  marker?: PayloadTruncation;
  onLoad?: () => void;
  loading?: boolean;
  error?: string | null;
}) {
  const { t } = useI18n();
  if (!marker) return null;
  return (
    <div className="tool-output-truncation-note" role="status">
      <span>
        {marker.chars > 0
          ? t("chat.payloadTruncated", { chars: marker.chars.toLocaleString() })
          : t("chat.payloadTruncatedImages", { count: marker.images })}
      </span>
      {onLoad && (
        <button
          type="button"
          onClick={onLoad}
          disabled={loading}
          style={{
            marginLeft: 8,
            background: "none",
            border: "none",
            padding: 0,
            color: "var(--accent)",
            fontSize: "var(--fs-micro)",
            textDecoration: "underline",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? t("chat.loadingFullOutput") : t("chat.showFullOutput")}
        </button>
      )}
      {error && (
        <span style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>({error})</span>
      )}
    </div>
  );
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      style={{
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "var(--danger)" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
        }}
      >
        {isEmpty ? t("i18n.noOutput") : text}
      </pre>
    </div>
  );
}

/** A collapsed prompt's own scroll box. Three times the cap it started at: the box
 *  exists so a long prompt is readable without pressing "Expand", and 220px showed a
 *  task's first four lines and a fade. The overflow rule (collapse only above the cap
 *  + 60) and the bubble's own cap both read this number. */
const USER_TEXT_COLLAPSE_HEIGHT = 660;
function CollapsibleUserText({ text, cwd, onOpenFile, onExpandedChange, onContentToggle }: {
  text: string;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  /** Tells the bubble it may drop its collapsed height cap, so "Expand" shows the whole prompt. */
  onExpandedChange?: (expanded: boolean) => void;
  onContentToggle?: (control: HTMLElement | null) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  // The fade below the fold is a hint that more text follows, so it leaves once
  // the box is scrolled to its end (and never appears on the expanded text).
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Small slack so content barely over the limit is not worth collapsing
    setOverflowing(el.scrollHeight > USER_TEXT_COLLAPSE_HEIGHT + 60);
    setScrolledToEnd(false);
    if (el.scrollTop > 0) el.scrollTop = 0;
  }, [text]);

  const collapsed = overflowing && !expanded;
  const fade = "linear-gradient(to bottom, black calc(100% - 48px), transparent 100%)";
  const faded = collapsed && !scrolledToEnd;

  return (
    <div>
      <div
        ref={bodyRef}
        // Collapsed, the prompt is a scrollable box: the text is readable down
        // its full cap without first pressing "Expand". Expanded, it carries no
        // cap at all, so the whole prompt shows at once and "Collapse" restores
        // the box.
        onScroll={(event) => {
          const el = event.currentTarget;
          setScrolledToEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 8);
        }}
        style={collapsed ? {
          maxHeight: USER_TEXT_COLLAPSE_HEIGHT,
          overflowY: "auto",
          overflowX: "hidden",
          maskImage: faded ? fade : undefined,
          WebkitMaskImage: faded ? fade : undefined,
        } : undefined}
      >
        <MarkdownBody className="markdown-user-message" keepLineBreaks cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody>
      </div>
      {overflowing && (
        <button
          onClick={(event) => {
            const next = !expanded;
            // The page grows under the finger: the viewport is told first, so it can pin
            // this row and keep the control in reach.
            onContentToggle?.(event.currentTarget);
            setExpanded(next);
            onExpandedChange?.(next);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            marginTop: 2,
            padding: "2px 0",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: "var(--fs-micro)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--dur-base) var(--ease-native)" }}>
            <polyline points="2 3.5 5 6.5 8 3.5" />
          </svg>
          {expanded ? t("i18n.collapse") : t("i18n.expand")}
        </button>
      )}
    </div>
  );
}

function CompactionMessageView({ message, kind = "compaction", onContentToggle }: { message: CustomMessage; kind?: "compaction" | "branch_summary"; onContentToggle?: (control: HTMLElement | null) => void }) {
  const { t, locale } = useI18n();
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const time = formatTime(message.timestamp, locale);
  // A compaction is a note about the past, not part of the conversation, so the card
  // opens collapsed: its header (label, time) stays visible and is the toggle.
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="compaction-card"
        style={{
          border: "none",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "var(--bg)",
        }}
      >
        <button
          type="button"
          className="compaction-card-header"
          aria-expanded={expanded}
          onClick={(event) => {
            onContentToggle?.(event.currentTarget);
            setExpanded((value) => !value);
          }}
          title={t(expanded ? "chat.collapseCompaction" : "chat.expandCompaction")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "7px 10px",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            textAlign: "left",
          }}
        >
          <svg
            className="compaction-card-chevron"
            data-expanded={expanded ? "true" : "false"}
            width="11"
            height="11"
            viewBox="0 0 15 15"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="4 2.5 7.5 6 4 9.5" />
          </svg>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", fontWeight: "var(--fw-semibold)" }}>
            {kind === "branch_summary" ? "branch summary" : "compaction"}
          </span>
          {time && <span className="message-meta" style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{time}</span>}
        </button>

        {expanded && (
        <div
          className="compaction-card-body"
          style={{
            padding: "11px 13px 12px",
            // The summary is read as prose: the reply's type (the app's UI face, its
            // character spacing, its leading) at the thinking card's size. The CSS
            // rule for `.markdown-compaction-message` carries the same values, so the
            // title above and the intro line below are measured against one body.
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            letterSpacing: "normal",
            lineHeight: 1.7,
          }}
        >
          <div style={{ color: "var(--text)", fontSize: "calc(15px + var(--chat-font-size-offset, 0px))", fontWeight: "var(--fw-bold)", lineHeight: 1.35 }}>
             {t(kind === "branch_summary" ? "i18n.branchSummaryTitle" : "i18n.conversationCompacted")}
          </div>
          <div style={{ marginTop: 3, marginBottom: 10, color: "var(--text)" }}>
             {t(kind === "branch_summary" ? "i18n.branchSummaryDescription" : "i18n.compactionDescription")}
          </div>
          {parsedSummary.body ? (
            <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
          ) : (
             <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-caption)" }}>{t("i18n.noSummary")}</span>
          )}
          <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
        </div>
        )}
      </div>
    </div>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <details className="compaction-file-details">
       <summary>{t("i18n.fileContext", { details: parts.join(", ") })}</summary>
       {modifiedFiles.length > 0 && <CompactionFileList title={t("i18n.modifiedFiles")} files={modifiedFiles} />}
       {readFiles.length > 0 && <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />}
    </details>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function CustomMessageView({ message, cwd, onOpenFile, onContentToggle }: { message: CustomMessage; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void; onContentToggle?: (control: HTMLElement | null) => void }) {
  const { t, locale } = useI18n();
  const isHiddenDisplay = message.display === false;
  // A background subagent's report is a wall of text the main agent has already
  // read. Like the compaction note, the card opens collapsed with its header as
  // the toggle: opening a finished session (or watching one finish) lands on the
  // conversation, not on the last report, and one click expands it in place.
  const collapsesByDefault = message.customType === "pi-web:subagent-notification"
    || message.customType === "subagent-notification";
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay && !collapsesByDefault);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = collapsesByDefault
    // The compaction row reads `compaction`, not a type string; a folded report has
    // to read as the same kind of note, and the raw `pi-web:subagent-notification`
    // stays in the message the model reads.
    ? t("chat.subagentReportTitle")
    : formatCustomType(message.customType);
  // Pi Web's own note is named here, not by the generic labeler: its custom type
  // is a protocol string the model reads, and "pi-web:unparsed-tool-call" in the
  // middle of a transcript reads as a token, not as a note about the last reply.
  // Only the plain header reads it — a folded card is a subagent report, whose
  // label `title` already carries.
  const headerTitle = message.customType === UNPARSED_TOOL_CALL_CUSTOM_TYPE
    ? t("chat.unparsedToolCallTitle")
    : title;
  const time = formatTime(message.timestamp, locale);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        className="custom-message-card"
        style={{
          border: "none",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: isHiddenDisplay ? "var(--bg-subtle)" : "var(--bg)",
          opacity: isHiddenDisplay && !contentExpanded ? 0.82 : 1,
        }}
      >
        {collapsesByDefault ? (
          <button
            type="button"
            className="custom-message-header"
            aria-expanded={contentExpanded}
            onClick={(event) => {
              onContentToggle?.(event.currentTarget);
              setContentExpanded((value) => !value);
            }}
            title={t(contentExpanded ? "chat.collapseSubagentReport" : "chat.expandSubagentReport")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 10px",
              border: "none",
              background: "var(--bg-panel)",
              color: "var(--text-muted)",
              textAlign: "left",
              fontSize: "var(--fs-caption)",
              cursor: "pointer",
            }}
          >
            {/* The same chevron the compaction card turns, so a collapsed note
                and a collapsed report read as the same object. */}
            <svg
              className="compaction-card-chevron"
              data-expanded={contentExpanded ? "true" : "false"}
              width="11"
              height="11"
              viewBox="0 0 15 15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="4 2.5 7.5 6 4 9.5" />
            </svg>
            <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", fontWeight: "var(--fw-semibold)" }}>
              {title}
            </span>
            {time && <span className="message-meta" style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{time}</span>}
          </button>
        ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 10px",
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: "var(--fs-caption)",
          }}
        >
          <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", fontWeight: "var(--fw-semibold)" }}>
            {headerTitle}
          </span>
          {isHiddenDisplay && <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{t("i18n.hiddenExtensionMessage")}</span>}
          {time && <span className="message-meta" style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{time}</span>}
        </div>
        )}

        {contentExpanded ? (
          <div className="custom-message-body" style={{ padding: "6px 9px" }}>
            {images.length > 0 && (
              <div data-image-gallery style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: text ? 8 : 0 }}>
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    <ImagePreview key={i} src={src}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt=""
                        style={{ maxWidth: 240, maxHeight: 240, borderRadius: "var(--radius-sm)", objectFit: "contain", display: "block", border: "var(--hairline) solid var(--border)" }}
                      />
                    </ImagePreview>
                  );
                })}
              </div>
            )}
             {text ? <MarkdownBody className="markdown-custom-message" keepTextLayout cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody> : <span style={{ color: "var(--text-dim)", fontSize: "var(--fs-caption)" }}>{t("i18n.noMessage")}</span>}
          </div>
        ) : isHiddenDisplay ? (
          <button
            onClick={() => setContentExpanded(true)}
            style={{
              display: "block",
              width: "100%",
              padding: "8px 10px",
              border: "none",
              background: "transparent",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: "var(--fs-caption)",
              textAlign: "left",
            }}
          >
             {text ? previewText(text) : t("i18n.showExtensionMessage")}
          </button>
        ) : null}

        {/* A collapsed report shows nothing but its header, as the compaction
            card does: the Copy and details row belongs to the text it reports. */}
        {(contentExpanded || !collapsesByDefault) && (
        <div
          className="custom-message-footer"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 9px",
            background: "var(--bg-subtle)",
          }}
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              style={{
                padding: "3px 7px",
                border: "none",
                background: "var(--bg-selected)",
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: "var(--fs-micro)",
              }}
            >
               {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              style={{
                marginLeft: "auto",
                padding: "3px 7px",
                border: "none",
                background: "var(--bg-selected)",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: "var(--fs-micro)",
              }}
            >
              {isHiddenDisplay
                 ? (contentExpanded ? t("i18n.collapse") : t("i18n.expand"))
                 : (detailsExpanded ? t("i18n.hideDetails") : t("i18n.showDetails"))}
            </button>
          )}
        </div>
        )}

        {hasDetails && ((isHiddenDisplay && contentExpanded) || (!isHiddenDisplay && detailsExpanded)) && (
          <pre
            style={{
              margin: 0,
              padding: "9px 10px",
              background: "var(--bg)",
              color: "var(--text-muted)",
              fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 360,
              overflow: "auto",
              fontFamily: "var(--font-mono)",
            }}
          >
            {detailsText}
          </pre>
        )}
      </div>
    </div>
  );
}

function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageMediaType(img: ImageContent): string | undefined {
  return img.source?.media_type ?? (img as unknown as { mimeType?: string }).mimeType;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getToolCallInputText(block: ToolCallContent): string {
  return block.rawInput ?? JSON.stringify(block.input, null, 2);
}

const WRITE_VIEW_KEYS = new Set(["path", "file_path", "content"]);

// A write's file text in place of its JSON. Streamed input is still incomplete
// JSON, and any other argument (a mode, a title) would vanish from this view,
// so those calls, and an empty file, keep the generic view.
function getWrittenFileText(block: ToolCallContent): string | null {
  if (block.rawInput !== undefined || !isWriteToolName(block.toolName)) return null;
  const { content } = block.input;
  if (typeof content !== "string" || content === "") return null;
  const paths = ["path", "file_path"].filter((key) => Object.hasOwn(block.input, key));
  // The header shows only one path, truncated to 120 characters. Keep JSON when
  // replacing it with content would hide any path information.
  if (paths.length !== 1) return null;
  const path = block.input[paths[0]];
  if (typeof path !== "string" || path.length > 120) return null;
  return Object.keys(block.input).every((key) => WRITE_VIEW_KEYS.has(key)) ? content : null;
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function BashExecutionView({ message, sessionId }: { message: BashExecutionMessage; sessionId?: string }) {
  const { t } = useI18n();
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const isRunning = message.exitCode === undefined && !message.cancelled;
  // No output yet while running → keep the pending spinner; once chunks have
  // streamed in (bash_execution_update), show them as a partial result so a
  // long `!command` explains itself instead of looking stuck.
  const isPending = isRunning && !message.output;
  const isError = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputUrl = sessionId && message.fullOutputPath
    ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(message.fullOutputPath)}`
    : null;
  const showFullButton = message.truncated && fullOutputUrl && fullOutput === null;
  const displayOutput = fullOutput ?? message.output;

  async function loadFullOutput() {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const res = await fetch(fullOutputUrl);
      const d = await res.json() as { success?: boolean; data?: { output?: string }; error?: string };
      if (d.success) {
        setFullOutput(d.data?.output ?? "");
      } else {
        setFullError(d.error ?? "failed");
      }
    } catch (e) {
      setFullError(String(e));
    } finally {
      setLoadingFull(false);
    }
  }

  // Reuse the existing ToolCallBlock so user-run bash looks identical to an
  // agent-run bash tool call: same header, collapse behavior, result pane.
  // Synthesize an equivalent ToolCallContent + ToolResultMessage pair.
  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? ""}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending
    ? undefined
    : {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName,
        content: displayOutput ? [{ type: "text", text: isRunning ? `${displayOutput}\n…` : displayOutput }] : [],
        isError,
        timestamp: message.timestamp,
      };
  return (
    <div style={{ margin: "6px 0" }}>
      <ToolCallBlock
        block={block}
        result={result}
        defaultExpanded={isRunning}
        onExpandedChange={(next) => {
          // Phase 6: the full output loaded behind "view full output" is the
          // biggest thing this card can hold; collapsing it gives the text back.
          if (!next && shouldReleaseOnCollapse(fullOutput)) {
            setFullOutput(null);
            setFullError(null);
          }
        }}
      />
      {message.truncated && fullOutputUrl && (
        <div style={{ padding: "4px 10px", fontSize: "var(--fs-micro)", marginTop: -1 }}>
          {showFullButton && (
            <button
              onClick={loadFullOutput}
              disabled={loadingFull}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: loadingFull ? "default" : "pointer", fontSize: "var(--fs-micro)", padding: 0, textDecoration: "underline" }}
            >
              {loadingFull ? "loading…" : "view full output"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void import("@/lib/desktop-native").then(({ downloadUrlAsFile }) =>
                downloadUrlAsFile(`${fullOutputUrl}&download=1`, "bash-output.log"),
              );
            }}
            style={{
              marginLeft: showFullButton ? 10 : 0,
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--accent)",
              fontSize: "var(--fs-micro)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            download full output
          </button>
          {fullError && <span style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>({fullError})</span>}
        </div>
      )}
      {message.truncated && !fullOutputUrl && (
        <div className="tool-output-truncation-note" role="status">
          {message.fullOutputError
            ? t("chat.fullOutputNotSaved", { error: message.fullOutputError })
            : t("chat.outputTruncated")}
        </div>
      )}
    </div>
  );
}
