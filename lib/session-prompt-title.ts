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
 * Auto-naming asks a model for a summary; this reads the file and asks nothing. It is the
 * fallback that costs no tokens and works the moment the first prompt is on disk.
 */

/** The cap on a generated session name (`lib/session-title.ts`), so both paths match. */
export const MAX_PROMPT_TITLE_CHARS = 80;

/** The first prompt is at the top of the file, so a bounded head read is enough. */
const HEAD_WINDOW_BYTES = 256 * 1024;

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
    const text = contentText((message as { content?: unknown }).content)
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    return text.length > MAX_PROMPT_TITLE_CHARS
      ? `${text.slice(0, MAX_PROMPT_TITLE_CHARS - 1)}…`
      : text;
  }
  return null;
}

/**
 * The same title, read from the file's head. Never throws: a file that is missing, huge, or
 * unreadable answers null, and the caller decides what a missing name means.
 */
export async function readPromptTitle(filePath: string): Promise<string | null> {
  const stream = createReadStream(filePath, { encoding: "utf8", start: 0, end: HEAD_WINDOW_BYTES - 1 });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const title = parsePromptTitle([line]);
      if (title) return title;
    }
    return null;
  } catch {
    return null;
  } finally {
    rl.close();
    stream.destroy();
  }
}
