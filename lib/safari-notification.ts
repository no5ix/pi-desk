import { APP_PREF_KEYS, getPrefBool, setPrefBool } from "./app-prefs";

/**
 * The client half of Settings › General › Safari notification.
 *
 * The switch is a per-browser preference (localStorage, like the desktop app's
 * notify-on-complete), because it describes *this* device: the same Pi server can be
 * opened from a phone over Tailscale, and that browser has nothing to do with the
 * Mac's Notification Center. app/api/notifications/local raises the notification on
 * the computer running Pi; see that route for why the server, and not the page, does it.
 */

export interface SafariNotificationSupport {
  /** The server can raise a notification (it runs on macOS). */
  supported: boolean;
  /** This page is Pi on the computer itself, so enabling it can do anything. */
  local: boolean;
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

/** True when the notification was raised. Failures are silent: a completion notice must never block or annoy. */
export async function sendSafariNotification(options: {
  title: string;
  body: string;
  silent?: boolean;
}): Promise<boolean> {
  if (!safariNotificationsEnabled()) return false;
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
