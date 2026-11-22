import { buildNtfyRequest, readNtfySettings, type NtfySettings } from "./ntfy-settings";

/**
 * Publishing one message to the configured ntfy topic.
 *
 * The settings (and the topic, which is a shared secret) live on the server, so publishing
 * is a server job: `POST /api/notifications/ntfy` uses this for the Settings panel's
 * "Send Test Notice", and `lib/task-completion-server.ts` uses it for a finished task.
 * The second caller is why the publisher lives here and not in the route: a task that
 * finishes with every browser page closed has to reach the phone, and a page that is
 * closed cannot publish.
 */

const PUBLISH_TIMEOUT_MS = 8_000;

export type NtfyPublishStatus = "sent" | "disabled" | "invalid" | "failed";

export interface NtfyPublishResult {
  status: NtfyPublishStatus;
  sent: boolean;
  /** The message to show the user; empty for a send that worked. */
  error: string;
  /** The topic's server answered this; 0 when the request never got an answer. */
  statusCode: number;
  disabled?: boolean;
  serverUrl: string;
}

const OK: Omit<NtfyPublishResult, "status" | "error" | "statusCode" | "serverUrl"> = { sent: true };

function result(status: NtfyPublishStatus, settings: NtfySettings, error = "", statusCode = 0): NtfyPublishResult {
  return {
    status,
    sent: status === "sent",
    error,
    statusCode,
    serverUrl: settings.serverUrl,
    ...(status === "disabled" ? { disabled: true } : {}),
  };
}

/** Publish to the topic. It never throws: a notification must not break a finished task's handler. */
export async function publishNtfyMessage(
  message: { title?: unknown; body?: unknown; priority?: unknown },
  env: { settings: () => NtfySettings; fetch: typeof fetch } = { settings: readNtfySettings, fetch },
): Promise<NtfyPublishResult> {
  const settings = env.settings();
  if (!settings.enabled) return result("disabled", settings, "ntfy notification is not enabled.");
  const request = buildNtfyRequest(settings, message);
  if (!request) {
    return result("invalid", settings, "A message needs a title or a body, and a topic must be set.");
  }
  try {
    const response = await env.fetch(request.url, { ...request.init, signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS) });
    if (response.ok) return { ...OK, status: "sent", error: "", statusCode: response.status, serverUrl: settings.serverUrl };
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    return result("failed", settings, detail.trim() || `ntfy responded ${response.status}`, response.status);
  } catch (error: unknown) {
    const reason = error instanceof Error ? (error.name === "TimeoutError" ? "timed out" : error.message) : String(error);
    return result("failed", settings, `Could not reach ${settings.serverUrl}: ${reason}`);
  }
}
