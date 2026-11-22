import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "./app-prefs";

/**
 * The client half of Settings › General › Local browser notification.
 *
 * Two switches, because a finished task is raised by two senders that cannot see each
 * other, and each one belongs to somebody else:
 *
 *  - **This browser's banner** (`safariNotifyOnComplete`, localStorage, default off). Only
 *    a page can put a banner in the browser you are looking at, so only this browser can
 *    switch it; lib/task-completion-notice.ts asks it, and it needs the browser's own
 *    notification permission.
 *  - **The computer running Pi** (a server setting, app/api/notifications/local →
 *    lib/local-notification.ts). The notification in Notification Center is raised by
 *    `osascript` in the server's own process, with no browser involved, so it cannot be a
 *    browser preference: a phone opening Pi over Tailscale must not decide what the Mac
 *    shows, and the server announces a run that finished with every page closed.
 *
 * `app/api/notifications/local` is local-only (isLocalRequest), so a remote page gets
 * `local: false` and its switches are disabled instead of silently doing nothing.
 */

export interface SafariNotificationSupport {
  /** The server can raise a notification (it runs on macOS). */
  supported: boolean;
  /** This page is Pi on the computer itself, so enabling it can do anything. */
  local: boolean;
}

export interface LocalNotificationSettings extends SafariNotificationSupport {
  /** The server's own switch: raise a notification when a task finishes on this computer. */
  enabled: boolean;
  /** The language the server's sentence is in — the app language of the page that set it. */
  locale: string;
}

export function safariNotificationsEnabled(): boolean {
  return getPrefBool(APP_PREF_KEYS.safariNotifyOnComplete, false);
}

export function setSafariNotificationsEnabled(enabled: boolean): void {
  setPrefBool(APP_PREF_KEYS.safariNotifyOnComplete, enabled);
}

export async function getSafariNotificationSupport(): Promise<SafariNotificationSupport> {
  try {
    const response = await fetch("/api/notifications/local", { cache: "no-store" });
    if (!response.ok) return { supported: false, local: false };
    const data = await response.json().catch(() => ({})) as { supported?: unknown; local?: unknown };
    return { supported: data.supported === true, local: data.local === true };
  } catch {
    return { supported: false, local: false };
  }
}

/** The server's switch and its language, or null when this server cannot answer. */
export async function getLocalNotificationSettings(): Promise<LocalNotificationSettings | null> {
  try {
    const response = await fetch("/api/notifications/local", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    return {
      supported: data.supported === true,
      local: data.local === true,
      enabled: data.enabled === true,
      locale: typeof data.locale === "string" ? data.locale : "en",
    };
  } catch {
    return null;
  }
}

/** Write the server's switch. Only a page on the computer running Pi is accepted. */
export async function setLocalNotificationEnabled(enabled: boolean): Promise<boolean> {
  try {
    const response = await fetch("/api/notifications/local", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({})) as { enabled?: unknown };
    return data.enabled === enabled;
  } catch {
    return false;
  }
}

/**
 * Ask the server on this Mac to raise one notification now — the Settings panel's "Test"
 * button. True when the notification was raised.
 *
 * It is not gated by the browser's switch: this is the server's channel, and a test that
 * quietly did nothing because a localStorage key was off was the old "no notification
 * anywhere and no way to find out why".
 */
export async function sendLocalNotificationTest(options: {
  title: string;
  body: string;
  silent?: boolean;
}): Promise<boolean> {
  try {
    const response = await fetch("/api/notifications/local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    return response.ok;
  } catch {
    return false;
  }
}
