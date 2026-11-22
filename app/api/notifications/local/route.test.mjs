import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The macOS notification of Settings › General › Local browser notification. The tests cover
// the gates, the capability probe, the switch's own write, and the text sanitizing; the
// osascript call itself is pinned by source sentinel, because a test must not raise
// notifications.

const agentDir = await mkdtemp(path.join(tmpdir(), "pi-web-local-notify-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST, PUT, dynamic } = await jiti.import("./route.ts");
const { readLocalNotificationSettings, writeLocalNotificationSettings } = await jiti.import("../../../../lib/local-notification.ts");

test.after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const LOCAL = { host: "localhost", "content-type": "application/json" };
const macOS = process.platform === "darwin";

function post(body, headers = LOCAL) {
  return POST(new Request("http://localhost/api/notifications/local", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  }));
}

function put(body, headers = LOCAL) {
  return PUT(new Request("http://localhost/api/notifications/local", {
    method: "PUT",
    headers,
    body: JSON.stringify(body ?? {}),
  }));
}

test("the probe is dynamic", () => {
  assert.equal(dynamic, "force-dynamic");
});

test("GET states what this server can do, and how the switch is set", async () => {
  const local = await GET(new Request("http://localhost/api/notifications/local", { headers: { host: "localhost" } }));
  assert.equal(local.status, 200);
  assert.deepEqual(await local.json(), { supported: macOS, local: true, enabled: true, locale: "en" });

  const remote = await GET(new Request("http://pi.example.com/api/notifications/local", { headers: { host: "pi.example.com" } }));
  assert.deepEqual(await remote.json(), { supported: macOS, local: false, enabled: true, locale: "en" }, "a phone on the tailnet gets local: false");
});

test("the switch is the installation's, and only this computer writes it", async () => {
  const off = await put({ enabled: false });
  assert.equal(off.status, 200);
  assert.deepEqual(await off.json(), { enabled: false, locale: "en", local: true });
  assert.equal(readLocalNotificationSettings().enabled, false, "the write is in the settings file the announcer reads");

  const refused = await put({ enabled: true }, { host: "pi.example.com", "content-type": "application/json" });
  assert.equal(refused.status, 403, "a phone does not choose what the Mac shows");
  assert.equal(readLocalNotificationSettings().enabled, false, "the refused write changed nothing");

  const localized = await put({ locale: "zh-CN" });
  assert.equal((await localized.json()).locale, "zh-CN", "the server's sentence follows the app language of the page that set it");
  const nonsense = await put({ locale: "klingon" });
  assert.equal(nonsense.status, 400);
  const empty = await put({});
  assert.equal(empty.status, 400, "a write with nothing in it is not a write");
  assert.equal(readLocalNotificationSettings().locale, "zh-CN");
});

test("the announcer honours the switch", () => {
  writeLocalNotificationSettings({ enabled: false });
  assert.equal(readLocalNotificationSettings().enabled, false);
  writeLocalNotificationSettings({ enabled: true });
  assert.equal(readLocalNotificationSettings().enabled, true);
  assert.equal(readLocalNotificationSettings().locale, "zh-CN", "a patch carries only what it names");
});

test("only this computer's own browser may raise a notification", async () => {
  for (const headers of [
    { host: "pi.example.com", "content-type": "application/json" },
    { host: "10.0.0.7", "content-type": "application/json" },
    { host: "localhost", "content-type": "application/json", "x-pi-relay-mark": "1" },
    { host: "localhost", "content-type": "application/json", "tailscale-user-login": "user@example.com" },
  ]) {
    const response = await post({ title: "Work", body: "done" }, headers);
    assert.equal(response.status, 403, `${headers.host}${headers["x-pi-relay-mark"] ? " + relay mark" : ""} must be refused`);
  }
});

test("an empty notification is a 400, before any process is spawned", async () => {
  if (!macOS) return;
  for (const body of [{}, { title: "   " }, { body: "" }, { title: 42, body: null }]) {
    const response = await post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test("the notification text is one sanitized line, in the module that raises it", () => {
  // The script is built once, in lib/local-notification.ts, because the page's Test button
  // and the server's own announcer (lib/task-completion-server.ts) raise the same notice.
  const sender = readSource("lib/local-notification.ts");
  const source = readSource("app/api/notifications/local/route.ts");
  assert.ok(sender.includes("[\\u0000-\\u001f\\u007f]"), "control characters are stripped: they would break the AppleScript source");
  assert.match(sender, /display notification \$\{appleScriptString\(text\)\} with title \$\{appleScriptString\(title\)\}/);
  assert.match(sender, /MAX_TITLE_CHARS|MAX_BODY_CHARS/, "the text is capped");
  assert.match(source, /raiseMacNotification\(\{ title, body: text, silent: body\.silent === true \}\)/,
    "the route asks the one sender, so the sanitizing cannot be bypassed");
});

function readSource(relative) {
  // Node's test runner reports a file URL for the test file itself that is not the file's
  // own directory in every runner mode, so a cross-directory read goes from the repo root.
  return readFileSync(path.join(process.cwd(), relative), "utf8");
}
