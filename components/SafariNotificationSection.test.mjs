import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// Settings › General › Safari notification: a finished task raises a local macOS
// notification whose title is the session name and whose body is the run's length and
// clock times. A plain Safari tab cannot do this, so the sender is the local server
// (app/api/notifications/local). The settings row and the sender are pinned here; the
// route's gates are in app/api/notifications/local/route.test.mjs.

const section = readFileSync(new URL("./SafariNotificationSection.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/safari-notification.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const prefs = readFileSync(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");

test("the row lives in Settings › General and states the truth about the platform", () => {
  assert.match(settings, /import \{ SafariNotificationSection \} from "\.\/SafariNotificationSection";/);
  assert.match(settings, /<SafariNotificationSection \/>/);
  assert.match(section, /className="settings-general-section safari-notification-section"/);
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

test("a finished run sends it, and a stopped run stays silent", () => {
  const handler = appShell.match(/const handleAgentEnd = useCallback[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert.ok(handler, "handleAgentEnd found");
  assert.match(handler[0], /if \(end\?\.aborted\) return;/, "a stopped run announces nothing");
  assert.match(handler[0], /if \(isHiddenRelation\(selectedSession\?\.relation\)\) return;/);
  assert.match(handler[0], /if \(end\?\.startedAt !== undefined && end\.endedAt !== undefined\) \{\s*void sendSafariNotification\(\{\s*title: selectedSession\?\.name \?\? translate\("i18n\.sessionComplete"\),/);
  assert.match(handler[0], /formatCompletionSummary\(\s*translate\("safariNotify\.summary"\),\s*\{ startedAt: end\.startedAt, endedAt: end\.endedAt, poppedAt: Date\.now\(\) \},\s*locale,\s*\),/);
  const sendAt = handler[0].indexOf("sendSafariNotification");
  const gateAt = handler[0].indexOf("shouldShowBrowserNotification()");
  assert.ok(sendAt >= 0 && gateAt >= 0 && sendAt < gateAt,
    "the local notice is not gated on this tab's Web Push state: it is a Notification Center notice on this Mac");
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
