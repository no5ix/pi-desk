import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// Settings › General › Local browser notification: a finished task raises a notification
// whose title is the session name and whose body is the run's length and clock times.
// Chrome and Edge raise it from the page; a plain Safari tab cannot, so the local server
// raises it too (app/api/notifications/local). The settings row, the sender and the one
// notice per finished task are pinned here; the route's gates are in
// app/api/notifications/local/route.test.mjs, and the notice's own rules in
// lib/task-completion-notice.test.mjs.

const section = readFileSync(new URL("./SafariNotificationSection.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/safari-notification.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const prefs = readFileSync(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");

test("the row lives in Settings › General and states the truth about the platform", () => {
  assert.match(settings, /import \{ SafariNotificationSection \} from "\.\/SafariNotificationSection";/);
  assert.match(settings, /<SafariNotificationSection \/>/);
  assert.match(section, /className="settings-general-section safari-notification-section"/);
  assert.match(section, /<div className="settings-option-list">/, "the row sits in a card, like the ntfy section's");
  // The probe decides, so a phone (local: false) or a Linux server gets a disabled
  // switch and a reason, not a switch that silently does nothing.
  assert.match(section, /getSafariNotificationSupport\(\)/);
  assert.match(section, /const blocked = support !== null \&\& \(!support\.supported \|\| !support\.local\);/);
  assert.match(section, /disabled={blocked}/);
  assert.match(section, /loading=\{support === null\}/);
  assert.match(section, /t\("safariNotify\.unsupported"\)/);
  assert.match(section, /t\("safariNotify\.remote"\)/);
  // The shared controls, so the row looks like every other settings row.
  assert.match(section, /<ConfigSwitch/);
  assert.match(section, /<ConfigButton/);
  assert.match(section, /t\("safariNotify\.test"\)/, "the Test row sends one notification");
});

test("the switch is a browser preference, not a server setting", () => {
  assert.match(prefs, /safariNotifyOnComplete: "pi-web:safari-notify-on-complete"/);
  assert.match(client, /setPrefBool\(APP_PREF_KEYS\.safariNotifyOnComplete, enabled\)/);
  assert.match(client, /getPrefBool\(APP_PREF_KEYS\.safariNotifyOnComplete, false\)/, "off until the user switches it on");
});

test("the sender never breaks the completion path", () => {
  assert.match(client, /fetch\("\/api\/notifications\/local", \{\s*method: "POST",/);
  assert.match(client, /if \(!safariNotificationsEnabled\(\)\) return false;/, "the switch is checked at send time, so flipping it off takes effect immediately");
  // One failure path for the whole function: no throw, no unhandled rejection, because
  // this runs inside the agent_end handler next to the sound and the browser notification.
  const send = client.match(/export async function sendSafariNotification[\s\S]*?\n}\n/);
  assert.ok(send, "sendSafariNotification found");
  assert.match(send[0], /\} catch \{\s*return false;\s*\}/);
  assert.doesNotMatch(send[0], /throw/, "it never throws");
  assert.match(client, /if \(!response\.ok\) return \{ supported: false, local: false \};/, "the probe answers, it never rejects");
});

test("a finished run announces it once, and a stopped run stays silent", () => {
  const handler = appShell.match(/const handleAgentEnd = useCallback[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert.ok(handler, "handleAgentEnd found");
  assert.match(handler[0], /if \(end\?\.aborted\) return;/, "a stopped run announces nothing");
  assert.match(handler[0], /if \(isHiddenRelation\(selectedSession\?\.relation\)\) return;/);
  assert.match(handler[0], /void notifyTaskCompletion\(/, "one sender for every channel");
  assert.match(handler[0], /sessionName: selectedSession\?\.name \?\? null/);
  assert.match(handler[0], /end: end \?\? \{ aborted: false \},/);
  assert.match(handler[0], /fetchLastRun: fetchLastRunTimes/, "a run this page did not see begin gets its times from the session file");
  assert.match(handler[0], /notified: notifiedCompletionRunsRef\.current/, "one notice per finished run");
  assert.doesNotMatch(handler[0], /shouldShowBrowserNotification\(\)/,
    "the foreground rule belongs to the sender, so the Notification Center notice is not gated on this tab's push state");
  assert.doesNotMatch(handler[0], /sendSafariNotification|sendNtfyNotification|formatCompletionSummary/,
    "the chat does not ask the channels by hand any more");
  const shell = appShell;
  assert.match(shell, /const notifiedCompletionRunsRef = useRef\(new Set<string>\(\)\);/);
});

test("the row is named for what it is, in every language", () => {
  const messages = getLocalePlugin("en").messages;
  assert.equal(messages["safariNotify.title"], "Local browser notification");
  assert.ok(!messages["safariNotify.switch"].includes("Mac"),
    "the switch does not promise a Mac: Chrome and Edge on any system get the page's notification");
  assert.match(messages["safariNotify.hint"], /Chrome and Edge/, "the hint names the browsers it works in");
  for (const locale of getSupportedLocales()) {
    const localized = getLocalePlugin(locale).messages;
    assert.ok(!localized["safariNotify.title"].startsWith("Safari"), `${locale}: the section is not named after one browser`);
    assert.ok(!localized["safariNotify.switch"].includes("Mac"), `${locale}: the switch is not Mac-specific`);
  }
});

test("every locale carries the sentence with the same four placeholders", () => {
  for (const locale of getSupportedLocales()) {
    const messages = getLocalePlugin(locale).messages;
    const summary = messages["safariNotify.summary"];
    assert.equal(typeof summary, "string", `${locale} has safariNotify.summary`);
    for (const placeholder of ["{duration}", "{started}", "{ended}", "{now}"]) {
      assert.ok(summary.includes(placeholder), `${locale} keeps ${placeholder}`);
    }
    for (const key of ["safariNotify.title", "safariNotify.switch", "safariNotify.body", "safariNotify.test", "safariNotify.testTitle", "safariNotify.testSent", "safariNotify.testFailed", "safariNotify.hint", "safariNotify.loading", "safariNotify.unsupported", "safariNotify.remote"]) {
      assert.ok(messages[key], `${locale} has ${key}`);
    }
  }
});
