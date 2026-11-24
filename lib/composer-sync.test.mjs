import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The composer's cross-device mirror, at its two dangerous edges.
 *
 * The mirror paints a composer from a copy written elsewhere, so a copy that is
 * incomplete is a composer that loses the user's own work. Both cases happened:
 * a pasted screenshot is routinely larger than the store's image cap, so the
 * push stored the prompt *without* the screenshots, and the composer's own poll
 * painted that copy back — the attachments vanished in front of the user, at the
 * end of a run, with no reload and no send of the draft. The empty snapshot a
 * send leaves behind was the second one: it re-PUT itself after the DELETE and
 * wiped a prompt that was being typed.
 *
 * So: an empty snapshot is a DELETE, never a write; and a draft the mirror
 * cannot carry stops being mirrored, so the composer keeps what the user has.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const sync = await jiti.import("@/lib/composer-sync.ts");

// The poll asks the page whether the tab is visible, and listens for it.
if (typeof globalThis.document === "undefined") {
  globalThis.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function recorder(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(method);
    return handler ? handler(method, url, init) : new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

test("an empty composer is a DELETE, and no empty snapshot is written in its place", async () => {
  const calls = recorder();
  const key = `session-blank-${Date.now()}`;
  sync.pushComposerDraft(key, { value: "the prompt being typed", images: [], files: [] });
  // The debounce is 700ms: let the text's write go out first.
  await new Promise((resolve) => setTimeout(resolve, 900));
  await settle();
  // Sending clears the composer: the mirror's copy goes with it.
  sync.clearComposerDraft(key);
  sync.pushComposerDraft(key, { value: "", images: [], files: [] });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await settle();
  assert.ok(calls.includes("PUT"), "the text was mirrored");
  assert.ok(calls.includes("DELETE"), "the cleared composer deleted the server's copy");
  const putsAfterClear = calls.slice(calls.indexOf("DELETE")).filter((m) => m === "PUT");
  assert.deepEqual(putsAfterClear, [], "nothing empty is written after the clear");
});

test("a mirror push of an empty composer is the clear, on its own", async () => {
  const key = `session-blank-push-${Date.now()}`;
  const calls = recorder();
  // The composer's mirror effect writes on every change, so the state after a send —
  // no text, no attachments — arrives here as a push, not as a clear.
  sync.pushComposerDraft(key, { value: "", images: [], files: [] });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await settle();
  assert.deepEqual(calls, ["DELETE"], `an empty snapshot is never PUT: ${calls.join(",")}`);
});

test("a draft the mirror cannot carry stays local, and its composer stops polling", async () => {
  const key = `session-huge-${Date.now()}`;
  let puts = 0;
  const calls = recorder((method) => {
    if (method === "PUT") {
      puts += 1;
      // The store refuses a snapshot whose attachments are larger than it may keep.
      return new Response(JSON.stringify({ error: "Attachments are too large to sync.", draft: null }), {
        status: 413,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, draft: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const applied = [];
  const stop = sync.watchComposerDraft(key, (snapshot) => applied.push(snapshot));
  sync.pushComposerDraft(key, { value: "with a screenshot", images: [{ mimeType: "image/png", data: "AAAB".repeat(120_000) }], files: [] });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await settle();
  assert.equal(puts, 1, "the composer tried to mirror once");
  stop();
  // Every later keystroke: the composer's content is too large for the mirror, and
  // re-PUTting it is traffic that answers the same way.
  const getsBefore = calls.filter((m) => m === "GET").length;
  const watched = sync.watchComposerDraft(key, (snapshot) => applied.push(snapshot));
  sync.pushComposerDraft(key, { value: "with a screenshot and more typing", images: [{ mimeType: "image/png", data: "AAAB".repeat(120_000) }], files: [] });
  await new Promise((resolve) => setTimeout(resolve, 900));
  await settle();
  watched();
  assert.equal(puts, 1, `the composer is not mirrored any more (PUTs: ${puts})`);
  assert.deepEqual(applied, [], "and no remote copy is painted over it");
  assert.equal(calls.filter((m) => m === "GET").length, getsBefore,
    "no polling for a composer that stays local");
});

test("a mirrored composer pushes its text, and the copy it reads back is its own echo", async () => {
  const key = `session-echo-${Date.now()}`;
  const stampOf = [];
  const calls = recorder((method, url, init) => {
    if (method === "PUT") {
      const body = JSON.parse(init.body);
      stampOf.push(body.updatedAt);
      return new Response(JSON.stringify({ ok: true, draft: body }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ draft: { value: "from the other device", images: [], files: [], updatedAt: stampOf[0] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const stamp = sync.pushComposerDraft(key, { value: "typed here", images: [], files: [] });
  assert.ok(stamp > 0, "the write's own stamp comes back for the echo check");
  await new Promise((resolve) => setTimeout(resolve, 900));
  await settle();
  assert.ok(calls.includes("PUT"));
});
