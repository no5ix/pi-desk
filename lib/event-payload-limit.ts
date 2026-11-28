import { isRecord } from "./is-record.ts";

/**
 * Per-event payload limits (Phase 7).
 *
 * The stream's backlog limit bounds what is *queued*; it never bounds one event.
 * A single event can be enormous on its own: a 12 MB screenshot in a tool
 * result's `message_end`, a 40 MB `details` object an extension persisted, a
 * bash output that ran past the terminal's own cap. One such event has to be
 * allocated, stringified and queued before the socket notices anything, so the
 * bound belongs at the structured event, before serialization.
 *
 * Rules this module implements:
 *
 *  - the limit is a **byte budget on the serialized event**, and it applies to
 *    every event the stream forwards, not to selected tool-result fields;
 *  - cutting happens **in the structure**: the largest text values, the array
 *    tails, the base64 image payloads. A JSON string is never chopped mid-token,
 *    so the client always receives a valid event;
 *  - cutting is **observable**: the event carries a `payloadTruncated` marker
 *    naming what was dropped, how much, and where the full bytes live when they
 *    can be fetched (an entry-scoped route for a tool result, the session file
 *    in general). The UI shows the marker; it never renders a shortened value as
 *    if it were complete;
 *  - essential fields are never cut: identifiers, types, roles, statuses,
 *    timestamps, usage, model, mime types, and the retrieval URLs themselves.
 */

/** One event's serialized budget. `PI_WEB_MAX_EVENT_PAYLOAD_BYTES` overrides. */
export const MAX_EVENT_PAYLOAD_BYTES = 1024 * 1024;
export const MIN_EVENT_PAYLOAD_BYTES = 64 * 1024;
export const MAX_EVENT_PAYLOAD_BYTES_CEILING = 8 * 1024 * 1024;

/** Values shorter than this are never cut: the note would cost more than the value. */
export const PAYLOAD_BULK_MIN_CHARS = 512;
/** A cut text value keeps this much of its head, so a collapsed card says something. */
export const PAYLOAD_KEEP_CHARS = 4_096;
/** An array keeps this many of its leading items. */
export const PAYLOAD_KEEP_ITEMS = 20;
/** Room left for the cut note and the marker when a string is trimmed to size. */
export const NOTE_OVERHEAD_CHARS = 256;

const ESSENTIAL_KEYS: ReadonlySet<string> = new Set([
  "type", "role", "id", "entryId", "toolCallId", "toolCallName", "toolName", "name",
  "parentToolCallId", "isError", "isStreaming", "timestamp", "stopReason", "usage",
  "model", "provider", "responseModel", "customType", "sessionId", "blockIndex",
  "contentIndex", "index", "display", "mimeType", "media_type", "mime", "encoding",
  "version", "status", "code", "exitCode", "rev", "mode", "url", "path", "filePath",
  "sessionFile", "leafId", "leafEntryId", "oldestEntryId", "targetId", "base",
  "commands", "slashCommands", "truncated", "deferred",
]);

export interface PayloadTruncation {
  /** Characters of text dropped. */
  chars: number;
  /** Array items dropped. */
  items: number;
  /** base64 image payloads replaced by a note. */
  images: number;
  /** Dotted paths of what was cut (newest first, capped). */
  fields: string[];
  /** Where the full bytes of the biggest cut live, when they can be fetched. */
  contentUrl?: string;
}
export interface PayloadLimitOptions {
  limitBytes: number;
  sessionId?: string;
  entryId?: string;
}

/** `PI_WEB_MAX_EVENT_PAYLOAD_BYTES`, clamped into a usable range. 0 turns the limit off. */
export function resolveMaxEventPayloadBytes(raw: string | undefined): number {
  if (raw === undefined || raw === "") return MAX_EVENT_PAYLOAD_BYTES;
  const text = raw.trim();
  if (text === "off" || text === "none" || text === "disabled") return 0;
  const value = Number(text);
  if (!Number.isFinite(value)) return MAX_EVENT_PAYLOAD_BYTES;
  if (value <= 0) return 0;
  if (value < MIN_EVENT_PAYLOAD_BYTES) return MIN_EVENT_PAYLOAD_BYTES;
  return Math.min(value, MAX_EVENT_PAYLOAD_BYTES_CEILING);
}

interface CutSite {
  path: string;
  kind: "string" | "array" | "image" | "drop";
  /** Estimated bytes this site can give up. */
  saving: number;
  /** @param needToShed bytes this cut has to give up for the event to clear the budget. */
  apply: (needToShed: number) => number;
}

function isBase64ImageBlock(node: unknown): boolean {
  if (!isRecord(node) || node.type !== "image") return false;
  if (typeof node.data === "string" && node.data.length >= PAYLOAD_BULK_MIN_CHARS) return true;
  return isRecord(node.source) && node.source.type === "base64" && typeof node.source.data === "string"
    && node.source.data.length >= PAYLOAD_BULK_MIN_CHARS;
}

function imageNote(block: unknown): Record<string, unknown> {
  const mime = isRecord(block)
    ? (typeof block.mimeType === "string" ? block.mimeType
      : (isRecord(block.source) && typeof block.source.media_type === "string" ? block.source.media_type : undefined))
    : undefined;
  const bytes = isRecord(block)
    ? (typeof block.data === "string" ? block.data.length
      : (isRecord(block.source) && typeof block.source.data === "string" ? block.source.data.length : 0))
    : 0;
  return {
    type: "text",
    text: `[image omitted from this stream: ${mime ?? "unknown type"}, ~${Math.round(bytes * 3 / 4)} bytes]`,
  };
}

function textNote(kept: string, dropped: number): string {
  return `${kept}\n\n[… ${dropped} characters cut from this stream · payload limit]`;
}

function collectSites(root: unknown, options: PayloadLimitOptions, sink: { contentUrl?: string }): CutSite[] {
  const sites: CutSite[] = [];
  let visited = 0;

  /** Cut a base64 image block to a counted note. */
  function imageSite(node: unknown[], index: number, path: string): void {
    const item = node[index];
    const json = JSON.stringify(item) ?? "";
    sites.push({
      path: `${path}[${index}]`,
      kind: "image",
      saving: Math.max(0, json.length - 96),
      apply: () => {
        node[index] = imageNote(item);
        return 0;
      },
    });
  }

  /** Cut a long string a card shows, keeping its head. */
  function stringSite(node: Record<string, unknown>, key: string, path: string, contentUrl?: () => void): void {
    const text = node[key] as string;
    sites.push({
      path,
      kind: "string",
      saving: text.length - PAYLOAD_KEEP_CHARS,
      apply: (needToShed: number) => {
        // Shed what the budget asks and no more: a card showing 250 KB of a
        // 900 KB log is a better card than one showing 4 KB of it.
        const keep = Math.min(
          text.length - 64,
          Math.max(PAYLOAD_KEEP_CHARS, text.length - Math.max(0, needToShed) - NOTE_OVERHEAD_CHARS),
        );
        const dropped = text.length - keep;
        node[key] = textNote(text.slice(0, keep), dropped);
        contentUrl?.();
        return dropped;
      },
    });
  }

  /**
   * A tool result's content array gets its own pass. The text in it is the
   * bytes that overflow a stream, and it is the one value the session file
   * keeps in full, so a cut here can name where the card fetches it back from.
   */
  function toolResultContentSite(parent: Record<string, unknown>, blocks: unknown[], path: string): void {
    arraySite(blocks, path);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (isBase64ImageBlock(block)) {
        imageSite(blocks, index, path);
        continue;
      }
      if (isRecord(block) && typeof block.text === "string" && block.text.length >= PAYLOAD_BULK_MIN_CHARS) {
        stringSite(block, "text", `${path}[${index}].text`, () => {
          if (!options.sessionId || !options.entryId) return;
          const url = `/api/sessions/${encodeURIComponent(options.sessionId)}`
            + `/entries/${encodeURIComponent(options.entryId)}/tool-result-content?blockIndex=${index}`;
          parent.payloadContentUrl = url;
          sink.contentUrl = url;
        });
        continue;
      }
      walk(block, `${path}[${index}]`);
    }
  }

  /** The tail of a long array goes first: a card shows its head. */
  function arraySite(node: unknown[], path: string): void {
    if (node.length <= PAYLOAD_KEEP_ITEMS) return;
    const dropped = node.length - PAYLOAD_KEEP_ITEMS;
    sites.push({
      path: `${path}[]`,
      kind: "array",
      saving: Math.max(0, JSON.stringify(node.slice(PAYLOAD_KEEP_ITEMS))?.length ?? 0),
      apply: () => {
        node.length = PAYLOAD_KEEP_ITEMS;
        return dropped;
      },
    });
  }

  function walk(node: unknown, path: string): void {
    if (visited > 20_000) return;
    if (Array.isArray(node)) {
      visited += 1;
      arraySite(node, path);
      for (let index = 0; index < node.length; index += 1) {
        const item = node[index];
        if (isBase64ImageBlock(item)) {
          imageSite(node, index, path);
          continue;
        }
        if (typeof item === "string" && item.length >= PAYLOAD_BULK_MIN_CHARS) {
          sites.push({
            path: `${path}[${index}]`,
            kind: "string",
            saving: item.length - PAYLOAD_KEEP_CHARS,
            apply: (needToShed: number) => {
              const keep = Math.min(
                item.length - 64,
                Math.max(PAYLOAD_KEEP_CHARS, item.length - Math.max(0, needToShed) - NOTE_OVERHEAD_CHARS),
              );
              const dropped = item.length - keep;
              node[index] = textNote(item.slice(0, keep), dropped);
              return dropped;
            },
          });
          continue;
        }
        walk(item, `${path}[${index}]`);
      }
      return;
    }
    if (!isRecord(node)) return;
    visited += 1;
    for (const key of Object.keys(node)) {
      if (ESSENTIAL_KEYS.has(key)) continue;
      const value = node[key];
      const childPath = path ? `${path}.${key}` : key;
      if (key === "content" && node.role === "toolResult" && Array.isArray(value)) {
        toolResultContentSite(node, value, childPath);
        continue;
      }
      if (isBase64ImageBlock(value)) {
        const json = JSON.stringify(value) ?? "";
        sites.push({
          path: childPath,
          kind: "image",
          saving: Math.max(0, json.length - 96),
          apply: () => {
            node[key] = imageNote(value);
            return 0;
          },
        });
        continue;
      }
      if (typeof value === "string" && value.length >= PAYLOAD_BULK_MIN_CHARS) {
        stringSite(node, key, childPath);
        continue;
      }
      if (isRecord(value) || Array.isArray(value)) walk(value, childPath);
    }
  }

  walk(root, "");
  // Biggest saving first: the fewest cuts that clear the limit.
  return sites.sort((a, b) => b.saving - a.saving);
}

/**
 * Cut `json` (the serialization of `event`) to the limit. Returns null when the
 * event already fits, so the stream keeps its single stringify on the hot path.
 */
export function capEventPayloadJson(
  event: unknown,
  json: string,
  options: PayloadLimitOptions,
): { json: string; truncated: PayloadTruncation } | null {
  const limitBytes = options.limitBytes;
  if (!limitBytes || json.length <= limitBytes) return null;

  let copy: unknown;
  try {
    copy = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(copy) && !Array.isArray(copy)) return null;

  const truncated: PayloadTruncation = { chars: 0, items: 0, images: 0, fields: [] };
  const sink: { contentUrl?: string } = {};
  let size = json.length;
  for (const site of collectSites(copy, options, sink)) {
    if (size <= limitBytes) break;
    const before = size;
    const dropped = site.apply(size - limitBytes);
    const after = JSON.stringify(copy)?.length ?? size;
    if (after >= before) continue;
    size = after;
    truncated.fields.push(site.path);
    if (site.kind === "string") truncated.chars += dropped;
    if (site.kind === "array") truncated.items += dropped;
    if (site.kind === "image") truncated.images += 1;
  }

  if (size > limitBytes) {
    // Nothing structurally big left: drop whole non-essential subtrees, biggest first.
    for (const site of dropWholeSites(copy)) {
      if (size <= limitBytes) break;
      const before = size;
      site.apply(size - limitBytes);
      const after = JSON.stringify(copy)?.length ?? size;
      if (after >= before) continue;
      size = after;
      truncated.fields.push(site.path);
    }
  }

  if (truncated.fields.length === 0) return null;
  truncated.fields = truncated.fields.slice(0, 8);
  if (sink.contentUrl) truncated.contentUrl = sink.contentUrl;
  const marker = copy as Record<string, unknown>;
  marker.payloadTruncated = truncated;
  let out = JSON.stringify(copy);
  if (out.length > limitBytes && truncated.fields.length > 1) {
    // The marker must not be what keeps the event over the limit.
    truncated.fields = truncated.fields.slice(0, 1);
    marker.payloadTruncated = truncated;
    out = JSON.stringify(copy);
  }
  return { json: out, truncated };
}

function dropWholeSites(root: unknown): CutSite[] {
  const sites: CutSite[] = [];
  function walk(node: unknown, path: string, depth: number): void {
    if (!isRecord(node) && !Array.isArray(node)) return;
    for (const key of Object.keys(node)) {
      if (ESSENTIAL_KEYS.has(key)) continue;
      const value = (node as Record<string, unknown>)[key];
      const json = JSON.stringify(value) ?? "";
      if (json.length < PAYLOAD_KEEP_CHARS) continue;
      sites.push({
        path: path ? `${path}.${key}` : key,
        kind: "drop",
        saving: json.length,
        apply: () => {
          (node as Record<string, unknown>)[key] = `[omitted from this stream: ${json.length} bytes · payload limit]`;
          return 0;
        },
      });
      if (depth < 4) walk(value, path ? `${path}.${key}` : key, depth + 1);
    }
  }
  walk(root, "", 0);
  return sites.sort((a, b) => b.saving - a.saving);
}
