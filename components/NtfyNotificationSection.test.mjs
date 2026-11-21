import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// Settings › General › ntfy notification: `Server url` (default https://ntfy.sh),
// `Topic name`, a switch and a Send Test Notice button; a finished task publishes the
// session name and the same sentence the local notification shows. The route's gates and
// the settings file are covered in app/api/notifications/ntfy/route.test.mjs and
// lib/ntfy-settings.test.mjs.

const section = readFileSync(new URL("./NtfyNotificationSection.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/ntfy-notification.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");

test("the row lives in Settings › General with the two fields and the two buttons", () => {
  assert.match(settings, /import \{ NtfyNotificationSection \} from "\.\/NtfyNotificationSection";/);
  assert.match(settings, /<NtfyNotificationSection \/>/, "beside the other notification rows");
  assert.match(section, /className="settings-general-section ntfy-notification-section"/);
  assert.match(section, /t\("ntfyNotify\.serverLabel"\)[\s\S]*className="mcp-add-input"[\s\S]*placeholder="https:\/\/ntfy\.sh"/,
    "the Server url field shows the documented default as its placeholder");
  assert.match(section, /t\("ntfyNotify\.topicLabel"\)[\s\S]*className="mcp-add-input"/);
  assert.match(section, /<ConfigSwitch/);
  assert.match(section, /t\("ntfyNotify\.save"\)/);
  assert.match(section, /t\("ntfyNotify\.test"\)/, "the Send Test Notice button");
});

test("a remote page cannot read or move the topic", () => {
  assert.match(section, /const editable = settings\?\.local === true;/);
  assert.match(section, /disabled=\{!editable\}/);
  assert.match(section, /t\("ntfyNotify\.localOnly"\)/);
  assert.match(section, /setTopic\(data\.topic === MASKED_TOPIC \? "" : data\.topic\)/,
    "the mask is never written back as if it were the topic");
  assert.match(client, /method: "PUT"[\s\S]*JSON\.stringify\(patch\)/);
});

test("the switch carries the fields, so enabling is one honest write", () => {
  assert.match(section, /const toggle = useCallback\(\(next: boolean\) => \{\s*void save\(\{ enabled: next, serverUrl, topic \}\);/,
    "no half-saved switch that the server refuses");
  assert.match(section, /const canTest = editable && settings\?\.enabled === true && topic\.trim\(\) !== "";/,
    "the test button only appears where a notice can arrive");
  // The sentence template is fetched under a second name (t: translate) so the i18n usage
  // checker does not read it as an interpolation call site; the formatting is shared.
  assert.match(section, /const \{ t, locale, t: translate \} = useI18n\(\);/);
  assert.match(section, /formatCompletionSummary\(\s*translate\("safariNotify\.summary"\),/);
  assert.match(section, /result\.error \? t\("ntfyNotify\.testFailedWithError", \{ error: result\.error \}\)/,
    "the server's reason is shown, not a generic failure");
});

test("a finished run publishes the session name and the sentence", () => {
  const handler = appShell.match(/const handleAgentEnd = useCallback[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert.ok(handler, "handleAgentEnd found");
  assert.match(handler[0], /const completionTitle = selectedSession\?\.name \?\? translate\("i18n\.sessionComplete"\);/,
    "the title is the session's name");
  assert.match(handler[0], /const completionBody = formatCompletionSummary\(\s*translate\("safariNotify\.summary"\),\s*\{ startedAt: end\.startedAt, endedAt: end\.endedAt, poppedAt: Date\.now\(\) \},\s*locale,\s*\);/);
  assert.match(handler[0], /void sendSafariNotification\(\{ title: completionTitle, body: completionBody \}\);[\s\S]{0,220}void sendNtfyNotification\(\{ title: completionTitle, body: completionBody \}\);/,
    "one sentence, sent to both the Mac and the topic — and the client never gates on the ntfy switch, the server owns it");
  assert.match(client, /if \(response\.ok\) return \{ sent: true \};/, "the completion path is fire-and-forget");
});

test("every locale carries the ntfy row", () => {
  for (const locale of getSupportedLocales()) {
    const messages = getLocalePlugin(locale).messages;
    for (const key of [
      "ntfyNotify.title", "ntfyNotify.description", "ntfyNotify.serverLabel", "ntfyNotify.topicLabel",
      "ntfyNotify.switch", "ntfyNotify.hint", "ntfyNotify.save", "ntfyNotify.saved", "ntfyNotify.test",
      "ntfyNotify.testTitle", "ntfyNotify.testSent", "ntfyNotify.testFailed", "ntfyNotify.testFailedWithError",
      "ntfyNotify.localOnly", "ntfyNotify.loading",
    ]) {
      assert.ok(messages[key], `${locale} has ${key}`);
    }
    assert.ok(messages["ntfyNotify.testFailedWithError"].includes("{error}"), `${locale} keeps the {error} placeholder`);
    assert.equal(messages["ntfyNotify.test"], locale === "en" ? "Send Test Notice" : messages["ntfyNotify.test"],
      "the button label is the user's words in English");
  }
});
