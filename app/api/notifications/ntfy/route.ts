import { NextResponse } from "next/server";

import { buildNtfyRequest, parseNtfyUpdate, readNtfySettings, writeNtfySettings } from "@/lib/ntfy-settings";
import { isLocalRequest } from "@/lib/remote-access";

/**
 * GET  /api/notifications/ntfy                       → the ntfy settings
 * PUT  /api/notifications/ntfy  { enabled, serverUrl, topic }
 * POST /api/notifications/ntfy  { title, body, priority? }  → publish one message
 *
 * Settings › General › ntfy notification. The title of a published message is the
 * session's name and its body is the run's length and clock times, e.g. "The task lasted
 * 0h18m13s, started at 10:04:34, and ended at 10:22:47. This notification pops up at
 * 10:22:47." Publishing happens here, not in the page, because the settings (and the
 * topic secret) are the installation's: any device that opens Pi can report a finished
 * task to the same topic.
 *
 * A topic is a shared secret — knowing `server/topic` lets a client read and write that
 * channel — so a page that is not Pi on this computer gets the topic masked, and only a
 * local page may change it (isLocalRequest covers the relay mark, Tailscale logins,
 * Funnel and any non-loopback Host, per AGENTS.md). Publishing is open to every
 * authorized app caller: it sends to the user's own topic and reads nothing.
 */

export const dynamic = "force-dynamic";

const PUBLISH_TIMEOUT_MS = 8_000;
const MASKED_TOPIC = "••••••";

export async function GET(req: Request) {
  const settings = readNtfySettings();
  const local = isLocalRequest(req);
  if (local) return NextResponse.json({ ...settings, local });
  return NextResponse.json({
    enabled: settings.enabled,
    serverUrl: settings.serverUrl,
    topic: settings.topic ? MASKED_TOPIC : "",
    topicConfigured: Boolean(settings.topic),
    local,
  });
}

export async function PUT(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json(
      { error: "ntfy settings can only be changed on the computer running Pi." },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = parseNtfyUpdate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const settings = writeNtfySettings(parsed.patch);
    return NextResponse.json({ ...settings, local: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const settings = readNtfySettings();
  if (!settings.enabled) {
    return NextResponse.json({ error: "ntfy notification is not enabled.", disabled: true }, { status: 409 });
  }
  const body = await req.json().catch(() => ({})) as { title?: unknown; body?: unknown; priority?: unknown };
  const request = buildNtfyRequest(settings, body);
  if (!request) {
    return NextResponse.json(
      { error: "A message needs a title or a body, and a topic must be set." },
      { status: 400 },
    );
  }
  try {
    const response = await fetch(request.url, { ...request.init, signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      return NextResponse.json(
        { error: detail.trim() || `ntfy responded ${response.status}` },
        { status: 502 },
      );
    }
    return NextResponse.json({ sent: true });
  } catch (error: unknown) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : String(error);
    return NextResponse.json({ error: `Could not reach ${settings.serverUrl}: ${reason}` }, { status: 502 });
  }
}
