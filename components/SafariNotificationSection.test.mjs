import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// Settings › General › Local notification: one row, one sender. The app that runs Pi
// (Terminal, or Pi Agent Desktop) raises a Notification Center row for every run this
// computer finishes — app/api/notifications/local, lib/local-notification.ts — titled with
// the session's name and worded with the run's length and clock times, the same sentence the
// phone push and the ntfy topic carry.
//
// The page used to raise a notification of its own next to it (the Notification API behind a
// per-browser localStorage switch, lib/task-completion-notice.ts). A finished task landing
// twice — the second one only while the tab was in the background — read as a bug, so the
// browser half is gone and this file keeps it gone. The browser's notification permission is
// still used for the extension UI's "needs you" notice and for scheduled runs
// (lib/browser-notifications.ts), which are separate features with their own rules.

const section = readFileSync(new URL("./SafariNotificationSection.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/safari-notification.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const prefs = readFileSync(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
const upstreamCss = readFileSync(new URL("../app/settings.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the section lives in Settings › General and names one channel", () => {
  assert.match(settings, /import \{ SafariNotificationSection \} from "\.\/SafariNotificationSection";/);
  assert.match(settings, /<SafariNotificationSection \/>/);
  assert.match(section, /className="settings-general-section safari-notification-section"/);
  // The shape the ntfy section uses: a heading, the sentence that says what the row raises,
  // then the row itself in the grey card.
  assert.match(section, /<h3 className="settings-general-heading">\{t\("safariNotify\.title"\)\}<\/h3>\n\s*<p className="settings-general-description">\{t\("safariNotify\.description"\)\}<\/p>/,
    "the description sits under the title, not inside the row");
  assert.match(section, /<div className="settings-option-list">/, "the row sits in a card, like the ntfy section's");
  assert.match(section, /<ConfigSwitch/);
  assert.match(section, /t\("safariNotify\.switch"\)/, "the one switch: this computer, no browser open");
  assert.match(section, /t\("safariNotify\.test"\)/, "the Test row asks the server to raise one");
});

test("the Test button is a bordered button", () => {
  // It sits beside the switch, and a borderless label there read as text, not as a control.
  assert.match(section, /<ConfigButton\n\s*className="settings-option-action"\n\s*variant="secondary"/);
  const secondary = upstreamCss.match(/\.config-button-secondary \{[^}]*\}/);
  assert.ok(secondary, "the secondary variant exists in the shared stylesheet");
  assert.match(secondary[0], /border-color: var\(--border\);/, "the variant it uses carries a border");
});

test("the browser's own banner is gone from every side of it", () => {
  // Removing the row and leaving the sender would mean a notification the user cannot switch
  // off, and one run announced twice on a Mac.
  assert.doesNotMatch(section, /safariNotificationsEnabled|getSafariNotificationSupport|safariNotificationsSupported/,
    "no browser switch, no probe of what this browser can do");
  assert.doesNotMatch(section, /t\("safariNotify\.(body|hint|serverSwitch|serverHint)"\)/,
    "the keys of the deleted row stay deleted");
  assert.doesNotMatch(client, /safariNotifyOnComplete|safariNotificationsEnabled/, "the client has no browser preference left");
  assert.doesNotMatch(prefs, /safariNotifyOnComplete/, "the localStorage key is gone, so no page keeps a hidden switch");
  assert.doesNotMatch(appShell, /notifyTaskCompletion|task-completion-notice/, "the chat announces nothing on its own");
  assert.throws(() => readFileSync(new URL("../lib/task-completion-notice.ts", import.meta.url)),
    "the page's sender module is deleted, not left unused");
  // The permission is not orphaned: the extension UI's notice and scheduled runs still use it.
  assert.match(appShell, /showBrowserNotification\(/, "the browser's notification is still used by the rows that keep it");
});

test("the notification the server raises is the installation's switch, not this browser's", () => {
  // A browser pref cannot describe a notification the server raises with no page open, and
  // a phone's localStorage must not decide what the Mac shows.
  assert.match(section, /getLocalNotificationSettings\(\)/);
  assert.match(section, /setLocalNotificationEnabled\(next\)/);
  assert.match(section, /const showServerRow = server !== null && server\.supported && server\.local;/,
    "the switch is shown where it can do anything: a macOS server, this computer");
  assert.match(section, /void getLocalNotificationSettings\(\)\.then\(\(value\) => \{\s*if \(value\) setServer\(value\);/,
    "a refused write puts the switch back to what the server says");
  for (const key of ["safariNotify.loading", "safariNotify.unsupported", "safariNotify.remote"]) {
    assert.match(section, new RegExp(`t\\("${key}"\\)`), `the section says why the switch is missing: ${key}`);
  }
  assert.match(section, /role="status"/, "the reason is shown where the user is reading");
  assert.match(client, /method: "PUT"[\s\S]*JSON\.stringify\(\{ enabled \}\)/);
  const localModule = readFileSync(new URL("../lib/local-notification.ts", import.meta.url), "utf8");
  assert.match(localModule, /updatePiWebSettings\(\{ localNotification: next \}, settingsPath\)/,
    "the switch is stored with the installation's other settings, not in localStorage");
  assert.match(localModule, /enabled: true/, "on by default: a Mac running Pi announces its finished tasks");
});

test("the sender never breaks the completion path", () => {
  assert.match(client, /fetch\("\/api\/notifications\/local", \{\s*method: "POST",/);
  const send = client.match(/export async function sendLocalNotificationTest[\s\S]*?\n}\n/);
  assert.ok(send, "sendLocalNotificationTest found");
  // One failure path for the whole function: no throw, no unhandled rejection, because
  // a completion notice runs at the end of a task next to the completion sound.
  assert.match(send[0], /\} catch \{\s*return false;\s*\}/);
  assert.doesNotMatch(send[0], /throw/, "it never throws");
  assert.match(client, /if \(!response\.ok\) return null;/, "the settings read answers, it never rejects");
  assert.match(client, /export async function setLocalNotificationEnabled[\s\S]*?\} catch \{\s*return false;/);
});

test("the section is named for what it is, in every language", () => {
  const messages = getLocalePlugin("en").messages;
  assert.equal(messages["safariNotify.title"], "Local notification");
  assert.ok(!messages["safariNotify.title"].toLowerCase().includes("browser"),
    "the title does not promise a browser: the row is the app's own notification");
  assert.ok(!messages["safariNotify.switch"].includes("Mac"),
    "the switch does not promise a Mac: it is this computer, whatever it runs");
  assert.ok(messages["safariNotify.description"].includes("Notification Center"),
    "the sentence under the title says where the notification appears");
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
    for (const key of ["safariNotify.title", "safariNotify.description", "safariNotify.switch", "safariNotify.test", "safariNotify.testTitle", "safariNotify.testSent", "safariNotify.testFailed", "safariNotify.loading", "safariNotify.unsupported", "safariNotify.remote"]) {
      assert.ok(messages[key], `${locale} has ${key}`);
    }
    for (const key of ["safariNotify.body", "safariNotify.hint", "safariNotify.serverSwitch", "safariNotify.serverHint"]) {
      assert.ok(!messages[key], `${locale} has no ${key}: the browser row is gone`);
    }
  }
});
