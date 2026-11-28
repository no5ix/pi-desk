/**
 * Document-local word completion — the Sublime Text 2 behaviour, in one place
 * so it can be tested without an editor.
 *
 * The vocabulary is the current document, nothing else: no dictionary, no other
 * file, no language server. A word is a run of word characters; matching is a
 * case-insensitive prefix; the list is ranked by how often the word appears,
 * then by how short it is, then by where it first appears. The word being typed
 * is excluded, so the list is additions, not echoes.
 */

const WORD_PATTERN = /[\p{L}\p{N}_$][\p{L}\p{N}_$-]*/gu;

export interface DocumentWord {
  word: string;
  count: number;
  /** Character offset of the first occurrence, for a stable tie-break. */
  first: number;
}

export interface WordIndex {
  words: DocumentWord[];
  byLower: Map<string, DocumentWord[]>;
}

export function collectDocumentWords(text: string, minLength = 2): WordIndex {
  const seen = new Map<string, DocumentWord>();
  const byLower = new Map<string, DocumentWord[]>();
  if (!text) return { words: [], byLower };
  let lastIndex = -1;
  for (const match of text.matchAll(WORD_PATTERN)) {
    const word = match[0];
    const index = match.index ?? 0;
    // The regex is stateful across matchAll; a repeated hit at the same offset
    // means the last match did not advance, so stop rather than loop.
    if (index === lastIndex) continue;
    lastIndex = index;
    if (word.length < minLength) continue;
    const lower = word.toLowerCase();
    const existing = seen.get(word);
    if (existing) {
      existing.count++;
      continue;
    }
    const entry: DocumentWord = { word, count: 1, first: index };
    seen.set(word, entry);
    const bucket = byLower.get(lower);
    if (bucket) bucket.push(entry);
    else byLower.set(lower, [entry]);
  }
  return { words: [...seen.values()], byLower };
}

/**
 * Completions for `prefix` inside `text`.
 *
 * `caseSensitive` is off by default: typing `comp` offers `Component` and
 * `compute`. A prefix that already matches a word exactly (same casing) drops
 * that word — the user finished it — while the other cases of the same word
 * stay, which is what makes `foo` offer `Foo` in a code base.
 */
export function completeWords(
  index: WordIndex,
  prefix: string,
  options: { limit?: number; excludeWord?: string } = {},
): DocumentWord[] {
  const limit = options.limit ?? 50;
  if (!prefix) return [];
  const exclude = (options.excludeWord ?? prefix).toLowerCase();
  const lowerPrefix = prefix.toLowerCase();
  const matches: DocumentWord[] = [];
  for (const [lower, entries] of index.byLower) {
    if (!lower.startsWith(lowerPrefix)) continue;
    for (const entry of entries) {
      if (entry.word.toLowerCase() === exclude && entry.word === (options.excludeWord ?? prefix)) continue;
      matches.push(entry);
    }
  }
  matches.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    if (a.word.length !== b.word.length) return a.word.length - b.word.length;
    return a.first - b.first;
  });
  return matches.slice(0, limit);
}

/** The prefix at the caret: the word characters immediately before it. Monaco
 *  hands the model over, so the extraction lives here where it is testable. */
export function prefixAtCaret(textBeforeCaret: string): string {
  const match = /[\p{L}\p{N}_$][\p{L}\p{N}_$-]*$/u.exec(textBeforeCaret);
  return match ? match[0] : "";
}
