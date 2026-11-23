import { appleScriptString, runOsascript, type OsascriptResult } from "./apple-script";
import { getPiWebSettingsPath, readStored, updatePiWebSettings } from "./artifact-settings";
import { getSupportedLocales } from "./i18n/registry";

/**
 * The notification the server raises on the computer running Pi, and the setting that
 * switches it on.
 *
 * One finished task raises one notification on this computer, and this module is the whole
 * sender: it asks macOS to put a row in Notification Center through
 * `osascript … display notification`. It needs no browser at all, so it cannot be a
 * browser preference: it belongs to the installation, in Pi Web's own settings file, next
 * to ntfy's. That is also what makes it reliable — a task started from a phone over the
 * relay, or finished while every page is closed, still lands on the Mac.
 *
 * The page used to raise its own banner next to this one, behind a per-browser
 * localStorage switch (the Notification API). The same finished task arriving twice — and
 * the browser half going silent with the tab in the foreground — read as a bug, so the page
 * raises nothing for a finished run now.
 *
 * Local-only from a page: the route that exposes this is guarded by `isLocalRequest()`
 * (app/api/notifications/local), so a phone on the tailnet can never make this Mac buzz.
 * The server's own announcer (lib/task-completion-server.ts) is not a page: it runs on
 * this machine by definition.
 */

export const MAX_TITLE_CHARS = 200;
export const MAX_BODY_CHARS = 2000;
const NOTIFY_TIMEOUT_MS = 10_000;

export interface LocalNotificationSettings {
  /** Raise a macOS notification when a task finishes. */
  enabled: boolean;
  /** The language of the sentence, so a server-raised notice reads like the app. */
  locale: string;
}

export const LOCAL_NOTIFICATION_DEFAULTS: LocalNotificationSettings = {
  // A Mac running Pi announces its finished tasks out of the box: the whole point of this
  // channel is that it works with no page open, and a default-off switch made the
  // "no notification at all" report the normal experience.
  enabled: true,
  locale: "en",
};

/** Control characters and newlines would break the AppleScript source. */
export function notificationText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r?\n/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/** The AppleScript that raises the notification, with the text sanitized into literals. */
export function notificationScript(options: { title: string; body: string; silent?: boolean }): string {
  const title = notificationText(options.title, MAX_TITLE_CHARS);
  const text = notificationText(options.body, MAX_BODY_CHARS);
  return `display notification ${appleScriptString(text)} with title ${appleScriptString(title)}`
    + (options.silent === true ? "" : " sound name \"Glass\"");
}

/** A non-macOS server raises nothing of its own, whatever the switch says. */
export function macNotificationsSupported(): boolean {
  return process.platform === "darwin";
}

/** `notificationScript` + `runOsascript`; false when the platform cannot, or osascript failed. */
export async function raiseMacNotification(
  options: { title: string; body: string; silent?: boolean },
  env: {
    run: (script: string, timeoutMs?: number) => Promise<OsascriptResult>;
    supported: () => boolean;
  } = { run: runOsascript, supported: macNotificationsSupported },
): Promise<boolean> {
  if (!env.supported()) return false;
  const title = notificationText(options.title, MAX_TITLE_CHARS);
  const text = notificationText(options.body, MAX_BODY_CHARS);
  if (!title && !text) return false;
  const result = await env.run(notificationScript({ title, body: text, silent: options.silent }), NOTIFY_TIMEOUT_MS);
  return result.code === 0;
}

export function readLocalNotificationSettings(settingsPath = getPiWebSettingsPath()): LocalNotificationSettings {
  let stored: Record<string, unknown> = {};
  try {
    stored = readStored(settingsPath);
  } catch {
    return { ...LOCAL_NOTIFICATION_DEFAULTS };
  }
  const record = (stored.localNotification && typeof stored.localNotification === "object" && !Array.isArray(stored.localNotification)
    ? stored.localNotification
    : {}) as Record<string, unknown>;
  const locale = typeof record.locale === "string" && getSupportedLocales().includes(record.locale)
    ? record.locale
    : LOCAL_NOTIFICATION_DEFAULTS.locale;
  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : LOCAL_NOTIFICATION_DEFAULTS.enabled,
    locale,
  };
}

export function writeLocalNotificationSettings(
  patch: Partial<LocalNotificationSettings>,
  settingsPath = getPiWebSettingsPath(),
): LocalNotificationSettings {
  const current = readLocalNotificationSettings(settingsPath);
  const locale = patch.locale !== undefined && getSupportedLocales().includes(patch.locale)
    ? patch.locale
    : (patch.locale === undefined ? current.locale : LOCAL_NOTIFICATION_DEFAULTS.locale);
  const next: LocalNotificationSettings = { ...current, ...patch, locale };
  updatePiWebSettings({ localNotification: next }, settingsPath);
  return readLocalNotificationSettings(settingsPath);
}
