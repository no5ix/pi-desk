import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// GET /api/sessions/[id]/last-run: the span of a session's last run, for the
// completion notification's "The task lasted …, started at …, and ended at …".
// The fixture is a real session file in a temporary agent dir, the same shape the
// browsing routes use.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-last-run-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");

const SESSION_ID = "01a20192-bf6c-7718-b7a0-1604e0cb2c06";
const T0 = Date.parse("2026-01-27T10:04:34.000Z");

function writeSession(lines) {
  const dir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", "--repo--");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `2026-01-27T10-00-00-000Z_${SESSION_ID}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

function entry(role, at, extra = {}) {
  return JSON.stringify({
    type: "message",
    id: `id-${at}-${role}`,
    parentId: null,
    timestamp: new Date(at).toISOString(),
    message: { role, timestamp: at, ...extra },
  });
}

function request(id = SESSION_ID) {
  return new NextRequest(`http://localhost/api/sessions/${encodeURIComponent(id)}/last-run`);
}

test("the last run's span, from the session's own entries", async () => {
  writeSession([
    JSON.stringify({ type: "session", version: 3, id: SESSION_ID, timestamp: new Date(T0 - 60_000).toISOString(), cwd: "/repo" }),
    entry("user", T0),
    entry("assistant", T0 + 5_000, { stopReason: "toolUse" }),
    entry("toolResult", T0 + 9_000),
    entry("assistant", T0 + 18 * 60_000 + 13_000, { stopReason: "stop" }),
    entry("user", T0 + 3_600_000),
    entry("assistant", T0 + 3_600_000 + 20_000, { stopReason: "stop" }),
  ]);
  const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID }) });
  assert.equal(response.status, 200);
  const data = await response.json();
  // The second prompt opens the last run, and the last entry closes it.
  assert.equal(data.startedAt, T0 + 3_600_000);
  assert.equal(data.endedAt, T0 + 3_600_000 + 20_000);
});

test("a session with no run answers 404, so nothing is announced", async () => {
  writeSession([
    JSON.stringify({ type: "session", version: 3, id: SESSION_ID, timestamp: new Date(T0).toISOString(), cwd: "/repo" }),
    entry("user", T0),
  ]);
  const response = await GET(request(), { params: Promise.resolve({ id: SESSION_ID }) });
  assert.equal(response.status, 404);
  assert.match((await response.json()).error, /no finished run/);
});

test("an unknown session answers 404", async () => {
  const response = await GET(request("00000000-0000-0000-0000-000000000000"), {
    params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
  });
  assert.equal(response.status, 404);
});

test("the id is required", async () => {
  const response = await GET(request(""), { params: Promise.resolve({ id: "" }) });
  assert.equal(response.status, 400);
});
