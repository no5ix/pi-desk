import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { createLoadSequence } = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false })
  .import("./session-load-order.ts");

// Opening a session reads it from several places at once (the forced open read, the
// hydration/reconcile paths, the SSE settle handler). The responses can land in the
// reverse order, and the older response describes an older transcript: that is how a
// session opens without its final report, with a page refresh making it correct.

test("the newest claim is the only read allowed to apply", () => {
  const sequence = createLoadSequence();
  const first = sequence.take();
  assert.equal(sequence.isLatest(first), true, "a lone read applies");
  const second = sequence.take();
  assert.equal(sequence.isLatest(first), false, "a read that started earlier may no longer apply");
  assert.equal(sequence.isLatest(second), true);
  assert.equal(sequence.current(), second);
});

test("an out-of-order response is dropped, the fresh one wins", () => {
  const sequence = createLoadSequence();
  const applied = [];
  const read = async (name, ticket, resolvesAfter, payload) => {
    await new Promise((resolve) => setTimeout(resolve, resolvesAfter));
    if (sequence.isLatest(ticket)) applied.push({ name, payload });
  };
  const staleTicket = sequence.take();          // the reconcile read starts first
  const freshTicket = sequence.take();          // the forced open read starts second
  void read("stale", staleTicket, 5, "no final report");
  void read("fresh", freshTicket, 1, "final report");
  // Both were issued; only the newest claim applies, whichever lands first.
  void read("fresh-late", freshTicket, 20, "final report");
  return new Promise((resolve) => setTimeout(() => {
    assert.deepEqual(applied.map((entry) => entry.name), ["fresh", "fresh-late"]);
    assert.deepEqual([...new Set(applied.map((entry) => entry.payload))], ["final report"]);
    resolve();
  }, 40));
});

test("a ticket is taken per request, not per caller that joins one", () => {
  const sequence = createLoadSequence();
  const first = sequence.take();
  // A caller that joins an in-flight read takes no ticket: it applies nothing itself, the
  // flight that owns the request does, under the ticket it claimed.
  assert.equal(sequence.current(), first);
  assert.equal(sequence.isLatest(first), true);
});
