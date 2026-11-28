/**
 * Structured representation of `git blame --line-porcelain` output.
 *
 * The porcelain format emits one block per annotated line:
 *
 *   <commit-hash> <orig-line-number> <final-line-number> [<num-lines>]
 *   author <name>
 *   author-mail <email>
 *   author-time <unix-seconds>
 *   author-tz <tz>
 *   committer <name>
 *   committer-mail <email>
 *   committer-time <unix-seconds>
 *   committer-tz <tz>
 *   summary <subject>
 *   [previous <commit-hash> <source-filename>]
 *   [boundary]
 *   [filename <file>]
 *   \t<content>
 *
 * Consecutive blocks with the same commit and contiguous final line numbers
 * are merged into a hunk, so the blame UI renders one block per change instead
 * of one row per line.
 */

export interface BlameLine {
  /** 1-based line number in the file. */
  lineNumber: number;
  /** Raw line content (without the leading TAB the porcelain format adds). */
  content: string;
}

export interface BlameEntry {
  commitHash: string;
  author: string;
  authorEmail: string;
  /** Unix seconds since the epoch. */
  authorTime: number;
  summary: string;
  /** True when the line sits on a commit boundary (root commit, etc.). */
  boundary: boolean;
}

export interface BlameHunk extends BlameEntry {
  lines: BlameLine[];
}

export interface BlameResult {
  /** Repo-relative file path the blame was taken over. */
  file: string;
  hunks: BlameHunk[];
  /** Total number of lines in the file. */
  lineCount: number;
}

const HEADER_RE = /^([0-9a-f]{40,64})\s+(\d+)\s+(\d+)(?:\s+(\d+))?\s*$/;

function parseEntries(
  output: string,
): Array<BlameEntry & { lineNumber: number; content: string }> {
  const lines = output.split("\n");
  const entries: Array<BlameEntry & { lineNumber: number; content: string }> =
    [];
  let i = 0;

  while (i < lines.length) {
    const header = lines[i].match(HEADER_RE);
    if (!header) {
      i++;
      continue;
    }
    const commitHash = header[1];
    // 1-based final line number — the second number in the header.
    const finalLine = Number.parseInt(header[3], 10);

    const entry: BlameEntry & { lineNumber: number; content: string } = {
      commitHash,
      lineNumber: finalLine,
      author: "",
      authorEmail: "",
      authorTime: 0,
      summary: "",
      boundary: false,
      content: "",
    };
    let content: string | null = null;

    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("\t")) {
        content = line.slice(1);
        i++;
        break;
      }
      if (line === "boundary") {
        entry.boundary = true;
      } else if (line.startsWith("author ")) {
        entry.author = line.slice("author ".length);
      } else if (line.startsWith("author-mail ")) {
        entry.authorEmail = line
          .slice("author-mail ".length)
          .replace(/^<|>$/g, "");
      } else if (line.startsWith("author-time ")) {
        const t = Number.parseInt(line.slice("author-time ".length).trim(), 10);
        if (Number.isFinite(t)) entry.authorTime = t;
      } else if (line.startsWith("summary ")) {
        entry.summary = line.slice("summary ".length);
      }
      // Everything else (committer*, author-tz, previous, filename, blanks)
      // is ignored: the parser is deliberately tolerant of extra keys.
      i++;
    }

    if (content === null) {
      // Header without a content line: malformed block, skip it.
      continue;
    }
    entry.content = content;
    entries.push(entry);
  }

  return entries;
}

export function parseGitBlame(output: string, file: string): BlameResult {
  const parsed = parseEntries(output);
  const hunks: BlameHunk[] = [];

  for (const entry of parsed) {
    const prev = hunks[hunks.length - 1];
    const lastLine = prev?.lines[prev.lines.length - 1];
    if (
      prev &&
      prev.commitHash === entry.commitHash &&
      lastLine &&
      lastLine.lineNumber + 1 === entry.lineNumber
    ) {
      prev.lines.push({ lineNumber: entry.lineNumber, content: entry.content });
      continue;
    }
    hunks.push({
      commitHash: entry.commitHash,
      author: entry.author,
      authorEmail: entry.authorEmail,
      authorTime: entry.authorTime,
      summary: entry.summary,
      boundary: entry.boundary,
      lines: [{ lineNumber: entry.lineNumber, content: entry.content }],
    });
  }

  return {
    file,
    hunks,
    lineCount: parsed.length,
  };
}
