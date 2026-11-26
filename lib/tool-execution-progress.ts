import { stripAnsi } from "@/lib/ansi";
import { isRecord } from "./is-record";

const MAX_PROGRESS_LENGTH = 500;

/**
 * The latest line of a running tool's streamed output, as the status line shows it.
 *
 * The status line ("Running bash… 43 files") is a plain string, so a command's
 * colour escapes (eslint, tsc, jest) would arrive as escape-code boxes, and a
 * run that only paints colours ("Running bash… [0m[33m[1m") reports nothing.
 * The line is therefore read by what it shows: escapes go first, and `\r` is a
 * line break too, so a bar that redraws one line ("10%\r50%") says its latest
 * frame and an escape-only line loses to the text above it.
 */
export function getToolExecutionProgress(partialResult: unknown): string | null {
  if (!isRecord(partialResult)) return null;

  const content = partialResult.content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");

  let latest = "";
  for (const line of text.split(/\r\n|\r|\n/)) {
    const visible = stripAnsi(line).replace(/\s+/g, " ").trim();
    if (visible) latest = visible;
  }
  if (!latest) return null;

  return latest.length <= MAX_PROGRESS_LENGTH
    ? latest
    : `...${latest.slice(-(MAX_PROGRESS_LENGTH - 3))}`;
}
