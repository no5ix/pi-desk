import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/**
 * The title a session is shown by when nobody has named it: its first prompt, on one line,
 * capped — the sidebar's own rule for a row with no name.
 *
 * A finished task's notification is titled with the session's name, and the announcer's live
 * session only carries a name once one exists: `sessionManager.getSessionName()` is null for
 * a session nobody renamed and auto-naming (`lib/session-title.ts`) has not named. Titling
 * such a notification "Session complete" is the format the user refused — it cannot say which
 * task ended — and going silent is worse: with "name sessions automatically" switched off, no
 * run would ever announce itself. The first prompt is exactly what the sidebar row says, so
 * the phone, the topic and Notification Center read the name the user already sees.
 *
 * Auto-naming asks a model for a summary; this asks nothing and costs no tokens. Two readers
 * carry the rule: `promptTitleFromEntries()` reads a live session's own entries — the session
 * that finished a run has its transcript in hand — and `readPromptTitle()` reads a session
 * file for a run whose session is not live in this process.
 */

/** The cap on a generated session name (`lib/session-title.ts`), so both paths match. */
export const MAX_PROMPT_TITLE_CHARS = 80;

/**
 * The most bytes read from a session file looking for its first prompt.
 *
 * The first prompt sits at the top of the file, behind the header entries and pi's system
 * prompt — and behind its attachments. A prompt that starts with a screenshot is one JSON
 * line carrying a few hundred KB of base64, and this reader used to read a 256 KB window of
 * the file: that window cut such a line in half, a half line is not JSON, and a session that
 * began with an image had no title at all — so its finished run announced nothing on any
 * channel. The budget is a read cap, not a window: the search walks lines from the start and
 * stops at the first prompt, which for a real session is reached in the first megabytes.
 */
const HEAD_READ_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * Above this size, a line is only parsed when its shape says it is a message. Tool results
 * carry base64 images too, and parsing a 10 MB line to learn it is not a prompt spends the
 * end of a run on nothing.
 */
const LARGE_LINE_PROBE_BYTES = 256 * 1024;

/**
 * A line this big is never parsed. An attachment-heavy prompt is parsed by shape (it is the
 * title), but a line of tens of MB is not a prompt this path can name, and parsing one at the
 * end of a run spends the chat's memory on it. The read stops after the budget anyway.
 */
const MAX_PARSED_LINE_BYTES = 32 * 1024 * 1024;

/** The text of a message's content: a plain string, or its first text block. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    if (
      block
      && typeof block === "object"
      && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string"
    ) {
      return (block as { text: string }).text;
    }
  }
  return "";
}

/** The prompt text on one line, capped like an auto-generated name so both read the same. */
function promptTitleText(content: unknown): string {
  return contentText(content).replace(/\s+/g, " ").trim();
}

/** The sidebar's cap on a row title (`lib/session-title.ts`), shared by every caller. */
function capTitle(text: string): string {
  return text.length > MAX_PROMPT_TITLE_CHARS
    ? `${text.slice(0, MAX_PROMPT_TITLE_CHARS - 1)}…`
    : text;
}

/**
 * The first user prompt in a session file's lines, as a one-line title.
 *
 * Malformed lines are skipped (a partially written tail is normal), an attachment-only prompt
 * has no words and is passed over, and a session with no prompt in the lines answers null —
 * the caller then has no title and announces nothing, which is the honest outcome.
 */
export function parsePromptTitle(lines: Iterable<string>): string | null {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: unknown }).type !== "message") continue;
    const message = (entry as { message?: unknown }).message;
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: unknown }).role !== "user") continue;
    const text = promptTitleText((message as { content?: unknown }).content);
    if (!text) continue;
    return capTitle(text);
  }
  return null;
}

/**
 * The same title from a live session's own in-memory entries.
 *
 * The session that finished a run holds its transcript, so announcing a run of a session
 * nobody has named asks no file, no session-path scan and no read window: the row's title is
 * read out of what the session already has. Entries are taken as they come (the SDK's
 * `getEntries()` shape) and only a `message` entry with a user role and words in it counts.
 */
export function promptTitleFromEntries(entries: readonly unknown[]): string | null {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if ((entry as { type?: unknown }).type !== "message") continue;
    const message = (entry as { message?: unknown }).message;
    if (!message || typeof message !== "object") continue;
    if ((message as { role?: unknown }).role !== "user") continue;
    const text = promptTitleText((message as { content?: unknown }).content);
    if (!text) continue;
    return capTitle(text);
  }
  return null;
}

/**
 * A line too big to parse on spec, tested by its shape first: pi writes each entry as one
 * compact JSON line whose keys come in this order, so a user prompt starts with
 * `{"type":"message"` and carries `"role":"user"` ahead of its attachments. A line that fails
 * this is not a prompt; one that passes is parsed for real.
 */
function mayBeUserPromptLine(line: string): boolean {
  return line.startsWith('{"type":"message"') && line.includes('"role":"user"');
}

/**
 * The same title, read from the file from the start, line by line, up to `HEAD_READ_BUDGET_BYTES`.
 *
 * Never throws: a file that is missing, huge, or unreadable answers null, and the caller
 * decides what a missing name means. The stream is closed as soon as the title is found, so a
 * 100 MB session file is never read whole for a line near its top.
 */
export async function readPromptTitle(filePath: string): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let bytesRead = 0;
  try {
    for await (const line of rl) {
      const lineBytes = Buffer.byteLength(line, "utf8");
      bytesRead += lineBytes + 1;
      if (lineBytes > MAX_PARSED_LINE_BYTES) continue;
      if (lineBytes > LARGE_LINE_PROBE_BYTES && !mayBeUserPromptLine(line)) continue;
      const title = parsePromptTitle([line]);
      if (title) return title;
      if (bytesRead >= HEAD_READ_BUDGET_BYTES) return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    rl.close();
    stream.destroy();
  }
}
