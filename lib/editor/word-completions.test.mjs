// Document-local word completion — the Sublime Text 2 rule, tested without an
// editor. The vocabulary is this buffer's words; the list is frequency-ranked;
// the word being typed is not offered back.
import assert from "node:assert/strict"
import test from "node:test"

const { collectDocumentWords, completeWords, prefixAtCaret } = await import("./word-completions.ts")

await test("the prefix is the word before the caret, never the word after it", () => {
  assert.equal(prefixAtCaret("const authentication"), "authentication")
  assert.equal(prefixAtCaret(""), "")
  assert.equal(prefixAtCaret("const "), "")
  assert.equal(prefixAtCaret("git push --force-"), "force-", "a dash continues an identifier")
  assert.equal(prefixAtCaret("a.b"), "b", "a dot starts a new prefix")
  assert.equal(prefixAtCaret("gitPush-for"), "gitPush-for", "camelCase is one word, not a fragment list")
})

await test("words are collected with their count and first position", () => {
  const index = collectDocumentWords("alpha beta alpha\nalpha")
  const alpha = index.words.find((entry) => entry.word === "alpha")
  assert.equal(alpha.count, 3)
  assert.equal(alpha.first, 0)
  assert.equal(index.words.find((entry) => entry.word === "beta").count, 1)
})

await test("a one-character word is not vocabulary, and an empty document is none either", () => {
  assert.deepEqual(collectDocumentWords("a b c").words, [])
  assert.deepEqual(collectDocumentWords("").words, [])
})

await test("completion is a case-insensitive prefix match, ranked by count, then length, then position", () => {
  const text = [
    "branch", "branch", "branch",
    "branches", "branchName", "Branch",
  ].join("\n")
  const items = completeWords(collectDocumentWords(text), "branc", { limit: 10 })
  const words = items.map((item) => item.word)
  assert.equal(words[0], "branch", "the most frequent word leads")
  const counts = items.map((item) => item.count)
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), "the list is ordered by count")
  for (const word of words) assert.ok(word.toLowerCase().startsWith("branc"), `${word} matches the prefix`)
  const sameCount = items.filter((item) => item.count === 1).map((item) => item.word)
  assert.deepEqual(sameCount, ["Branch", "branches", "branchName"], "equal counts are ordered by length")
})

await test("the word being typed is excluded, so the list is additions and not echoes", () => {
  const index = collectDocumentWords("branching branchine branchy")
  const items = completeWords(index, "branchi", {})
  assert.deepEqual(items.map((item) => item.word), ["branching", "branchine"])
  // Typing the whole word leaves nothing to add.
  assert.deepEqual(completeWords(index, "branching", {}), [])
})

await test("matching ignores case, and an exact-case word is offered back", () => {
  const index = collectDocumentWords("CheckoutBranch checkoutBranchLocal")
  const items = completeWords(index, "checkout", {})
  assert.deepEqual(items.map((item) => item.word), ["CheckoutBranch", "checkoutBranchLocal"])
})

await test("the list is bounded by the limit", () => {
  const text = Array.from({ length: 300 }, (_, index) => `word${index}`).join(" ")
  assert.equal(completeWords(collectDocumentWords(text), "word", { limit: 25 }).length, 25)
  assert.equal(completeWords(collectDocumentWords(text), "word", { limit: 0 }).length, 0)
})

await test("an empty prefix offers nothing, and unicode words are vocabulary", () => {
  assert.deepEqual(completeWords(collectDocumentWords("分支 变更"), "", {}), [])
  const items = completeWords(collectDocumentWords("分支 分支变更"), "分", {})
  assert.deepEqual(items.map((item) => item.word), ["分支", "分支变更"])
})

await test("identifiers with digits, dollars and underscores survive intact", () => {
  const index = collectDocumentWords("MAX_WATCHED_FILES_PER_STREAM $price commit2 tree-ish")
  for (const word of ["MAX_WATCHED_FILES_PER_STREAM", "$price", "commit2", "tree-ish"]) {
    assert.ok(index.words.some((entry) => entry.word === word), `${word} is vocabulary`)
  }
})
