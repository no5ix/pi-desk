import assert from "node:assert/strict";
import test from "node:test";

// The script both fallback pages load. It is a plain browser script, so importing it only
// installs globalThis.piWebOfflineRecovery: the auto-start at the bottom is guarded by the
// presence of a document, which a Node test does not have.
await import("./offline-recovery.js");

const { start, MAX_RELOADS } = globalThis.piWebOfflineRecovery;

function harness({ answers = [], storage = null, now = 1_000 } = {}) {
  const state = { value: storage, now };
  const status = [];
  const reloads = [];
  let answered = 0;
  const env = {
    fetchPage: async () => {
      const answer = answers[answered] ?? answers.at(-1);
      answered += 1;
      if (answer === "refused") throw new TypeError("connection refused");
      return { ok: true };
    },
    reload: () => reloads.push(env.now()),
    now: () => state.now,
    read: () => (state.value === null ? null : JSON.parse(JSON.stringify(state.value))),
    write: (value) => { state.value = value; },
    setStatus: (text) => status.push(text),
    every: (_intervalMs, tick) => { env.tick = tick; },
  };
  const controls = start(env);
  return { env, controls, status, reloads, state, ticks: () => env.tick() };
}

test("the page reloads itself as soon as the server answers", async () => {
  const h = harness({ answers: ["ok"] });
  await h.ticks();

  assert.equal(h.reloads.length, 1, "one answered poll, one reload");
  assert.match(h.status.at(-1), /The server is answering/);
  assert.deepEqual(h.state.value.reloads.length, 1);
});

test("a refused poll earns no reload, and the next answer gets one", async () => {
  const h = harness({ answers: ["refused", "ok"] });
  await h.ticks();
  assert.equal(h.reloads.length, 0);
  assert.match(h.status.at(-1), /Reconnecting, 0s/);

  await h.ticks();
  assert.equal(h.reloads.length, 1);
});

test("a server that answers the poll but cannot serve the document backs off", async () => {
  // The reload happened, the page came back, the first poll answered, and the navigation
  // lost the connection race again. The next page load inherits required = 2, then 4.
  const h = harness({ answers: ["ok"] });
  await h.ticks();
  assert.equal(h.reloads.length, 1);
  assert.equal(h.state.value.required, 2);

  const second = harness({ answers: ["ok"], storage: h.state.value });
  await second.ticks();
  assert.equal(second.reloads.length, 0, "one answer is not enough any more");
  await second.ticks();
  assert.equal(second.reloads.length, 1);
  assert.equal(second.state.value.required, 4);
});

test("the reload budget is per ten minutes, then the page leaves the button to the user", async () => {
  const reloads = Array.from({ length: MAX_RELOADS }, (_, i) => 1_000 + i * 60_000);
  const h = harness({ answers: ["ok"], storage: { required: 1, reloads }, now: 1_000 + 60_000 * MAX_RELOADS });
  await h.ticks();

  assert.equal(h.reloads.length, 0);
  assert.match(h.status.at(-1), new RegExp(`after ${MAX_RELOADS} tries`));

  // Out of the window, the page tries again: a laptop that woke from sleep gets its page.
  const later = harness({
    answers: ["ok"],
    storage: { required: 1, reloads },
    now: 1_000 + 60_000 * MAX_RELOADS + 11 * 60_000,
  });
  await later.ticks();
  assert.equal(later.reloads.length, 1);
});

test("a broken storage does not stop the recovery", async () => {
  const throwing = harness({ answers: ["ok"] });
  throwing.env.read = () => { throw new Error("SecurityError: storage is blocked"); };
  throwing.env.write = () => { throw new Error("QuotaExceededError"); };

  await throwing.ticks();
  assert.equal(throwing.reloads.length, 1);
});

test("a page load that is stopped does not reload", async () => {
  const h = harness({ answers: ["ok"] });
  h.controls.stop();
  await h.ticks();
  assert.equal(h.reloads.length, 0);
});

test("the page polls its own URL uncached, shows the wait, and reloads on the first answer", async () => {
  // The real browser wiring, driven with a fake window: what a fallback page does.
  const requested = [];
  let tick = null;
  let intervalMs = 0;
  const status = { textContent: "" };
  let reloaded = 0;
  globalThis.document = { querySelector: (selector) => (selector === "[data-offline-status]" ? status : null) };
  globalThis.window = {
    location: { href: "http://127.0.0.1:30141/?session=one", reload: () => { reloaded += 1; } },
    setInterval: (fn, ms) => { tick = fn; intervalMs = ms; return 0; },
  };
  globalThis.localStorage = { getItem: () => null, setItem: () => undefined };
  globalThis.fetch = async (url, init) => {
    requested.push({ url, init });
    return { ok: true };
  };
  try {
    globalThis.piWebOfflineRecovery.start(globalThis.piWebOfflineRecovery.browserEnv());

    assert.deepEqual(requested, [], "the page does not fetch before the first poll");
    assert.equal(typeof tick, "function", "the page schedules a poll");
    assert.equal(intervalMs, 2_000);

    await tick();
    assert.equal(requested[0].url, "http://127.0.0.1:30141/?session=one", "the page's own URL");
    assert.equal(requested[0].init.cache, "no-store", "a cached answer would reload forever");
    assert.equal(requested[0].init.credentials, "same-origin");
    assert.ok(requested[0].init.signal instanceof AbortSignal, "a silent server must not stall the poll");
    assert.match(status.textContent, /The server is answering/);
    assert.equal(reloaded, 1);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});
