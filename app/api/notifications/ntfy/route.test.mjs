import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// Settings › General › ntfy notification, server side. The panel writes a `Server url`
// and a `Topic name`, and a finished task POSTs the message. A topic is a shared secret,
// so a page that is not Pi on this computer gets it masked and cannot change it.

const agentDir = await mkdtemp(path.join(tmpdir(), "pi-web-ntfy-route-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
const settingsPath = path.join(agentDir, "pi-web", "settings.json");

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, PUT, POST, dynamic } = await jiti.import("./route.ts");
const { readNtfySettings, writeNtfySettings } = await jiti.import("../../../../lib/ntfy-settings.ts");

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const LOCAL_HOST = { host: "localhost", "content-type": "application/json" };

function call(handler, body, headers = LOCAL_HOST) {
  return handler(new Request("http://localhost/api/notifications/ntfy", {
    method: handler === GET ? "GET" : handler === PUT ? "PUT" : "POST",
    headers,
    body: handler === GET ? undefined : JSON.stringify(body ?? {}),
  }));
}

async function configure(settings) {
  writeNtfySettings(settings, settingsPath);
}

test("the panel's reads and writes are dynamic", () => {
  assert.equal(dynamic, "force-dynamic");
});

test("GET shows the topic to this computer and masks it everywhere else", async () => {
  await configure({ enabled: true, serverUrl: "https://ntfy.sh", topic: "pi-mac" });

  const local = await call(GET, undefined, { host: "localhost" });
  assert.deepEqual(await local.json(), { enabled: true, serverUrl: "https://ntfy.sh", topic: "pi-mac", local: true });

  for (const headers of [
    { host: "pi.example.com" },
    { host: "macb00kpr0m4.taila0e40f.ts.net" },
    { host: "localhost", "x-pi-relay-mark": "1" },
    { host: "localhost", "tailscale-user-login": "user@example.com" },
  ]) {
    const remote = await call(GET, undefined, headers);
    const data = await remote.json();
    assert.equal(data.local, false);
    assert.equal(data.topicConfigured, true);
    assert.notEqual(data.topic, "pi-mac", "the topic never leaves this computer");
    assert.equal(data.serverUrl, "https://ntfy.sh");
    assert.equal(data.enabled, true);
  }
});

test("only this computer may change the settings", async () => {
  await configure({ enabled: false, serverUrl: "https://ntfy.sh", topic: "" });
  const refused = await call(PUT, { enabled: true, topic: "pi-mac" }, { host: "pi.example.com" });
  assert.equal(refused.status, 403);
  assert.equal(readNtfySettings(settingsPath).topic, "", "the refused write changed nothing");

  const accepted = await call(PUT, { enabled: true, serverUrl: "ntfy.sh", topic: "pi-mac" });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { enabled: true, serverUrl: "https://ntfy.sh", topic: "pi-mac", local: true });
  assert.deepEqual(readNtfySettings(settingsPath), { enabled: true, serverUrl: "https://ntfy.sh", topic: "pi-mac" });
});

test("a settings write is validated before it is stored", async () => {
  await configure({ enabled: false, serverUrl: "https://ntfy.sh", topic: "keepme" });
  for (const body of [
    { topic: "bad topic" },
    { serverUrl: "ftp://ntfy.sh" },
    { serverUrl: "https://user:pw@ntfy.sh" },
    { enabled: true, topic: "" },
    { enabled: "yes" },
  ]) {
    const response = await call(PUT, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, /topic|serverUrl|enabled/);
  }
  assert.deepEqual(readNtfySettings(settingsPath), { enabled: false, serverUrl: "https://ntfy.sh", topic: "keepme" });
});

test("publishing needs the switch, and the switch is the server's", async () => {
  await configure({ enabled: false, serverUrl: "https://ntfy.sh", topic: "pi-mac" });
  const response = await call(POST, { title: "Work", body: "done" });
  assert.equal(response.status, 409);
  const data = await response.json();
  assert.equal(data.disabled, true, "the client reads a disabled ntfy as nothing to do, not as a failure to show");
});

test("a published message is the title and the sentence on the topic", async () => {
  await configure({ enabled: true, serverUrl: "https://ntfy.sh", topic: "pi-mac" });
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init });
    return Promise.resolve({ ok: true, status: 200, text: async () => "" });
  };
  try {
    const response = await call(POST, {
      title: "Fix the parser",
      body: "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at 10:22:47.",
    });
    assert.deepEqual(await response.json(), { sent: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://ntfy.sh/pi-mac");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Title, "Fix the parser");
    assert.equal(calls[0].init.headers.Priority, "3");
    assert.ok(calls[0].init.body.includes("0h18m13s"));
    assert.ok(calls[0].init.signal, "a hung ntfy server cannot pin the completion handler");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("an unreachable topic is a 502 with the reason, never a crash", async () => {
  await configure({ enabled: true, serverUrl: "https://ntfy.example.invalid", topic: "pi-mac" });
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("getaddrinfo ENOTFOUND ntfy.example.invalid"));
  try {
    const response = await call(POST, { title: "Work", body: "done" });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /ntfy\.example\.invalid/);
  } finally {
    globalThis.fetch = savedFetch;
  }

  globalThis.fetch = () => Promise.resolve({ ok: false, status: 400, text: async () => "topic not found" });
  try {
    const response = await call(POST, { title: "Work", body: "done" });
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /topic not found/);
  } finally {
    globalThis.fetch = savedFetch;
  }

  const empty = await call(POST, { title: "  ", body: "" });
  assert.equal(empty.status, 400, "an empty message is not published");
});
