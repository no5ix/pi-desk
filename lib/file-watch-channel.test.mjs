import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { createFileWatchChannel, FILE_WATCH_STREAM_NAME, MAX_WATCHED_FILES } = await jiti.import("./file-watch-channel.ts");

/**
 * A stand-in for lib/scheduled-tasks/shared-stream.ts: it records what was opened, hands
 * back the event callbacks, and counts the streams still open. The leader election, the
 * BroadcastChannel fan-out and the reconnect are that module's own tests.
 */
function harness({ debounceMs = 10 } = {}) {
  const opened = [];
  const channel = createFileWatchChannel({
    debounceMs,
    openStream: (options) => {
      const stream = {
        url: options.url,
        name: options.name,
        onEvent: options.onEvent,
        onError: options.onError,
        closed: false,
      };
      opened.push(stream);
      return () => { stream.closed = true; };
    },
  });
  const live = () => opened.filter((stream) => !stream.closed);
  return { channel, opened, live };
}

/** Let the channel's debounce run. */
const flush = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function watchedFilesOf(url) {
  const params = new URL(url, "http://localhost").searchParams;
  assert.equal(params.get("type"), "watch-all");
  return JSON.parse(params.get("paths"));
}

test("one stream carries every file the page watches", async () => {
  const { channel, live } = harness();
  channel.subscribe({ filePath: "/p/a.ts" }, {});
  channel.subscribe({ filePath: "/p/b.ts" }, {});
  channel.subscribe({ filePath: "/p/c.ts" }, {});
  await flush();

  assert.equal(live().length, 1, "one connection for three files");
  assert.deepEqual(
    watchedFilesOf(live()[0].url).map((entry) => entry.filePath).sort(),
    ["/p/a.ts", "/p/b.ts", "/p/c.ts"],
  );
  assert.equal(live()[0].name, FILE_WATCH_STREAM_NAME, "the tabs elect one leader over this name");
  channel.stop();
});

test("the same file in two views is one entry, and one unsubscribe keeps it", async () => {
  const { channel, live } = harness();
  const stopCode = channel.subscribe({ filePath: "/p/a.ts" }, {});
  const stopPreview = channel.subscribe({ filePath: "/p/a.ts" }, {});
  await flush();

  assert.equal(watchedFilesOf(live()[0].url).length, 1);
  stopCode();
  await flush();
  assert.equal(watchedFilesOf(channel.streamUrl()).length, 1, "the preview still watches it");

  stopPreview();
  await flush();
  assert.equal(live().length, 0, "the stream closes with the last viewer");
  assert.equal(channel.streamUrl(), null);
  channel.stop();
});

test("a burst of opens and closes is one reopen", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { channel, live } = harness({ debounceMs: 250 });
    const stops = ["/p/a.ts", "/p/b.ts", "/p/c.ts", "/p/d.ts"].map((filePath) => channel.subscribe({ filePath }, {}));
    assert.equal(live().length, 1, "the first file opens at once, the rest wait for the burst");
    assert.deepEqual(watchedFilesOf(live()[0].url).map((entry) => entry.filePath), ["/p/a.ts"]);

    mock.timers.tick(300);
    assert.equal(live().length, 1, "the burst retired the first stream");
    assert.deepEqual(
      watchedFilesOf(live()[0].url).map((entry) => entry.filePath).sort(),
      ["/p/a.ts", "/p/b.ts", "/p/c.ts", "/p/d.ts"],
    );

    stops.forEach((stop) => stop());
    mock.timers.tick(300);
    assert.equal(live().length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("a change is delivered to the viewers of that file only", async () => {
  const { channel, live } = harness();
  const heard = { a: [], b: [], bOtherSession: [] };
  channel.subscribe({ filePath: "/p/a.ts" }, { onChange: (info) => heard.a.push(info) });
  channel.subscribe({ filePath: "/p/b.ts" }, { onChange: (info) => heard.b.push(info) });
  channel.subscribe({ filePath: "/p/b.ts", sourceSessionId: "s-2" }, { onChange: (info) => heard.bOtherSession.push(info) });
  await flush();

  const stream = live()[0];
  assert.equal(live().length, 1);
  stream.onEvent({ type: "change", filePath: "/p/b.ts", sessionId: null, mtime: "2026-01-01T00:00:00.000Z", size: 12 });
  assert.deepEqual(heard.a, [], "a change of one file is not a change of every file");
  assert.deepEqual(heard.b, [{ mtime: "2026-01-01T00:00:00.000Z", size: 12 }]);
  assert.deepEqual(heard.bOtherSession, [], "a session's copy of a file is its own subscription");

  stream.onEvent({ type: "change", filePath: "/p/b.ts", sessionId: "s-2", size: 7 });
  assert.deepEqual(heard.bOtherSession, [{ mtime: undefined, size: 7 }]);
  channel.stop();
});

test("the frames a shared stream forwards drive every viewer", async () => {
  const { channel, live } = harness();
  const seen = [];
  const record = (name) => ({
    onConnected: () => seen.push(`${name}:connected`),
    onRemoved: () => seen.push(`${name}:removed`),
    onDisconnect: () => seen.push(`${name}:disconnected`),
  });
  channel.subscribe({ filePath: "/p/a.ts" }, record("a"));
  channel.subscribe({ filePath: "/p/b.ts" }, record("b"));
  await flush();

  const stream = live()[0];
  // The leader resnapshots on connect, and the tabs that only listen hear the same frame
  // over the BroadcastChannel: both views must re-read, not only the leader's.
  stream.onEvent({ type: "connected", paths: ["/p/a.ts", "/p/b.ts"] });
  stream.onEvent({ type: "removed", filePath: "/p/a.ts", sessionId: null });
  stream.onEvent({ type: "error", message: "Failed to watch a.ts" });
  assert.deepEqual(seen, ["a:connected", "b:connected", "a:removed", "a:disconnected", "b:disconnected"]);

  stream.onError("dropped");
  assert.deepEqual(seen.slice(5), ["a:disconnected", "b:disconnected"]);
  channel.stop();
});

test("a viewer whose handler throws does not stop the others", async () => {
  const { channel, live } = harness();
  const heard = [];
  channel.subscribe({ filePath: "/p/a.ts" }, { onChange: () => { throw new Error("render exploded"); } });
  channel.subscribe({ filePath: "/p/a.ts" }, { onChange: () => heard.push("second") });

  live()[0].onEvent({ type: "change", filePath: "/p/a.ts", sessionId: null, size: 3 });
  assert.deepEqual(heard, ["second"]);
  channel.stop();
});

test("a page that watches more than the server answers sends only what it can", async () => {
  const { channel, live } = harness();
  for (let i = 0; i < MAX_WATCHED_FILES + 10; i++) channel.subscribe({ filePath: `/p/f${i}.ts` }, {});
  await flush();
  // A URL the server refuses (its cap is a 400) would leave the shared stream retrying
  // every few seconds, and the watchers of every tab would go down with it.
  assert.equal(watchedFilesOf(live()[0].url).length, MAX_WATCHED_FILES);
  channel.stop();
});

test("the watched set is sent the way the server parses it", async () => {
  const { channel, live } = harness();
  channel.subscribe({ filePath: "/p/with space/naïve.ts", sourceSessionId: "s-1" }, {});

  const [entry] = watchedFilesOf(live()[0].url);
  assert.deepEqual(entry, { filePath: "/p/with space/naïve.ts", sessionId: "s-1" });
  assert.deepEqual(channel.watchedFiles(), ["/p/with space/naïve.ts"]);
  channel.stop();
});
