import { open, stat } from "node:fs/promises";

/**
 * When a session's last run started and ended, read from its own file.
 *
 * The completion notification says "The task lasted 0h18m13s, started at 10:04:34,
 * and ended at 10:22:47." A page knows those times only for a run it saw begin:
 * a task started from a phone over the relay, a queued prompt, a page that was
 * reloaded mid-run, an extension-triggered run — the page has no start stamp, and
 * without it the notification used to be dropped entirely. The session file has
 * the answer: every entry carries a timestamp, and the run is the last user
 * message through the last entry written after it.
 *
 * Only the tail is read (`TAIL_WINDOW_BYTES`, widened once), because a session
 * file of a long day is megabytes and the run lives at its end.
 */

/** A run's span in ms, from the user's prompt to the last entry the run wrote. */
export interface LastRunTimes {
  startedAt: number;
  endedAt: number;
}

const TAIL_WINDOW_BYTES = 256 * 1024;
const TAIL_WINDOW_MAX_BYTES = 2 * 1024 * 1024;

interface SessionEntryLike {
  type?: unknown;
  timestamp?: unknown;
  message?: { role?: unknown; timestamp?: unknown };
}

function entryTimeMs(entry: SessionEntryLike): number | null {
  const entryValue = entry.timestamp;
  if (typeof entryValue === "string") {
    const parsed = Date.parse(entryValue);
    if (Number.isFinite(parsed)) return parsed;
  }
  const messageValue = entry.message?.timestamp;
  if (typeof messageValue === "number" && Number.isFinite(messageValue)) return messageValue;
  return null;
}

/**
 * The last run in the entries of a session file's tail.
 *
 * A run needs a user message and something written after it; a session that has
 * only prompts (or only a header) answers null, which the caller reads as "there
 * is no finished task to announce". Entries are taken in file order, which is the
 * order they were written.
 */
export function parseLastRunFromJsonl(text: string): LastRunTimes | null {
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: SessionEntryLike;
    try {
      entry = JSON.parse(trimmed) as SessionEntryLike;
    } catch {
      // A tail cut mid-line, or an entry the writer left half-done: not this run.
      continue;
    }
    const at = entryTimeMs(entry);
    if (at === null) continue;
    const isUserPrompt = entry.type === "message" && entry.message?.role === "user";
    if (isUserPrompt) {
      // A new prompt opens a new run: the span starts over from it.
      startedAt = at;
      endedAt = null;
      continue;
    }
    if (startedAt !== null) endedAt = at;
  }
  return startedAt !== null && endedAt !== null && endedAt >= startedAt
    ? { startedAt, endedAt }
    : null;
}

/** Read a file's last `bytes` bytes as text (no seek past the end). */
async function readTail(filePath: string, bytes: number): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    const size = Math.min(bytes, info.size);
    const position = info.size - size;
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, position);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

/**
 * The last run of one session file, or null when it has none (missing file,
 * unreadable, no run in the tail).
 *
 * A tail with no user prompt widens once to `TAIL_WINDOW_MAX_BYTES`, which covers
 * a run of long tool output; a run wider than that is read as no run, since a
 * notification with no span is better than one that reads "0h0m0s".
 */
export async function readLastRunTimes(filePath: string): Promise<LastRunTimes | null> {
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  try {
    const narrow = parseLastRunFromJsonl(await readTail(filePath, TAIL_WINDOW_BYTES));
    if (narrow) return narrow;
    if (info.size <= TAIL_WINDOW_BYTES) return null;
    return parseLastRunFromJsonl(await readTail(filePath, TAIL_WINDOW_MAX_BYTES));
  } catch {
    return null;
  }
}
