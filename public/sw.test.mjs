import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { mock } from "node:test";
import { pathToFileURL } from "node:url";

const listeners = new Map();
globalThis.self = {
  location: {
    href: "https://pi.test/sw.js?v=test",
    origin: "https://pi.test",
  },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: null,
};

await import("./sw.js");

function dispatchNotificationClick(data) {
  let pending;
  let closed = false;
  listeners.get("notificationclick")({
    notification: {
      data,
      close: () => { closed = true; },
    },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, wasClosed: () => closed };
}

function dispatchPush(payload, clients, getNotifications = async () => []) {
  let pending;
  const shown = [];
  self.clients = {
    matchAll: async () => clients,
    openWindow: async () => assert.fail("push must not open windows"),
  };
  self.registration = {
    showNotification: async (title, options) => { shown.push({ title, options }); },
    getNotifications,
  };
  listeners.get("push")({
    data: { json: () => payload },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, shown };
}

test("push always shows a notification, even when a window is visible", async () => {
  const event = dispatchPush(
    {
      title: "Session complete",
      body: "Task finished.",
      url: "/?session=session-1",
      tag: "pi-session-complete:session-1",
    },
    [
      { url: "https://pi.test/?session=other", visibilityState: "hidden" },
      { url: "https://pi.test/?session=session-1", visibilityState: "visible" },
    ],
  );
  await event.pending;

  // iOS revokes the push subscription when a push is handled without a
  // notification, so the notification must never be suppressed.
  assert.equal(event.shown.length, 1);
  const shownAt = event.shown[0].options.data.shownAt;
  assert.equal(typeof shownAt, "number");
  assert.deepEqual(event.shown, [{
    title: "Session complete",
    options: {
      body: "Task finished.",
      data: { url: "/?session=session-1", shownAt },
      tag: "pi-session-complete:session-1",
      renotify: true,
    },
  }]);
});

const completionPush = {
  title: "Session complete",
  body: "Task finished.",
  url: "/?session=session-1",
  tag: "pi-session-complete:session-1",
};

function existingNotifications(list) {
  return async ({ tag }) => list.filter((notification) => notification.tag === tag);
}

test("push quietly replaces the page's notification of the same completion (#1515)", async () => {
  const event = dispatchPush(completionPush, [], existingNotifications([
    { tag: "pi-session-complete:session-1", data: { url: "/?session=session-1", shownAt: Date.now() - 600 } },
  ]));
  await event.pending;

  // Still shown, which iOS requires, but without a second alert.
  assert.equal(event.shown.length, 1);
  assert.equal(event.shown[0].options.tag, "pi-session-complete:session-1");
  assert.equal(event.shown[0].options.renotify, false);
});

test("push alerts again over an earlier task's notification (#701)", async () => {
  const event = dispatchPush(completionPush, [], existingNotifications([
    { tag: "pi-session-complete:session-1", data: { url: "/?session=session-1", shownAt: Date.now() - 60_000 } },
    { tag: "pi-session-complete:session-1", data: { url: "/?session=session-1" } },
    { tag: "pi-session-complete:session-2", data: { url: "/?session=session-2", shownAt: Date.now() } },
  ]));
  await event.pending;

  assert.equal(event.shown.length, 1);
  assert.equal(event.shown[0].options.renotify, true);
});

test("push alerts when the browser cannot list notifications", async () => {
  const event = dispatchPush(completionPush, [], async () => { throw new Error("unsupported"); });
  await event.pending;

  assert.equal(event.shown.length, 1);
  assert.equal(event.shown[0].options.renotify, true);
});

test("push ignores malformed payloads", async () => {
  const event = dispatchPush(
    { title: "", body: 42 },
    [],
  );
  await event.pending;

  assert.deepEqual(event.shown, []);
});

test("a push the service sat on is a queued delivery, shown quiet and collapsed", async () => {
  // The server sends with a short TTL, so a phone that was offline usually loses a stale
  // notice. What does arrive minutes later is collapsed under one catch-up tag, silent: the
  // stack of "a lot of notifications with nothing running" becomes one quiet row.
  const event = dispatchPush({ ...completionPush, sentAt: Date.now() - 60 * 60_000 }, []);
  await event.pending;

  assert.equal(event.shown.length, 1, "a notification is still shown: iOS revokes the subscription when a push is handled without one");
  assert.equal(event.shown[0].options.tag, "pi-session-catchup", "one row for the whole backlog");
  assert.equal(event.shown[0].options.silent, true, "a day-old completion does not beep");
  assert.equal(event.shown[0].options.renotify, false);
  assert.equal(event.shown[0].options.data.url, "/?session=session-1", "it still opens the session");
});

test("a push that lands within the TTL alerts as usual", async () => {
  const event = dispatchPush({ ...completionPush, sentAt: Date.now() - 2000 }, [], existingNotifications([
    { tag: "pi-session-complete:session-2", data: { url: "/?session=session-2", shownAt: Date.now() } },
  ]));
  await event.pending;

  assert.equal(event.shown.length, 1);
  assert.equal(event.shown[0].options.tag, "pi-session-complete:session-1");
  assert.equal(event.shown[0].options.renotify, true);
  assert.equal(event.shown[0].options.silent, undefined);
});

test("a backlog of late pushes shares one tag, so the browser shows one row", async () => {
  const shown = [];
  self.registration = { showNotification: async (title, options) => { shown.push(options); }, getNotifications: async () => [] };
  const payload = { ...completionPush, sentAt: Date.now() - 30 * 60_000 };
  for (let i = 0; i < 3; i += 1) {
    const pending = new Promise((resolve) => listeners.get("push")({ data: { json: () => payload }, waitUntil: resolve }));
    await pending;
  }
  assert.equal(shown.length, 3);
  assert.deepEqual(new Set(shown.map((options) => options.tag)), new Set(["pi-session-catchup"]),
    "the tag is what makes the browser replace, not stack");
});

test("notification click focuses an existing client at the session URL", async () => {
  const calls = [];
  const focusedClient = {
    url: "https://pi.test/?session=session-1",
    focus: async () => { calls.push("focus"); },
    navigate: async () => assert.fail("exact client should not navigate"),
  };
  self.clients = {
    matchAll: async () => [focusedClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.equal(event.wasClosed(), true);
  assert.deepEqual(calls, ["focus"]);
});

test("notification click navigates an existing client to the session", async () => {
  const calls = [];
  const navigatedClient = {
    focus: async () => { calls.push("focus"); },
  };
  const existingClient = {
    url: "https://pi.test/?session=other-session",
    navigate: async (url) => {
      calls.push(["navigate", url]);
      return navigatedClient;
    },
    focus: async () => assert.fail("the navigated client should be focused"),
  };
  self.clients = {
    matchAll: async () => [existingClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.deepEqual(calls, [
    ["navigate", "https://pi.test/?session=session-1"],
    "focus",
  ]);
});

test("notification click opens a window and rejects cross-origin targets", async () => {
  const opened = [];
  self.clients = {
    matchAll: async () => [],
    openWindow: async (url) => { opened.push(url); },
  };

  const event = dispatchNotificationClick({ url: "https://example.com/redirect" });
  await event.pending;

  assert.deepEqual(opened, ["https://pi.test/"]);
});

// A reachable port backed by a dead upstream answers nothing at all, so these
// tests drive fetch() with a stub that only settles once the worker aborts it.
function installOfflineStub() {
  const pages = {
    "/offline.html": "<!doctype html><title>Pi Web is offline</title>",
    "/unavailable.html": "<!doctype html><title>Pi Web is not answering</title>",
  };
  const cacheReads = [];
  globalThis.caches = {
    match: async (request) => {
      const key = typeof request === "string" ? request : request.url;
      cacheReads.push(key);
      const hit = Object.entries(pages).find(([name]) => key.endsWith(name));
      return hit ? new Response(hit[1], { status: 200, headers: { "Content-Type": "text/html" } }) : undefined;
    },
    open: async () => ({ put: async () => {}, addAll: async () => {} }),
  };
  return cacheReads;
}

/** fetch() that rejects the way a refused port does: no response, no wait. */
function installRefusedNetwork() {
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch: connection refused");
  };
}

function dispatchFetch(url, { mode = "cors", method = "GET" } = {}) {
  let pending;
  const background = [];
  const request = new Request(url, { method });
  Object.defineProperty(request, "mode", { value: mode });
  listeners.get("fetch")({
    request,
    respondWith: (promise) => { pending = promise; },
    waitUntil: (promise) => { background.push(promise); },
  });
  return { pending, background };
}

test("install precaches offline assets but not the runtime manifest", async () => {
  let pending;
  let precached;
  let skipped = false;
  globalThis.caches = {
    open: async () => ({ addAll: async (urls) => { precached = urls; } }),
  };
  self.skipWaiting = async () => { skipped = true; };
  listeners.get("install")({ waitUntil: (promise) => { pending = promise; } });
  await pending;

  assert.deepEqual(precached, [
    "/offline.html",
    "/unavailable.html",
    "/offline-recovery.js",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/apple-touch-icon.png",
  ]);
  assert.equal(skipped, true);
});

test("every fallback page and its recovery script is precached", async () => {
  // The fallbacks are what a user sees with a dead server, so they must be in the cache
  // before the server is ever needed: an entry the worker has to fetch from the network
  // is exactly the entry that cannot be served offline.
  const files = [
    ["/offline.html", /Pi Web is offline/],
    ["/unavailable.html", /Pi Web is not answering/],
    ["/offline-recovery.js", /piWebOfflineRecovery/],
  ];
  const { readFile } = await import("node:fs/promises");
  for (const [file, pattern] of files) {
    assert.match(await readFile(new URL(`.${file}`, import.meta.url), "utf8"), pattern, file);
  }
});

test("manifest requests bypass the worker even with query strings and old cached entries", async () => {
  const stale = new Response('{"name":"Old Pi"}');
  let cacheReads = 0;
  globalThis.caches = {
    match: async () => { cacheReads++; return stale.clone(); },
    open: async () => assert.fail("manifest must not be cached"),
  };
  const networkRequests = [];
  globalThis.fetch = async (request) => {
    networkRequests.push(request.url);
    return new Response('{"name":"New Pi"}');
  };

  for (const path of ["/manifest.webmanifest", "/manifest.webmanifest?v=old"]) {
    for (const mode of ["cors", "navigate"]) {
      const url = `https://pi.test${path}`;
      const { pending, background } = dispatchFetch(url, { mode });
      assert.equal(pending, undefined, "no respondWith: leave the request to the browser");
      assert.deepEqual(background, []);
      // Model the browser's normal network fallback when respondWith is absent.
      const response = await fetch(new Request(url));
      assert.deepEqual(await response.json(), { name: "New Pi" });
    }
  }
  assert.equal(cacheReads, 0, "old cached manifests must never be read");
  assert.equal(networkRequests.length, 4);
});

/** fetch() that never settles until the signal it was handed is aborted. */
function installHungNetwork() {
  let aborted = false;
  globalThis.fetch = (_request, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  return () => aborted;
}

/**
 * Let a handler's await chain reach its fetch (and schedule its timer) before
 * the fake clock is ticked. setImmediate is not faked, unlike setTimeout.
 */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test("a stalled navigation is bounded, and says the server is not answering", async () => {
  const cacheReads = installOfflineStub();
  const wasAborted = installHungNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/", { mode: "navigate" });
    await flushMicrotasks();
    // The budget is a time-to-first-byte ceiling. A production server that is mid-task,
    // or a refresh queued behind the page's own event streams in the browser's six
    // connections, needs the room; 8s answered both with a fallback page it did not
    // deserve, and the user read that as "the app is offline".
    mock.timers.tick(14_000);
    assert.equal(wasAborted(), false, "the budget is 15s");
    mock.timers.tick(1_000);
    const response = await pending;

    assert.equal(wasAborted(), true, "a hung upstream must be aborted, not awaited forever");
    assert.match(await response.text(), /Pi Web is not answering/);
    assert.deepEqual(cacheReads, ["/unavailable.html"], "a silent server is not an offline server");
  } finally {
    mock.timers.reset();
  }
});

test("a refused port is the offline page, at once", async () => {
  const cacheReads = installOfflineStub();
  installRefusedNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/", { mode: "navigate" });
    const response = await pending;

    // Nothing is listening: say so, and do not spend the navigation budget first.
    assert.match(await response.text(), /Pi Web is offline/);
    assert.deepEqual(cacheReads, ["/offline.html"]);
    mock.timers.tick(20_000);
  } finally {
    mock.timers.reset();
  }
});

test("a browser that reports no network is answered from the cache", async () => {
  const cacheReads = installOfflineStub();
  globalThis.fetch = async () => assert.fail("the network is not worth trying with no network");
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
  try {
    const { pending } = dispatchFetch("https://pi.test/", { mode: "navigate" });
    assert.match(await (await pending).text(), /Pi Web is offline/);
    assert.deepEqual(cacheReads, ["/offline.html"]);
  } finally {
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  }
});

test("a navigation the server answers is passed through untouched", async () => {
  const cacheReads = installOfflineStub();
  globalThis.fetch = async () => new Response("<!doctype html><title>Pi Web</title>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });

  const { pending } = dispatchFetch("https://pi.test/?session=one", { mode: "navigate" });
  assert.match(await (await pending).text(), /<title>Pi Web<\/title>/);
  assert.deepEqual(cacheReads, []);
});

test("a stalled static asset request is bounded as well", async () => {
  installOfflineStub();
  const wasAborted = installHungNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
    // cacheFirst awaits the cache lookup before it reaches the network.
    await flushMicrotasks();
    mock.timers.tick(8000);

    assert.equal(wasAborted(), true);
    await assert.rejects(pending, /abort/i);
  } finally {
    mock.timers.reset();
  }
});

test("a fallback page's recovery poll is not answered by the worker", async () => {
  // Both pages poll their own URL to learn the server is back. If the worker answered
  // that request out of the cache, the page would reload in a loop against a dead server.
  installOfflineStub();
  let reachedNetwork = 0;
  globalThis.fetch = async () => {
    reachedNetwork += 1;
    return new Response("<!doctype html><title>Pi Web</title>", { headers: { "Content-Type": "text/html" } });
  };

  for (const mode of ["cors", "no-cors", "same-origin"]) {
    const { pending } = dispatchFetch("https://pi.test/?session=one", { mode });
    assert.equal(pending, undefined, `${mode}: the poll is left to the network`);
  }
  await fetch(new Request("https://pi.test/"));
  assert.equal(reachedNetwork, 1);
});

test("a cache miss responds before the cache write finishes", async () => {
  let releaseWrite;
  let writeStarted = false;
  globalThis.caches = {
    match: async () => undefined,
    open: async () => ({
      put: () => {
        writeStarted = true;
        return new Promise((resolve) => { releaseWrite = resolve; });
      },
    }),
  };
  // fetch() to a same-origin URL yields type "basic"; a constructed Response
  // defaults to "default", which cacheFirst deliberately skips.
  globalThis.fetch = async () => {
    const response = new Response("chunk", {
      status: 200,
      headers: { "Content-Type": "text/javascript" },
    });
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };

  const { pending, background } = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
  const response = await pending;

  // The regression this guards: the SW script URL is versioned, so a version
  // bump leaves the cache cold and every chunk misses at once. Awaiting each
  // write held the responses behind Cache Storage I/O, which pushed
  // navigations past the offline-fallback budget even though the server was
  // healthy. The response must never wait for the write.
  assert.equal(await response.text(), "chunk");

  await flushMicrotasks();
  assert.equal(writeStarted, true, "the write must still happen");
  assert.equal(background.length, 1, "the write must be kept alive with waitUntil");

  releaseWrite();
  await background[0];
});

test("a response that arrives in time is not cut off mid-stream", async () => {
  installOfflineStub();
  let signal;
  globalThis.fetch = async (_request, init) => {
    signal = init.signal;
    return new Response("<!doctype html><title>Pi Web</title>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/", { mode: "navigate" });
    const response = await pending;
    // The budget only covers time to first byte: a long-lived body keeps
    // streaming past it (Next.js streams its SSR payload).
    mock.timers.tick(60000);

    assert.equal(signal.aborted, false);
    assert.match(await response.text(), /<title>Pi Web<\/title>/);
  } finally {
    mock.timers.reset();
  }
});

test("the development worker is push-only: no precache, no fetch handling, a clean cache", async () => {
  // Development registers this same script as `?v=dev` so a phone added to the Home Screen
  // can subscribe to notifications while the Mac runs `npm run dev`. It must stay out of the
  // page's requests: development chunk URLs are not content-hashed and the dev server is the
  // thing being edited, so a cache-first asset pins the previous build and the user sees
  // none of their change. The offline fallback pages are production's job as well.
  const dev = new Map();
  const savedSelf = globalThis.self;
  const savedCaches = globalThis.caches;
  const opened = [];
  const deleted = [];
  globalThis.self = {
    location: { href: "https://pi.test/sw.js?v=dev", origin: "https://pi.test" },
    addEventListener: (type, listener) => dev.set(type, listener),
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
  };
  globalThis.caches = {
    keys: async () => ["pi-web-static-9.9.9", "pi-web-runtime", "someone-elses-cache"],
    open: async () => { opened.push("static"); return { addAll: async () => {} }; },
    delete: async (key) => { deleted.push(key); return true; },
  };

  let installPending;
  let devScript;
  let dir;
  try {
    // A second instance of the same script, so it reads the development location. Node
    // caches a module by its resolved file, so the script is copied to run again.
    dir = await mkdtemp(join(tmpdir(), "pi-sw-"));
    devScript = join(dir, "sw-development.js");
    await copyFile(new URL("./sw.js", import.meta.url), devScript);
    await import(pathToFileURL(devScript).href);

      dev.get("install")({ waitUntil: (promise) => { installPending = promise; } });
      await installPending;
      assert.deepEqual(opened, [], "nothing is precached in development");

      let activatePending;
      dev.get("activate")({ waitUntil: (promise) => { activatePending = promise; } });
      await activatePending;
      assert.deepEqual(deleted, ["pi-web-static-9.9.9", "pi-web-runtime"],
        "the caches a production run on this origin left behind go, and only those");

      let responded = false;
      dev.get("fetch")({
        request: { method: "GET", url: "https://pi.test/_next/static/chunk.js", mode: "navigate" },
        respondWith: () => { responded = true; },
      });
      await flushMicrotasks();
      assert.equal(responded, false, "every development request goes to the dev server untouched");

      // Push is the reason the development worker exists at all.
      const shown = [];
      globalThis.self.registration = {
        showNotification: async (title, options) => { shown.push({ title, options }); },
        getNotifications: async () => [],
      };
      globalThis.self.clients = {
        matchAll: async () => [],
        openWindow: async () => assert.fail("push must not open windows"),
      };
      let pushPending;
      dev.get("push")({
        data: {
          json: () => ({
            title: "don't modify anything, just say hi to me.",
            body: "The task lasted 0h1m49s, started at 08:13:02, and ended at 08:14:51. This notification pops up at 08:14:51.",
            url: "/chat?session=s-1",
            tag: "pi-agent-desktop",
            kind: "complete",
          }),
        },
        waitUntil: (promise) => { pushPending = promise; },
      });
      await pushPending;

      assert.equal(shown.length, 1, "a phone on `npm run dev` gets its notification");
      assert.equal(shown[0].title, "don't modify anything, just say hi to me.");
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true });
      globalThis.self = savedSelf;
      if (savedCaches === undefined) delete globalThis.caches;
      else globalThis.caches = savedCaches;
    }
  });
