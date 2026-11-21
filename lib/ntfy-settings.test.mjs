import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  NTFY_DEFAULT_SERVER_URL,
  normalizeNtfyServerUrl,
  normalizeNtfyTopic,
  ntfyPublishUrl,
  parseNtfyUpdate,
  readNtfySettings,
  writeNtfySettings,
  buildNtfyRequest,
  ntfyText,
} = await createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false })
  .import("./ntfy-settings.ts");

// Settings › General › ntfy notification. The panel takes a `Server url` and a
// `Topic name`; these are the rules that decide what is storable, and the shape of the
// message that reaches the topic.

test("the server url defaults to https://ntfy.sh and stays an http(s) origin", () => {
  assert.equal(normalizeNtfyServerUrl(""), NTFY_DEFAULT_SERVER_URL);
  assert.equal(normalizeNtfyServerUrl(undefined), NTFY_DEFAULT_SERVER_URL);
  assert.equal(normalizeNtfyServerUrl("  "), NTFY_DEFAULT_SERVER_URL);
  assert.equal(normalizeNtfyServerUrl("ntfy.sh"), "https://ntfy.sh");
  assert.equal(normalizeNtfyServerUrl("https://ntfy.sh/"), "https://ntfy.sh");
  assert.equal(normalizeNtfyServerUrl("https://NTFY.sh/ntfy//"), "https://ntfy.sh/ntfy", "a self-hosted base path survives");
  assert.equal(normalizeNtfyServerUrl("http://localhost:8080"), "http://localhost:8080", "a local ntfy server is the usual self-hosting");
  assert.equal(normalizeNtfyServerUrl("https://localhost:8080"), null, "https to localhost is refused (mixed content)");
  assert.equal(normalizeNtfyServerUrl("http://192.168.0.9:8080"), "http://192.168.0.9:8080");
  assert.equal(normalizeNtfyServerUrl("ftp://ntfy.sh"), null);
  assert.equal(normalizeNtfyServerUrl("https://user:pw@ntfy.sh"), null, "credentials in the url are never stored");
  assert.equal(normalizeNtfyServerUrl("https://ntfy.sh?next=x"), null);
  assert.equal(normalizeNtfyServerUrl("javascript:alert(1)"), null);
  assert.equal(normalizeNtfyServerUrl(42), null);
});

test("the topic follows ntfy's grammar", () => {
  assert.equal(normalizeNtfyTopic("pi-mac"), "pi-mac");
  assert.equal(normalizeNtfyTopic("  pi_mac.1  "), "pi_mac.1");
  assert.equal(normalizeNtfyTopic(""), "");
  assert.equal(normalizeNtfyTopic("bad topic"), null);
  assert.equal(normalizeNtfyTopic("pi/../secret"), null);
  assert.equal(normalizeNtfyTopic("主题"), null, "ntfy topics are ASCII");
  assert.equal(normalizeNtfyTopic("a".repeat(65)), null);
  assert.equal(normalizeNtfyTopic("a".repeat(64)), "a".repeat(64));
});

test("the publish url joins server and topic", () => {
  assert.equal(ntfyPublishUrl("https://ntfy.sh", "pi"), "https://ntfy.sh/pi");
  assert.equal(ntfyPublishUrl("http://localhost:8080/", "pi"), "http://localhost:8080/pi");
  assert.equal(ntfyPublishUrl("https://ntfy.sh", ""), null, "no topic, nothing to publish to");
  assert.equal(ntfyPublishUrl("not a url", "pi"), null);
});

test("a PUT becomes a settings patch, and enabling needs a topic", () => {
  assert.deepEqual(parseNtfyUpdate({ enabled: true, serverUrl: "ntfy.sh", topic: "pi" }),
    { ok: true, patch: { enabled: true, serverUrl: "https://ntfy.sh", topic: "pi" } });
  assert.deepEqual(parseNtfyUpdate({ enabled: false }), { ok: true, patch: { enabled: false } });
  assert.deepEqual(parseNtfyUpdate({}), { ok: true, patch: {} });
  for (const body of [
    { enabled: true },
    { enabled: true, topic: "  " },
    { enabled: true, topic: "bad topic", serverUrl: "https://ntfy.sh" },
  ]) {
    const parsed = parseNtfyUpdate(body);
    assert.equal(parsed.ok, false, JSON.stringify(body));
    assert.match(parsed.error, /topic/);
  }
  assert.equal(parseNtfyUpdate({ enabled: "yes" }).ok, false);
  assert.equal(parseNtfyUpdate({ serverUrl: "ftp://x" }).ok, false);
  assert.equal(parseNtfyUpdate(null).ok, true, "an empty body changes nothing");
});

test("the settings round-trip through Pi Web's own settings file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-web-ntfy-"));
  const settingsPath = path.join(dir, "pi-web", "settings.json");
  try {
    assert.deepEqual(readNtfySettings(settingsPath), { enabled: false, serverUrl: NTFY_DEFAULT_SERVER_URL, topic: "" },
      "no file is the documented default, not an error");

    writeNtfySettings({ serverUrl: "https://ntfy.example.com/ntfy", topic: "pi-mac" }, settingsPath);
    assert.deepEqual(readNtfySettings(settingsPath), {
      enabled: false,
      serverUrl: "https://ntfy.example.com/ntfy",
      topic: "pi-mac",
    });

    assert.deepEqual(writeNtfySettings({ enabled: true }, settingsPath), {
      enabled: true,
      serverUrl: "https://ntfy.example.com/ntfy",
      topic: "pi-mac",
    });

    // A switch that cannot fire is off, not "enabled with no topic".
    writeNtfySettings({ topic: "" }, settingsPath);
    assert.equal(readNtfySettings(settingsPath).enabled, false);

    // The other Pi Web keys stay where they were (lib/artifact-settings.ts owns them).
    const { readStored } = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false })
      .import("./artifact-settings.ts");
    const stored = readStored(settingsPath);
    assert.equal(stored.artifactsPrompt, undefined);
    assert.equal(stored.ntfy.topic, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a broken settings file reads as the defaults, never as a crash", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-web-ntfy-broken-"));
  const settingsPath = path.join(dir, "pi-web", "settings.json");
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, "not json");
  try {
    assert.deepEqual(readNtfySettings(settingsPath), { enabled: false, serverUrl: NTFY_DEFAULT_SERVER_URL, topic: "" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the published message is the title plus the sentence", () => {
  const settings = { enabled: true, serverUrl: "https://ntfy.sh", topic: "pi" };
  const request = buildNtfyRequest(settings, {
    title: "Fix the parser",
    body: "The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at 10:22:47.",
  });
  assert.equal(request.url, "https://ntfy.sh/pi");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.headers.Title, "Fix the parser");
  assert.equal(request.init.headers.Priority, "3");
  assert.equal(request.init.headers.Tags, "pi");
  assert.equal(request.init.headers["Content-Type"], "text/plain; charset=utf-8");
  assert.ok(request.init.body.startsWith("Fix the parser\nThe task lasted 0h18m13s"),
    "the body repeats the title, so a client that ignores the Title header still reads well");

  assert.equal(buildNtfyRequest({ ...settings, topic: "" }, { title: "x" }), null);
  assert.equal(buildNtfyRequest(settings, { title: "  ", body: "  " }), null);
  assert.equal(buildNtfyRequest(settings, { title: "x", priority: 5 }).init.headers.Priority, "5");
  assert.equal(buildNtfyRequest(settings, { title: "x", priority: 99 }).init.headers.Priority, "3", "an out-of-range priority is ntfy's default");
});

test("message text is one line, so a session name cannot forge ntfy headers", () => {
  assert.equal(ntfyText("two\nlines", 100), "two lines");
  assert.equal(ntfyText("with\r\nbreaks", 100), "with breaks");
  assert.equal(ntfyText("a\u0000b\u001bc", 100), "a b c");
  assert.equal(ntfyText("x".repeat(500), 10).length, 10);
  assert.equal(ntfyText(undefined, 10), "");
  assert.equal(ntfyText({ evil: true }, 10), "");
});
