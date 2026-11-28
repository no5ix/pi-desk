import { isRecord } from "./is-record.ts";

/**
 * Delta encoding of `tool_execution_update` (Phase 7).
 *
 * A tool update carries the tool's **whole partial result**: bash streams its
 * output tail per chunk, a codemode script publishes a snapshot of every call
 * it has made each time one starts or finishes. On the wire that is quadratic
 * in the size of the output — 200 bash chunks of a 200 KB log is 40 MB, and the
 * client throws every copy away except the last.
 *
 * The encoder runs per SSE connection (it is the connection's client that holds
 * the baseline) and turns each update into the difference against what that
 * client was last given:
 *
 *  - an unchanged `details` is **omitted** (the client keeps its own copy);
 *  - a text block that grew is sent as `textAppend` (the suffix only);
 *  - blocks appended to the content array are sent as `contentAppend`;
 *  - a codemode `details.calls` list that only grew is sent as `callsAppend`;
 *  - anything else is sent `full`, which is what the stream sent before.
 *
 * Two properties make this safe:
 *
 *  - **`rev`**: a per-tool-call sequence number on this connection. A delta
 *    whose `rev` is not the client's next one is not applicable, and the client
 *    keeps the state it has (the tool's `tool_execution_end` and the tool result
 *    message that follows are authoritative anyway).
 *  - **the baseline is only advanced when the bytes are on the wire.** A delta
 *    dropped by backpressure invalidates that tool call's baseline, so the next
 *    update goes out whole. Deltas stay droppable, which is what the stream's
 *    high-water mark needs; the client never sees a hole it cannot close.
 *
 * Clients that did not ask for deltas (no `toolUpdates=delta` on the event
 * stream) get the old full events: the encoder is opt-in per connection.
 */

export const TOOL_UPDATE_WIRE_FULL = "full" as const;
export const TOOL_UPDATE_WIRE_DELTA = "delta" as const;

/** One tool call's known state, on the connection and on the client. */
export interface ToolUpdateState {
  partialResult: unknown;
  rev: number;
}

export interface ToolUpdateDeltaEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName?: string;
  isError?: unknown;
  mode: typeof TOOL_UPDATE_WIRE_FULL | typeof TOOL_UPDATE_WIRE_DELTA;
  rev: number;
  /** Content block count the delta applies to. */
  base?: number;
  textAppend?: string;
  contentAppend?: unknown[];
  callsAppend?: unknown[];
  callsCount?: number;
  detailsReplace?: unknown;
  partialResult?: unknown;
}

/** A tool call's baseline, kept as signatures: the SDK may mutate its objects. */
interface Baseline {
  rev: number;
  blockCount: number;
  blockSignatures: string[];
  tailText: string;
  tailIsText: boolean;
  detailsJson: string | undefined;
  detailsHash: string | undefined;
  callsLength: number | undefined;
  callsPrefixHash: string | undefined;
}

const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a over the characters, base36: cheap, stable, good enough to prove equality. */
export function hashText(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stringifyStable(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : json;
  } catch {
    // Circular or non-serializable: treated as "unknown", so the update goes full.
    return undefined;
  }
}

function blockSignature(block: unknown): string {
  if (!isRecord(block)) return `x:${hashText(stringifyStable(block) ?? "?")}`;
  const type = typeof block.type === "string" ? block.type : "text";
  if (type === "text" && typeof block.text === "string") return `text:${block.text.length}:${hashText(block.text)}`;
  if (type === "thinking" && typeof block.thinking === "string") {
    return `thinking:${block.thinking.length}:${hashText(block.thinking)}`;
  }
  const json = stringifyStable(block) ?? "";
  return `${type}:${json.length}:${hashText(json)}`;
}

function callsOf(details: unknown): unknown[] | undefined {
  if (!isRecord(details) || !Array.isArray(details.calls)) return undefined;
  return details.calls;
}

function prefixHash(items: readonly unknown[], count: number): string {
  let text = "";
  for (let i = 0; i < count && i < items.length; i += 1) {
    text += blockSignature(items[i]);
    text += ",";
  }
  return hashText(text);
}

function contentBlocks(partialResult: unknown): unknown[] | undefined {
  if (!isRecord(partialResult) || !Array.isArray(partialResult.content)) return undefined;
  return partialResult.content as unknown[];
}

function tailTextOf(blocks: readonly unknown[]): { text: string; isText: boolean } {
  const last = blocks[blocks.length - 1];
  if (isRecord(last) && (last.type === undefined || last.type === "text") && typeof last.text === "string") {
    return { text: last.text, isText: true };
  }
  return { text: "", isText: false };
}

/**
 * The connection's encoder. One per SSE stream: the baseline is what *that*
 * browser was last given.
 */
export interface ToolUpdateEncoder {
  /** Rewrite one `tool_execution_update` for the wire. Other events pass through. */
  encode(event: unknown): unknown;
  /** Drop the baseline of one tool call (a dropped delta, a client that lost state). */
  invalidate(toolCallId: unknown): void;
  /** Tool calls this connection is tracking (bounded by the run). */
  trackedCount(): number;
}

export const TOOL_UPDATE_BASELINE_CAP = 64;

export function createToolUpdateEncoder(): ToolUpdateEncoder {
  const baselines = new Map<unknown, Baseline>();

  function bump(baseline: Baseline): void {
    baseline.rev += 1;
  }

  function remember(toolCallId: unknown, partialResult: unknown, rev: number): void {
    const blocks = contentBlocks(partialResult);
    const details = isRecord(partialResult) ? partialResult.details : undefined;
    const detailsJson = details === undefined ? undefined : stringifyStable(details);
    const calls = callsOf(details);
    const baseline: Baseline = {
      rev,
      blockCount: blocks?.length ?? 0,
      blockSignatures: (blocks ?? []).map(blockSignature),
      tailText: tailTextOf(blocks ?? []).text,
      tailIsText: tailTextOf(blocks ?? []).isText,
      detailsJson,
      detailsHash: detailsJson === undefined ? undefined : hashText(detailsJson),
      callsLength: calls?.length,
      callsPrefixHash: calls === undefined ? undefined : prefixHash(calls, calls.length),
    };
    baselines.set(toolCallId, baseline);
    // A finished tool call leaves a baseline behind; a long run would otherwise
    // grow this map with every call. The newest calls are the ones that stream.
    if (baselines.size > TOOL_UPDATE_BASELINE_CAP) {
      const oldest = baselines.keys().next();
      if (!oldest.done) baselines.delete(oldest.value);
    }
  }

  function full(toolCallId: unknown, event: Record<string, unknown>): ToolUpdateDeltaEvent {
    const rev = (baselines.get(toolCallId)?.rev ?? 0) + 1;
    remember(toolCallId, event.partialResult, rev);
    return {
      type: "tool_execution_update",
      toolCallId: toolCallId as string,
      ...(typeof event.toolName === "string" ? { toolName: event.toolName } : {}),
      ...(event.isError !== undefined ? { isError: event.isError } : {}),
      mode: TOOL_UPDATE_WIRE_FULL,
      rev,
      partialResult: event.partialResult,
    };
  }

  function encode(event: unknown): unknown {
    if (!isRecord(event) || event.type !== "tool_execution_update") return event;
    const toolCallId = event.toolCallId;
    const baseline = typeof toolCallId === "string" ? baselines.get(toolCallId) : undefined;
    const partialResult = event.partialResult;
    if (!baseline) return full(toolCallId, event);

    const blocks = contentBlocks(partialResult);
    if (!blocks) return full(toolCallId, event);

    const signatures = blocks.map(blockSignature);
    const tail = tailTextOf(blocks);
    const details = isRecord(partialResult) ? partialResult.details : undefined;
    const detailsJson = details === undefined ? undefined : stringifyStable(details);

    // The tail text block grew, and everything before it is what the client has.
    const prefixCount = baseline.blockCount - 1;
    const prefixMatches = signatures.length > prefixCount
      && baseline.blockSignatures.slice(0, Math.max(prefixCount, 0)).every(
        (signature, index) => signatures[index] === signature,
      );
    const tailGrew = baseline.tailIsText
      && tail.isText
      && tail.text.length > baseline.tailText.length
      && tail.text.startsWith(baseline.tailText);
    // The block the append lands on is the baseline's own tail block: same index,
    // text on both sides. Its *signature* differs by construction (it grew), so
    // it is not compared here — that is what `textAppend` is for.
    const sameTailBlock = prefixMatches
      && baseline.tailIsText
      && tail.isText
      && blocks.length >= baseline.blockCount;

    const delta: ToolUpdateDeltaEvent = {
      type: "tool_execution_update",
      toolCallId: toolCallId as string,
      ...(typeof event.toolName === "string" ? { toolName: event.toolName } : {}),
      ...(event.isError !== undefined ? { isError: event.isError } : {}),
      mode: TOOL_UPDATE_WIRE_DELTA,
      rev: baseline.rev + 1,
    };
    let usable = false;

    if (sameTailBlock && tailGrew) {
      delta.base = baseline.blockCount;
      delta.textAppend = tail.text.slice(baseline.tailText.length);
      if (blocks.length > baseline.blockCount) delta.contentAppend = blocks.slice(baseline.blockCount);
      usable = true;
    } else if (
      signatures.length >= baseline.blockCount
      && baseline.blockSignatures.every((signature, index) => signatures[index] === signature)
    ) {
      delta.base = baseline.blockCount;
      if (blocks.length > baseline.blockCount) delta.contentAppend = blocks.slice(baseline.blockCount);
      usable = true;
    }

    if (!usable) return full(toolCallId, event);

    // details: omit when unchanged, append the calls a codemode script added,
    // otherwise send the whole details object.
    const calls = callsOf(details);
    if (detailsJson === undefined && baseline.detailsJson === undefined) {
      // Nothing to send: the client keeps what it has.
    } else if (detailsJson === baseline.detailsJson) {
      // Unchanged: omitting it is the saving.
    } else if (
      calls !== undefined
      && baseline.callsLength !== undefined
      && baseline.callsLength <= calls.length
      && prefixHash(calls, baseline.callsLength) === baseline.callsPrefixHash
    ) {
      delta.callsAppend = calls.slice(baseline.callsLength);
      delta.callsCount = calls.length;
    } else {
      delta.detailsReplace = details;
    }

    bump(baseline);
    remember(toolCallId, partialResult, baseline.rev);
    return delta;
  }

  return {
    encode,
    invalidate(toolCallId: unknown) {
      baselines.delete(toolCallId);
    },
    trackedCount() {
      return baselines.size;
    },
  };
}

/**
 * The client's side of the same contract. Returns the state to render, plus
 * `ok: false` when the delta did not apply (a gap in `rev`, a base the client
 * does not have): the caller keeps the state it already has, because the tool's
 * `tool_execution_end` and the tool result message that follows are the
 * authoritative copy of what the tool produced.
 */
export function applyToolUpdateDelta(
  known: ToolUpdateState | undefined,
  event: unknown,
): { state: ToolUpdateState | undefined; ok: boolean } {
  if (!isRecord(event) || event.type !== "tool_execution_update") return { state: known, ok: true };
  const mode = event.mode;
  if (mode === undefined || mode === TOOL_UPDATE_WIRE_FULL) {
    const rev = typeof event.rev === "number" ? event.rev : 0;
    return { state: { partialResult: event.partialResult, rev }, ok: true };
  }
  const rev = typeof event.rev === "number" ? event.rev : Number.NaN;
  if (!known) {
    // A delta for a tool call this page has never seen: the stream opened mid-call
    // (a reconnect, a second tab). The end and the tool result carry the truth.
    return { state: known, ok: false };
  }
  if (rev !== known.rev + 1) return { state: known, ok: false };

  const previous = known.partialResult;
  if (!isRecord(previous) || !Array.isArray(previous.content)) return { state: known, ok: false };
  const content = previous.content as unknown[];
  const base = typeof event.base === "number" ? event.base : content.length;
  if (base < 0 || base > content.length) return { state: known, ok: false };

  const isError = "isError" in event ? event.isError : previous.isError;

  let next: unknown[] = content.slice(0, base);
  if (typeof event.textAppend === "string") {
    const last = next[next.length - 1];
    if (!isRecord(last) || (last.type !== undefined && last.type !== "text") || typeof last.text !== "string") {
      return { state: known, ok: false };
    }
    next[next.length - 1] = { ...last, text: last.text + event.textAppend };
  }
  if (Array.isArray(event.contentAppend)) next = next.concat(event.contentAppend);

  let details = previous.details;
  if (Array.isArray(event.callsAppend) && isRecord(details) && Array.isArray(details.calls)) {
    const calls = details.calls as unknown[];
    const append = event.callsAppend as unknown[];
    const keepCount = typeof event.callsCount === "number" ? event.callsCount - append.length : calls.length;
    if (keepCount < 0 || keepCount > calls.length) return { state: known, ok: false };
    details = { ...details, calls: [...calls.slice(0, keepCount), ...append] };
  } else if ("detailsReplace" in event) {
    details = event.detailsReplace;
  }

  return {
    state: { partialResult: { ...previous, content: next, details, isError }, rev },
    ok: true,
  };
}

/** How many tool calls one side tracks delta baselines for. */
export const TOOL_UPDATE_STATE_CAP = 64;

/**
 * Remember one tool call's reconstructed state, evicting the oldest past the cap.
 *
 * A baseline is only useful while its tool call streams. A run that makes 5 000
 * calls must not leave 5 000 reconstructions behind, and the calls that stream
 * are the newest ones, so the insertion-ordered Map's oldest entry goes first.
 */
export function rememberToolUpdateState(
  states: Map<unknown, ToolUpdateState>,
  toolCallId: unknown,
  state: ToolUpdateState,
): void {
  states.delete(toolCallId);
  states.set(toolCallId, state);
  while (states.size > TOOL_UPDATE_STATE_CAP) {
    const oldest = states.keys().next();
    if (oldest.done) break;
    states.delete(oldest.value);
  }
}
