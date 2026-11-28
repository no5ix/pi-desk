import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PORT,
  WORKTREE_PORT_START,
  WORKTREE_PORT_COUNT,
  MAX_PORT_PROBES,
  normalizePort,
  readPortArgument,
  isLinkedWorktreeRoot,
  worktreePortForPath,
  getPortCandidates,
  resolveDevPort,
} = require("../bin/worktree-port.js");

test("normalizes valid port values and rejects invalid values", () => {
  assert.equal(normalizePort("30141"), "30141");
  assert.equal(normalizePort(30142), "30142");
  assert.throws(() => normalizePort("30141;whoami"), /non-negative integer/);
  assert.throws(() => normalizePort("65536"), /between 0 and 65535/);
});

test("reads explicit Next.js port flags", () => {
  assert.equal(readPortArgument(["--port", "30142"]), "30142");
  assert.equal(readPortArgument(["--port=30143"]), "30143");
  assert.equal(readPortArgument(["-p", "30144"]), "30144");
  assert.equal(readPortArgument(["-p30145"]), "30145");
  assert.equal(readPortArgument(["-p=30146"]), "30146");
  assert.equal(readPortArgument(["--hostname", "127.0.0.1"]), undefined);
});

test("recognizes linked worktrees from their .git file", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-worktree-port-"));
  try {
    await writeFile(join(root, ".git"), "gitdir: /tmp/example/.git/worktrees/feature\n");
    assert.equal(isLinkedWorktreeRoot(root), true);
    await rm(join(root, ".git"));
    await mkdir(join(root, ".git"));
    assert.equal(isLinkedWorktreeRoot(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("derives stable ports from worktree paths", () => {
  const first = worktreePortForPath("/tmp/pi-desk-worktrees/feature-a");
  const again = worktreePortForPath("/tmp/pi-desk-worktrees/feature-a");
  const second = worktreePortForPath("/tmp/pi-desk-worktrees/feature-b");
  assert.equal(first, again);
  assert.ok(first >= WORKTREE_PORT_START);
  assert.ok(first < WORKTREE_PORT_START + WORKTREE_PORT_COUNT);
  assert.notEqual(first, second);
});

test("port candidates are unique and begin with the preferred port", () => {
  const candidates = getPortCandidates(30500);
  assert.equal(candidates[0], 30500);
  assert.equal(candidates.length, WORKTREE_PORT_COUNT);
  assert.equal(new Set(candidates).size, candidates.length);
  assert.ok(candidates.every((port) => port >= WORKTREE_PORT_START && port < WORKTREE_PORT_START + WORKTREE_PORT_COUNT));
  assert.equal(getPortCandidates(DEFAULT_PORT)[0], DEFAULT_PORT);
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
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = String(server.address().port);
  try {
    await assert.rejects(resolveDevPort({ explicitPort: port, env: {} }), /already in use/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("automatic allocation returns a port in the supported development range", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-port-cwd-"));
  try {
    const port = Number(await resolveDevPort({ cwd, env: {} }));
    assert.ok(port === DEFAULT_PORT || (port >= WORKTREE_PORT_START && port < WORKTREE_PORT_START + WORKTREE_PORT_COUNT));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the automatic resolver has a bounded collision scan", () => {
  assert.equal(MAX_PORT_PROBES, 64);
});
