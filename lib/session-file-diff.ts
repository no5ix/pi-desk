import type { AgentMessage, AssistantContentBlock, ToolResultMessage } from "./types";
import { fillContentGaps } from "./assistant-content";
import { resolveLocalFilePath } from "./file-links";
import { isApplyPatchToolName, isEditToolName, isWriteToolName } from "./tool-names";
import {
  applyPatchPreviewToFiles,
  extractApplyPatchPaths,
  getApplyPatchInputText,
  parseApplyPatchInput,
} from "./apply-patch";
import { relative } from "path";
import type { SplitDiffFile } from "./patch";

/**
 * The changes one session made to one file, as a unified patch.
 *
 * A session's `Edited files` card counts the lines its own `write` / `edit` /
 * `apply_patch` calls changed, so a file whose changes are already committed
 * (a clean working tree, a commit the agent made itself) has no git diff at
 * all. The card's row therefore needs the diff recorded *in the session*: the
 * hunks the tool calls reported, in the order they happened.
 */
export interface SessionFileDiff {
  /** Unified-diff text (one file section, one hunk per recorded change). */
  patch: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  /** The tool calls that touched the file. */
  changes: number;
}

type ChangeKind = "add" | "update" | "delete";

interface FileChange {
  kind: ChangeKind;
  /** Unified-diff hunks of this call, without file headers. */
  hunks: string[];
}

/** A write of an enormous file is not a readable diff; its head is, plus the notice. */
const MAX_HUNK_LINES = 2000;
const TRUNCATED_NOTE = "\\ diff truncated: the change is larger than this panel shows";

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  // A trailing newline is the end of the last line, not an empty extra line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function truncatedNotice(kept: number, total: number): string[] {
  return [
    `@@ -0,0 +${kept} @@ unchanged lines follow`,
    ` … ${total - kept} more lines in this change …`,
    TRUNCATED_NOTE,
  ];
}

/** Every line of a `write` reads as added: the tool does not report what it replaced. */
function writeHunks(content: string): string[] {
  const lines = splitLines(content);
  if (lines.length > MAX_HUNK_LINES) {
    return [
      ...lines.slice(0, MAX_HUNK_LINES).map((line) => `+${line}`),
      ...truncatedNotice(MAX_HUNK_LINES, lines.length),
    ];
  }
  return lines.map((line) => `+${line}`);
}

/**
 * pi's numbered diff (`+124 text`, `-124 text`, ` 120 text`) as a hunk. Only a
 * call whose result carries no `patch` needs this fallback.
 */
function numberedDiffHunks(diff: string): string[] {
  const hunks: string[] = [];
  for (const raw of diff.split(/\r?\n/)) {
    const signed = raw.match(/^([-+])\s*\d+\s(.*)$/);
    if (signed) {
      hunks.push(`${signed[1]}${signed[2]}`);
      continue;
    }
    const context = raw.match(/^\s+\d+\s(.*)$/);
    if (context) hunks.push(` ${context[1]}`);
    else if (raw.trim()) hunks.push(` ${raw}`);
  }
  return hunks;
}

/**
 * A hunk from an old/new pair, with the shared prefix and suffix trimmed away.
 * Models quote surrounding context in `oldText` / `newText`, and the result
 * carries no patch when the call came from an extension, so this is the last
 * fallback: it shows what the replacement changed, not the whole quote.
 */
function replacementHunks(before: string, after: string): string[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const context = 3;
  const from = Math.max(0, start - context);
  const tailStart = Math.max(start, a.length - end);
  const hunks: string[] = [];
  for (let i = from; i < start; i++) hunks.push(` ${a[i]}`);
  for (let i = start; i < a.length - end; i++) hunks.push(`-${a[i]}`);
  for (let i = start; i < b.length - end; i++) hunks.push(`+${b[i]}`);
  for (let i = tailStart; i < Math.min(tailStart + context, a.length); i++) hunks.push(` ${a[i]}`);
  return hunks;
}

/** Split-diff rows back to unified lines, so an apply_patch reads like the rest. */
function splitFileHunks(file: SplitDiffFile): string[] {
  const hunks: string[] = [];
  for (const row of file.rows) {
    if (row.type === "hunk") {
      hunks.push(row.text);
      continue;
    }
    if (row.type !== "line") continue;
    if (row.left.type === "removed") hunks.push(`-${row.left.text}`);
    if (row.right.type === "added") hunks.push(`+${row.right.text}`);
    if (row.left.type === "context" && row.right.type === "context") hunks.push(` ${row.left.text}`);
  }
  return hunks;
}

/** `*** Add File: p` / `*** Update File: p` / `*** Delete File: p` in a patch document. */
function patchOperation(patchText: string, targetPath: string): ChangeKind | null {
  for (const match of patchText.matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) {
    const operation = match[1];
    const rawPath = (match[2] ?? "").trim();
    if (!rawPath) continue;
    if (rawPath === targetPath || rawPath.endsWith(`/${targetPath}`) || targetPath.endsWith(`/${rawPath}`)) {
      return operation === "Add" ? "add" : operation === "Delete" ? "delete" : "update";
    }
  }
  return null;
}

/** Strip a unified patch's file headers; its hunks are what the panel stacks. */
function hunkBody(patch: string): string[] {
  const lines: string[] = [];
  let inHunk = false;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("@@")) inHunk = true;
    if (!inHunk) continue;
    lines.push(line);
  }
  return lines;
}

function editCallChanges(result: ToolResultMessage | undefined, input: Record<string, unknown> | undefined): FileChange[] {
  const details = result?.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    if (typeof record.patch === "string" && record.patch.trim()) {
      const body = hunkBody(record.patch);
      if (body.length > 0) return [{ kind: "update", hunks: body }];
    }
    if (typeof record.diff === "string" && record.diff.trim()) {
      return [{ kind: "update", hunks: numberedDiffHunks(record.diff) }];
    }
  }
  const edits = Array.isArray(input?.edits) ? input.edits : input ? [input] : [];
  const changes: FileChange[] = [];
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") continue;
    const { oldText, newText, old_string, new_string } = edit as Record<string, unknown>;
    const before = oldText ?? old_string;
    const after = newText ?? new_string;
    if (typeof before !== "string" || typeof after !== "string") continue;
    changes.push({ kind: "update", hunks: replacementHunks(before, after) });
  }
  return changes;
}

function applyPatchCallChanges(input: Record<string, unknown> | undefined, result: ToolResultMessage | undefined, rawTarget: string): FileChange[] {
  const patchText = getApplyPatchInputText(input);
  const details = result?.details;
  const files = (details && typeof details === "object" && !Array.isArray(details)
    ? applyPatchPreviewToFiles((details as Record<string, unknown>).preview)
    : null) ?? parseApplyPatchInput(patchText);
  const operation = patchOperation(patchText, rawTarget);
  const kind: ChangeKind = operation ?? (files?.some((file) => file.oldPath === "/dev/null") ? "add" : "update");
  const matched = (files ?? []).filter((file) => {
    const path = file.newPath ?? file.oldPath;
    return Boolean(path) && (path === rawTarget || rawTarget.endsWith(String(path)) || String(path).endsWith(rawTarget));
  });
  const hunks = matched.flatMap(splitFileHunks);
  return [{ kind, hunks: hunks.length > 0 ? hunks : hunkBody(patchText) }];
}

/**
 * A delete records no content, so its hunk says what happened: the panel shows
 * the file as removed, and the session record holds no surviving text.
 */
function deleteHunks(): string[] {
  return ["@@ -1,1 +0,0 @@", "- (this session deleted the file)"];
}

interface CollectedCall {
  toolName: string;
  input: Record<string, unknown> | undefined;
  result: ToolResultMessage | undefined;
  /** The path exactly as the call named it, for matching an apply_patch document. */
  rawPath: string;
}

function isFileWritingTool(toolName: string): boolean {
  return isWriteToolName(toolName) || isEditToolName(toolName) || isApplyPatchToolName(toolName);
}

/**
 * Every successful file-writing call in `messages` that names `filePath`,
 * oldest first. `write` / `edit` / `apply_patch` calls that never got a result,
 * or got an error result, are skipped: the file did not change.
 */
export function collectSessionFileCalls(
  messages: AgentMessage[],
  filePath: string,
  cwd?: string,
): CollectedCall[] {
  const results = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.role === "toolResult") results.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
  }
  const calls: CollectedCall[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const content = fillContentGaps((message as { content?: AssistantContentBlock[] }).content);
    for (const block of content) {
      if (block.type !== "toolCall" || !isFileWritingTool(block.toolName)) continue;
      const result = results.get(block.toolCallId);
      if (!result || result.isError) continue;
      // `write` and `edit` name their file in the input; an apply_patch names
      // each of its files inside the patch document.
      const rawPaths = isApplyPatchToolName(block.toolName)
        ? extractApplyPatchPaths(getApplyPatchInputText(block.input, block.rawInput))
        : [readRawPath(block.input)].filter((value): value is string => Boolean(value));
      let matchedRaw: string | null = null;
      for (const rawPath of rawPaths) {
        const resolved = resolveLocalFilePath(rawPath, cwd);
        if (resolved === filePath) {
          matchedRaw = rawPath;
          break;
        }
      }
      if (!matchedRaw) continue;
      calls.push({ toolName: block.toolName, input: block.input, result, rawPath: matchedRaw });
    }
  }
  return calls;
}

function readRawPath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const value = input.file_path ?? input.path;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The unified patch of everything this session changed in one file, or null
 * when the session never wrote it.
 *
 * Each recorded call becomes one hunk under a single file header. Hunk line
 * numbers are the ones the tool reported at the time, so hunks of a long edit
 * chain are not a single re-applicable patch — they are the session's change
 * log for that file, which is what the panel shows.
 */
export function buildSessionFileDiff(
  messages: AgentMessage[],
  filePath: string,
  cwd?: string,
): SessionFileDiff | null {
  const calls = collectSessionFileCalls(messages, filePath, cwd);
  if (calls.length === 0) return null;

  const changes: FileChange[] = [];
  for (const call of calls) {
    if (isWriteToolName(call.toolName)) {
      const content = call.input?.content;
      changes.push({ kind: "add", hunks: typeof content === "string" ? writeHunks(content) : [] });
      continue;
    }
    if (isEditToolName(call.toolName)) {
      changes.push(...editCallChanges(call.result, call.input));
      continue;
    }
    changes.push(...applyPatchCallChanges(call.input, call.result, call.rawPath));
  }

  const last = changes[changes.length - 1];
  const first = changes[0];
  const status: SessionFileDiff["status"] = last?.kind === "delete"
    ? "deleted"
    : first?.kind === "add"
      ? "added"
      : "modified";

  const header = headerPaths(filePath, cwd, status);
  const body: string[] = [];
  for (const change of changes) {
    if (change.kind === "delete") {
      body.push(...deleteHunks());
      continue;
    }
    if (change.hunks.length === 0) continue;
    if (!change.hunks[0].startsWith("@@")) body.push(`@@ session change +${change.hunks.length} @@`);
    body.push(...change.hunks);
  }

  const patch = [header.oldPath, header.newPath, ...body].join("\n");
  let additions = 0;
  let deletions = 0;
  for (const line of body) {
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { patch, status, additions, deletions, changes: calls.length };
}

function headerPaths(filePath: string, cwd: string | undefined, status: SessionFileDiff["status"]): { oldPath: string; newPath: string } {
  const shown = displayPath(filePath, cwd);
  // Paths with spaces keep git's quoted form out: the renderer splits on them.
  const safe = shown.includes(" ") ? `"${shown}"` : shown;
  const oldPath = status === "added" ? "--- /dev/null" : `--- ${safe}`;
  const newPath = status === "deleted" ? "+++ /dev/null" : `+++ ${safe}`;
  return { oldPath, newPath };
}

/** The file relative to the session's folder when it sits inside it. */
export function displayPath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;
  const rel = relative(cwd, filePath);
  if (!rel || rel.startsWith("..") || rel.includes(":")) return filePath;
  return rel;
}

/** Counts of one unified patch, for a caller that built the text itself. */
export function countPatchLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}
