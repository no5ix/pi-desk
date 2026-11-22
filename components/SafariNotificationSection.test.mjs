import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// Settings › General › Local browser notification: a finished task raises a notification
// whose title is the session name and whose body is the run's length and clock times. Two
// switches, because two programs raise them: this browser's own banner (Chrome and Edge
// raise it from the page; a plain Safari tab cannot), and the notification the app running
// Pi raises in Notification Center with no page open at all (app/api/notifications/local,
// lib/local-notification.ts). The rows, the senders and the one notice per finished task
// are pinned here; the route's gates are in app/api/notifications/local/route.test.mjs,
// and the notice's own rules are in lib/task-completion-notice.test.mjs.

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
  // The probe decides what the *server* can do, so a phone (local: false) or a Linux
  // server gets a stated reason and no row that silently does nothing — while the page's
  // own switch stays available, because a browser raising a banner needs no server.
  assert.match(section, /getSafariNotificationSupport\(\)/);
  assert.match(section, /const showServerRow = server !== null && server\.supported && server\.local;/);
  assert.match(section, /role="status"/, "the reason is shown where the user is reading");
  assert.match(section, /t\("safariNotify\.unsupported"\)/);
  assert.match(section, /t\("safariNotify\.remote"\)/);
  assert.doesNotMatch(section, /disabled=\{blocked\}/, "the page's banner switch is not gated by what the server can do");
  // The shared controls, so the row looks like every other settings row.
  assert.match(section, /<ConfigSwitch/);
  assert.match(section, /<ConfigButton/);
  assert.match(section, /t\("safariNotify\.test"\)/, "the Test row sends one notification");
});

test("the page's own banner switch is a browser preference", () => {
  assert.match(prefs, /safariNotifyOnComplete: "pi-web:safari-notify-on-complete"/);
  assert.match(client, /setPrefBool\(APP_PREF_KEYS\.safariNotifyOnComplete, enabled\)/);
  assert.match(client, /getPrefBool\(APP_PREF_KEYS\.safariNotifyOnComplete, false\)/, "off until the user switches it on");
});

test("the notification the server raises is the installation's switch, not this browser's", () => {
  // A browser pref cannot describe a notification the server raises with no page open, and
  // a phone's localStorage must not decide what the Mac shows.
  assert.match(section, /getLocalNotificationSettings\(\)/);
  assert.match(section, /setLocalNotificationEnabled\(next\)/);
  assert.match(section, /t\("safariNotify\.serverSwitch"\)/);
  assert.match(section, /t\("safariNotify\.serverHint"\)/);
  assert.match(section, /const showServerRow = server !== null && server\.supported && server\.local;/,
    "the row is shown where it can do anything, like the support probe above the other switch");
  assert.match(section, /void getLocalNotificationSettings\(\)\.then\(\(value\) => \{\s*if \(value\) setServer\(value\);/,
    "a refused write puts the switch back to what the server says");
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
  assert.doesNotMatch(send[0], /safariNotificationsEnabled\(\)/,
    "the Test button tests the server's channel, so a browser pref cannot make it silently do nothing");
  // One failure path for the whole function: no throw, no unhandled rejection, because
  // a completion notice runs inside the agent_end handler next to the sound.
  assert.match(send[0], /\} catch \{\s*return false;\s*\}/);
  assert.doesNotMatch(send[0], /throw/, "it never throws");
  assert.match(client, /if \(!response\.ok\) return \{ supported: false, local: false \};/, "the probe answers, it never rejects");
  assert.match(client, /if \(!response\.ok\) return null;/, "the settings read answers, it never rejects");
  assert.match(client, /const setLocalNotificationEnabled = |export async function setLocalNotificationEnabled[\s\S]*?\} catch \{\s*return false;/);
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
    for (const key of ["safariNotify.title", "safariNotify.switch", "safariNotify.body", "safariNotify.test", "safariNotify.testTitle", "safariNotify.testSent", "safariNotify.testFailed", "safariNotify.hint", "safariNotify.loading", "safariNotify.unsupported", "safariNotify.remote", "safariNotify.serverSwitch", "safariNotify.serverHint"]) {
      assert.ok(messages[key], `${locale} has ${key}`);
    }
  }
});
