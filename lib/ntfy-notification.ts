/**
 * The client half of Settings › General › ntfy notification.
 *
 * The switch is not stored in the browser: the settings, including the topic, live on
 * the server (lib/ntfy-settings.ts), so the panel reads them and a completion send is a
 * plain POST the server answers 409 for when the switch is off. Failures are silent in
 * the completion path — a notification must never break a finished task's handler.
 */
import { errorMessage } from "./errors.ts";

export interface NtfySettingsClient {
  enabled: boolean;
  serverUrl: string;
  topic: string;
  /** True when this page is Pi on the computer itself, so the fields are editable. */
  local: boolean;
  topicConfigured?: boolean;
}

export async function getNtfySettings(): Promise<NtfySettingsClient | null> {
  try {
    const response = await fetch("/api/notifications/ntfy", { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null) as NtfySettingsClient | null;
    return data && typeof data.serverUrl === "string" ? data : null;
  } catch {
    return null;
  }
}

export async function saveNtfySettings(patch: Partial<NtfySettingsClient>): Promise<NtfySettingsClient | { error: string }> {
  try {
    const response = await fetch("/api/notifications/ntfy", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await response.json().catch(() => null) as NtfySettingsClient | { error?: string } | null;
    if (!response.ok) {
      const error = data && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `ntfy settings were refused (${response.status})`;
      return { error };
    }
    return data as NtfySettingsClient;
  } catch (error: unknown) {
    return { error: errorMessage(error) };
  }
}

/** Whether the message reached the topic, with the server's reason when it did not. */
export async function sendNtfyNotification(options: {
  title: string;
  body: string;
  priority?: number;
}): Promise<{ sent: boolean; error?: string }> {
  try {
    const response = await fetch("/api/notifications/ntfy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (response.ok) return { sent: true };
    const data = await response.json().catch(() => null) as { error?: unknown } | null;
    return { sent: false, error: typeof data?.error === "string" ? data.error : `ntfy responded ${response.status}` };
  } catch (error: unknown) {
    return { sent: false, error: errorMessage(error) };
  }
}
