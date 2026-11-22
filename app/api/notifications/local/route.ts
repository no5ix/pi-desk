import { NextResponse } from "next/server";

import {
  macNotificationsSupported,
  notificationText,
  raiseMacNotification,
  readLocalNotificationSettings,
  writeLocalNotificationSettings,
} from "@/lib/local-notification";
import { getSupportedLocales } from "@/lib/i18n/registry";
import { isLocalRequest } from "@/lib/remote-access";

/**
 * POST /api/notifications/local  body: { title, body, silent? }   → { sent: true }
 * GET  /api/notifications/local                                   → { supported, local, enabled, locale }
 * PUT  /api/notifications/local  { enabled?, locale? }            → the settings
 *
 * The macOS notification of Settings › General › Local browser notification: when a task
 * finishes, the title is the session's name and the body is its length and clock times
 * ("The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47. This
 * notification pops up at 10:22:47.").
 *
 * A plain Safari tab cannot raise a system notification: the Notification constructor is
 * not implemented there, and `ServiceWorkerRegistration.showNotification()` only works in
 * a Safari web app installed with File ▸ Add to Dock (macOS 14+/Safari 17+). Pi's server
 * runs on the same Mac as the browser, so the server raises the notification with
 * `osascript … display notification`: no install, no push service, no VAPID keys. It is
 * attributed to the process that owns the server (Terminal, or Pi Agent Desktop) rather
 * than to Safari, and the settings row says so.
 *
 * Two senders, one switch: the page POSTs here for the run its own stream reported, and
 * `lib/task-completion-server.ts` calls `raiseMacNotification()` directly for every run
 * this process finished. The second is what makes the notice reliable — a task started
 * from a phone over the relay, or finished while every page is closed, has no page left
 * to ask. `globalThis` bookkeeping keeps the two from announcing one run twice
 * (lib/task-completion-server.ts).
 *
 * Local-only: isLocalRequest() covers the relay mark, Tailscale logins, Funnel and any
 * non-loopback Host, so a phone can never make this Mac show notifications, and only a
 * local page may change the switch. The switch is a server setting (lib/local-notification.ts)
 * and not the browser's localStorage pref: this notification is raised by the installation,
 * for the computer running it, with no page involved.
 */

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // The settings row states the truth instead of guessing: a non-macOS server and a page
  // opened from another machine (Tailscale, the relay) can raise no notification.
  const settings = readLocalNotificationSettings();
  return NextResponse.json({
    supported: macNotificationsSupported(),
    local: isLocalRequest(req),
    enabled: settings.enabled,
    locale: settings.locale,
  });
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json(
      { error: "Local notifications are only available on the computer running Pi." },
      { status: 403 },
    );
  }
  if (!macNotificationsSupported()) {
    return NextResponse.json(
      { error: "Local notifications are only available on macOS." },
      { status: 501 },
    );
  }

  const body = await req.json().catch(() => ({})) as { title?: unknown; body?: unknown; silent?: unknown };
  const title = notificationText(body.title, 200);
  const text = notificationText(body.body, 2000);
  if (!title && !text) {
    return NextResponse.json({ error: "title or body is required" }, { status: 400 });
  }

  const sent = await raiseMacNotification({ title, body: text, silent: body.silent === true });
  if (!sent) {
    return NextResponse.json({ error: "osascript refused the notification." }, { status: 500 });
  }
  return NextResponse.json({ sent: true });
}

export async function PUT(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json(
      { error: "Local notification settings can only be changed on the computer running Pi." },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null) as { enabled?: unknown; locale?: unknown } | null;
  const patch: { enabled?: boolean; locale?: string } = {};
  if (body?.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    patch.enabled = body.enabled;
  }
  if (body?.locale !== undefined) {
    if (typeof body.locale !== "string" || !getSupportedLocales().includes(body.locale)) {
      return NextResponse.json({ error: "locale must be one the app speaks" }, { status: 400 });
    }
    patch.locale = body.locale;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to change" }, { status: 400 });
  }
  const settings = writeLocalNotificationSettings(patch);
  return NextResponse.json({ ...settings, local: true });
}
