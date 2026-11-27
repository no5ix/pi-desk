import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
});

const MINUTE = 60_000;

// A page that has a session selected renews its lease every 30 seconds, so the
// server learns about the *leaving* only from POST /api/agent/[id]/release.
// Without it, switching from a 100 MB transcript to another session leaves the
// first one loaded for a full idle timeout, and a few switches fill the heap.
test("leaving a session shortens its countdown to the release grace, and a return restores it", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-release-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousTimeout = process.env.PI_WEB_IDLE_TIMEOUT_MS;
  process.env.PI_CODING_AGENT_DIR = dir;
  delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
  let session;
  t.after(async () => {
    await session?.shutdown();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousTimeout === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
    else process.env.PI_WEB_IDLE_TIMEOUT_MS = previousTimeout;
    await rm(dir, { recursive: true, force: true });
  });
  const cwd = join(dir, "project");
  await mkdir(cwd);
  await writeFile(join(dir, "settings.json"), "{}");

  const { getRpcSession, startRpcSession, SESSION_IDLE_TIMEOUT_MS, resolveReleaseGraceMs } =
    await jiti.import("../../../lib/rpc-manager.ts");
  const { POST } = await jiti.import("./[id]/release/route.ts");
  const started = await startRpcSession("__new__agent-release", "", cwd, {});
  session = started.session;
  const id = started.realSessionId;

  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const idle = () => session.getDebugSnapshot().idle;
  const release = async (sessionId) => {
    const response = await POST(
      new Request(`http://localhost/api/agent/${encodeURIComponent(sessionId)}/release`, { method: "POST" }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    return { status: response.status, body: await response.json() };
  };
  const renew = async (sessionId) => {
    const { POST: renewPost } = await jiti.import("./[id]/lease/route.ts");
    const response = await renewPost(
      new Request(`http://localhost/api/agent/${encodeURIComponent(sessionId)}/lease`, { method: "POST" }),
      { params: Promise.resolve({ id: sessionId }) },
    );
    return response.json();
  };

  const graceMs = resolveReleaseGraceMs();
  assert.equal(SESSION_IDLE_TIMEOUT_MS, 10 * MINUTE);
  assert.ok(graceMs < 60_000, "the release grace is seconds, not the idle timeout");

  now += 2 * MINUTE;
  const released = await release(id);
  assert.equal(released.status, 200);
  assert.deepEqual(released.body, { success: true, released: true, running: false });
  assert.deepEqual(
    { lastResetAt: idle().lastResetAt, nextCheckAt: idle().nextCheckAt },
    { lastResetAt: now, nextCheckAt: now + graceMs },
    "the transcript is released seconds after the page left, not ten minutes",
  );

  // The page comes back (a switch back, a second tab): the lease renews, and the
  // full warm window is restored, so the session it returned to stays instant.
  now += 1_000;
  await renew(id);
  assert.deepEqual(
    { lastResetAt: idle().lastResetAt, nextCheckAt: idle().nextCheckAt },
    { lastResetAt: now, nextCheckAt: now + SESSION_IDLE_TIMEOUT_MS },
  );

  // A session the server holds nothing for is not started by a release.
  const unknown = "00000000-0000-4000-8000-000000000000";
  const unknownResult = await release(unknown);
  assert.deepEqual(unknownResult.body, { success: true, released: false, running: false });
  assert.equal(getRpcSession(unknown), undefined, "a release never starts a session");
});

test("a release with an event stream attached is not a release: another page is watching", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-agent-release-watched-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  let session;
  t.after(async () => {
    await session?.shutdown();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(dir, { recursive: true, force: true });
  });
  const cwd = join(dir, "project");
  await mkdir(cwd);
  await writeFile(join(dir, "settings.json"), "{}");

  const { startRpcSession, SESSION_IDLE_TIMEOUT_MS } = await jiti.import("../../../lib/rpc-manager.ts");
  const { POST } = await jiti.import("./[id]/release/route.ts");
  // The idle deadline is the wrapper's own creation deadline (`idleLastResetAt + timeout`),
  // so the clock is armed before the session starts: a start that lands in the millisecond
  // before this `now` under load is what made the comparison below fail once in ~8 runs.
  const now = Date.now();
  t.mock.method(Date, "now", () => now);
  const started = await startRpcSession("__new__agent-release-watched", "", cwd, {});
  session = started.session;
  const id = started.realSessionId;
  const unsubscribe = session.onEvent(() => {});
  t.after(() => unsubscribe());

  const response = await POST(
    new Request(`http://localhost/api/agent/${encodeURIComponent(id)}/release`, { method: "POST" }),
    { params: Promise.resolve({ id }) },
  );
  assert.deepEqual(await response.json(), { success: true, released: false, running: false });
  const idle = session.getDebugSnapshot().idle;
  assert.equal(idle.nextCheckAt, now + SESSION_IDLE_TIMEOUT_MS, "the watching page keeps the session warm");
});
