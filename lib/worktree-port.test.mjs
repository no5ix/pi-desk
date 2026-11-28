import assert from "node:assert/strict";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PORT,
  MAX_PORT,
  MAX_PORT_PROBES,
  normalizePort,
  readPortArgument,
  getPortCandidates,
  resolveDevPort,
} = require("../bin/worktree-port.js");

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("normalizes valid port values and rejects invalid values", () => {
  assert.equal(normalizePort("30141"), "30141");
  assert.equal(normalizePort(30142), "30142");
  assert.throws(() => normalizePort("30141;whoami"), /non-negative integer/);
  assert.throws(() => normalizePort("65536"), /between 0 and 65535/);
});

test("reads explicit Next.js and npm CLI port options", () => {
  assert.equal(readPortArgument(["--port", "30142"], {}), "30142");
  assert.equal(readPortArgument(["--port=30143"], {}), "30143");
  assert.equal(readPortArgument(["-p", "30144"], {}), "30144");
  assert.equal(readPortArgument(["-p30145"], {}), "30145");
  assert.equal(readPortArgument(["-p=30146"], {}), "30146");
  assert.equal(readPortArgument(["30142"], {}), "30142");
  assert.equal(readPortArgument(["--hostname", "127.0.0.1", "30142"], {}), "30142");
  assert.equal(readPortArgument(["--hostname", "127.0.0.1"], {}), undefined);
  assert.equal(readPortArgument([], { npm_config_port: "30146" }), "30146");
  assert.equal(readPortArgument(["--port", "30147"], { npm_config_port: "30146" }), "30147");
});

test("automatic candidates start at 30141 and increase one port at a time", () => {
  assert.deepEqual(getPortCandidates().slice(0, 5), [30141, 30142, 30143, 30144, 30145]);
  assert.equal(getPortCandidates().at(-1), MAX_PORT);
  assert.equal(getPortCandidates().length, MAX_PORT_PROBES);
  assert.deepEqual(getPortCandidates(30146).slice(0, 3), [30146, 30147, 30148]);
});

test("automatic allocation starts at 30141 and skips an occupied default port", async (t) => {
  const server = createServer();
  try {
    await listen(server, DEFAULT_PORT);
  } catch (error) {
    if (error.code === "EADDRINUSE" || error.code === "EACCES") {
      t.skip("The default development port is already occupied by another process.");
      return;
    }
    throw error;
  }

  try {
    const port = Number(await resolveDevPort({ env: {} }));
    assert.ok(port > DEFAULT_PORT);
    assert.ok(port <= MAX_PORT);
  } finally {
    await close(server);
  }
});

test("explicit ports and PI_WEB_PORT take precedence over automatic allocation", async () => {
  for (const port of [
    await resolveDevPort({ explicitPort: "0", env: {} }),
    await resolveDevPort({ env: { PI_WEB_PORT: "0", PORT: "0" } }),
    await resolveDevPort({ env: { PORT: "0" } }),
  ]) {
    assert.ok(Number(port) > 0);
  }
});

test("an occupied explicit port fails instead of silently selecting another", async () => {
  const server = createServer();
  await listen(server, 0);
  const port = String(server.address().port);
  try {
    await assert.rejects(resolveDevPort({ explicitPort: port, env: {} }), /already in use/);
  } finally {
    await close(server);
  }
});

test("automatic allocation is independent of main checkout or linked worktree location", async () => {
  const first = await resolveDevPort({ env: {} });
  assert.ok(Number(first) >= DEFAULT_PORT);
  assert.ok(Number(first) <= MAX_PORT);
  assert.equal(MAX_PORT_PROBES, MAX_PORT - DEFAULT_PORT + 1);
});
