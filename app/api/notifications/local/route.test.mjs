import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST, dynamic } = await jiti.import("./route.ts");

// The local macOS notification (Settings › General › Safari notification). The tests
// cover the gates, the capability probe and the text sanitizing; the osascript call
// itself is pinned by source sentinel, because a test must not raise notifications.

const LOCAL = { host: "localhost", "content-type": "application/json" };
const macOS = process.platform === "darwin";

function post(body, headers = LOCAL) {
  return POST(new Request("http://localhost/api/notifications/local", {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  }));
}

test("the probe is dynamic", () => {
  assert.equal(dynamic, "force-dynamic");
});

test("GET states what this server can do", async () => {
  const local = await GET(new Request("http://localhost/api/notifications/local", { headers: { host: "localhost" } }));
  assert.equal(local.status, 200);
  assert.deepEqual(await local.json(), { supported: macOS, local: true });

  const remote = await GET(new Request("http://pi.example.com/api/notifications/local", { headers: { host: "pi.example.com" } }));
  assert.deepEqual(await remote.json(), { supported: macOS, local: false }, "a phone on the tailnet gets local: false");
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

test("the notification text is one sanitized line", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.ok(source.includes("[\\u0000-\\u001f\\u007f]"), "control characters are stripped: they would break the AppleScript source");
  assert.match(source, /display notification \$\{appleScriptString\(text\)\} with title \$\{appleScriptString\(title\)\}/);
  assert.match(source, /MAX_TITLE_CHARS|MAX_BODY_CHARS/, "the text is capped");
});
