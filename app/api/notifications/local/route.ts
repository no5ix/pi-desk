import { NextResponse } from "next/server";

import { appleScriptString, runOsascript } from "@/lib/apple-script";
import { isLocalRequest } from "@/lib/remote-access";

/**
 * POST /api/notifications/local  body: { title, body, silent? }   → { sent: true }
 * GET  /api/notifications/local                                   → { supported, local }
 *
 * A local macOS notification, switched on in Settings › General › Safari notification:
 * when a task finishes, the title is the session's name and the body is its length and
 * clock times ("The task lasted 0h18m13s, started at 10:04:34, and ended at 10:22:47.
 * This notification pops up at 10:22:47.").
 *
 * A plain Safari tab cannot raise a system notification: the Notification constructor is
 * not implemented there, and `ServiceWorkerRegistration.showNotification()` only works in
 * a Safari web app installed with File ▸ Add to Dock (macOS 14+/Safari 17+). Pi's server
 * runs on the same Mac as the browser, so the server raises the notification with
 * `osascript … display notification`: no install, no push service, no VAPID keys. It is
 * attributed to the process that owns the server (Terminal, or Pi Agent Desktop) rather
 * than to Safari, and the settings row says so.
 *
 * Local-only: isLocalRequest() covers the relay mark, Tailscale logins, Funnel and any
 * non-loopback Host, so a phone can never make this Mac show notifications.
 */

export const dynamic = "force-dynamic";

const NOTIFY_TIMEOUT_MS = 10_000;
const MAX_TITLE_CHARS = 200;
const MAX_BODY_CHARS = 2000;

/** Control characters and newlines would break the AppleScript source. */
function notificationText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r?\n/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export async function GET(req: Request) {
  // The settings row states the truth instead of guessing: a non-macOS server and a page
  // opened from another machine (Tailscale, the relay) can raise no notification.
  return NextResponse.json({
    supported: process.platform === "darwin",
    local: isLocalRequest(req),
  });
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json(
      { error: "Local notifications are only available on the computer running Pi." },
      { status: 403 },
    );
  }
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "Local notifications are only available on macOS." },
      { status: 501 },
    );
  }

  const body = await req.json().catch(() => ({})) as { title?: unknown; body?: unknown; silent?: unknown };
  const title = notificationText(body.title, MAX_TITLE_CHARS);
  const text = notificationText(body.body, MAX_BODY_CHARS);
  if (!title && !text) {
    return NextResponse.json({ error: "title or body is required" }, { status: 400 });
  }

  const script = `display notification ${appleScriptString(text)} with title ${appleScriptString(title)}`
    + (body.silent === true ? "" : " sound name \"Glass\"");

  const result = await runOsascript(script, NOTIFY_TIMEOUT_MS);
  if (result.code !== 0) {
    return NextResponse.json(
      { error: result.stderr.trim() || `osascript exited ${result.code}` },
      { status: 500 },
    );
  }
  return NextResponse.json({ sent: true });
}
