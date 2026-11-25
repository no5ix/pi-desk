import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The composer's per-device copy, at the edges that used to bite.
 *
 * The mirror this replaces wrote every device into one record and read it back
 * on a poll, so a copy arriving from the server repainted the composer the user
 * was typing in, and the empty snapshot a send left behind wiped a prompt. The
 * client here must therefore never treat a fetched copy as something to apply:
 * it writes one record (this device's), reads the others as a list, and hands
 * the list to the rows above the composer.
 *
 * What is pinned: a write carries this device's id, label and token; the token a
 * write handed back is used for the next write and the delete; an empty composer
 * is a DELETE and nothing is written in its place; a refusal (403/413) stops
 * this device's pushes while the rows keep reading; a poll is silent in a hidden
 * tab.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const copies = await jiti.import("@/lib/composer-copies.ts");
const { POLL_INTERVAL_MS, pushDeviceCopy, clearDeviceCopy, watchDeviceCopies, resetComposerCopies } = copies;

/** The page, as far as the poll cares: one visibility state and its listeners. */
const page = { visibilityState: "visible", handlers: new Set() };
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    get visibilityState() { return page.visibilityState; },
    addEventListener: (_event, handler) => page.handlers.add(handler),
    removeEventListener: (_event, handler) => page.handlers.delete(handler),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 900));

function recorder(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : null;
    const headers = init?.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
    calls.push({ method, url: String(url), body, headers });
    return handler ? handler(method, String(url), init, body) : new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return calls;
}

const draft = (value, extra = {}) => ({ value, images: [], files: [], ...extra });

test("a write names this device, and a token the store hands back is used from then on", async () => {
  resetComposerCopies();
  const key = `session-token-${Date.now()}`;
  const calls = recorder((method) => (method === "PUT"
    ? new Response(JSON.stringify({ ok: true, token: "tok-1" }), { status: 200, headers: { "content-type": "application/json" } })
    : new Response(JSON.stringify({ copies: [] }), { status: 200, headers: { "content-type": "application/json" } })));

  pushDeviceCopy(key, draft("typed on this device"));
  await pastDebounce();
  await settle();
  const first = calls.find((call) => call.method === "PUT");
  assert.ok(first, "the composer's content is written once per pause");
  assert.match(first.body.deviceId, /^device-[A-Za-z0-9_-]{4,}$/, "the record is this device's own");
  assert.ok(first.body.label, "the copy carries the slug its name is built from");
  assert.ok(["desktop", "phone", "tablet", "other"].includes(first.body.kind));
  assert.equal(first.body.token, null, "a first write has no token yet");

  pushDeviceCopy(key, draft("typed on this device, more"));
  await pastDebounce();
  await settle();
  const second = calls.filter((call) => call.method === "PUT")[1];
  assert.equal(second.body.token, "tok-1", "the store's token comes back on every later write");

  clearDeviceCopy(key);
  await settle();
  const del = calls.find((call) => call.method === "DELETE");
  assert.equal(del.headers["x-composer-copy-token"], "tok-1", "the delete proves it is this device's copy");
  assert.ok(del.url.includes(`deviceId=${first.body.deviceId}`));
});

test("an empty composer is a DELETE, and no empty snapshot is written in its place", async () => {
  resetComposerCopies();
  const key = `session-blank-${Date.now()}`;
  const calls = recorder();
  pushDeviceCopy(key, draft("the prompt being typed"));
  await pastDebounce();
  await settle();
  // Sending clears the composer: the copy goes with it, and an empty copy never
  // takes its place for another device's row to pick up.
  clearDeviceCopy(key);
  pushDeviceCopy(key, draft(""));
  await pastDebounce();
  await settle();
  assert.ok(calls.some((call) => call.method === "PUT"), "the text was written");
  assert.ok(calls.some((call) => call.method === "DELETE"), "the cleared composer deleted the copy");
  const afterClear = calls.slice(calls.findIndex((call) => call.method === "DELETE")).filter((call) => call.method === "PUT");
  assert.deepEqual(afterClear, [], `nothing empty is written after the clear: ${JSON.stringify(afterClear.map((c) => c.body))}`);
});

test("a push that fails keeps this device's content queued for the next edit", async () => {
  resetComposerCopies();
  const key = `session-retry-${Date.now()}`;
  let puts = 0;
  const calls = recorder((method) => {
    if (method !== "PUT") return new Response(JSON.stringify({ copies: [] }), { status: 200, headers: { "content-type": "application/json" } });
    puts += 1;
    return new Response(JSON.stringify({ error: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
  });
  pushDeviceCopy(key, draft("half a sentence"));
  await pastDebounce();
  await settle();
  pushDeviceCopy(key, draft("half a sentence, finished"));
  await pastDebounce();
  await settle();
  assert.equal(puts, 2);
  const last = calls.filter((call) => call.method === "PUT").at(-1);
  assert.equal(last.body.value, "half a sentence, finished", "the newest content is what goes out next");
});

test("a refusal stops this device's pushes while the rows keep reading", async () => {
  resetComposerCopies();
  const key = `session-refused-${Date.now()}`;
  let puts = 0;
  const calls = recorder((method) => (method === "PUT"
    ? (puts += 1, new Response(JSON.stringify({ error: "This copy belongs to another device." }), { status: 403, headers: { "content-type": "application/json" } }))
    : new Response(JSON.stringify({ copies: [] }), { status: 200, headers: { "content-type": "application/json" } })));
  pushDeviceCopy(key, draft("with an attachment past the cap"));
  await pastDebounce();
  await settle();
  for (let index = 0; index < 3; index += 1) {
    pushDeviceCopy(key, draft("with an attachment past the cap, typed on"));
    await pastDebounce();
  }
  await settle();
  assert.equal(puts, 1, "a snapshot the store will not take is not re-PUT on every keystroke");
  const seen = [];
  const stop = watchDeviceCopies(key, (list) => seen.push(list));
  await settle();
  stop();
  assert.equal(calls.filter((call) => call.method === "GET").length, 1,
    "a device the store will not write still reads the other devices' copies");
});

test("the rows get the other devices' copies, ordered mac first", async () => {
  resetComposerCopies();
  const key = `session-list-${Date.now()}`;
  const t = Date.now();
  recorder((method, url) => {
    assert.match(url, /deviceId=device-/, "the read names this device, so its own copy is excluded");
    return new Response(JSON.stringify({
      copies: [
        { deviceId: "iphone-bbbbbb", label: "iphone", kind: "phone", value: "on the phone", images: [], files: [], updatedAt: t, droppedImages: 0, droppedFiles: 0 },
        { deviceId: "mac-aaaaaa", label: "mac", kind: "desktop", value: "on the mac", images: [], files: [], updatedAt: t - 1000, droppedImages: 0, droppedFiles: 0 },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const lists = [];
  const stop = watchDeviceCopies(key, (list) => lists.push(list));
  await settle();
  stop();
  assert.equal(lists.length, 1, "one registration reads once");
  assert.deepEqual(lists[0].map((copy) => copy.label), ["mac", "iphone"], "the laptop's copy leads, the phone's follows");
});

test("a hidden tab does not poll, and coming back visible reads at once", async () => {
  resetComposerCopies();
  const key = `session-hidden-${Date.now()}`;
  const calls = recorder(() => new Response(JSON.stringify({ copies: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  page.visibilityState = "hidden";
  const stop = watchDeviceCopies(key, () => {});
  const readsWhileHidden = calls.filter((call) => call.method === "GET").length;
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS + 200));
  assert.equal(calls.filter((call) => call.method === "GET").length, readsWhileHidden, "a hidden tab has nobody reading the rows");

  page.visibilityState = "visible";
  for (const handler of page.handlers) handler();
  await settle();
  assert.ok(calls.filter((call) => call.method === "GET").length > readsWhileHidden, "the tab that comes back reads the rows immediately");
  stop();
  page.visibilityState = "visible";
});
