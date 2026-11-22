import { getPiWebSettingsPath, readStored, updatePiWebSettings } from "./artifact-settings";

/**
 * Settings › General › ntfy notification: publish the end of a task to an ntfy topic, so
 * the phone (ntfy app, web UI, a desktop notifier) learns about a finished run without
 * Pi running a push service of its own.
 *
 * The settings live in Pi Web's own file (`~/.pi/agent/pi-web/settings.json`, see
 * lib/artifact-settings.ts) rather than in localStorage: the topic belongs to this
 * installation, and the sender is the browser, so every device that opens Pi publishes
 * to the topic the user configured. pi's `settings.json` is left alone — the pi CLI
 * reads that file and has no ntfy.
 *
 * A topic is a shared secret in practice: anyone who knows `server/topic` can publish to
 * it and read it. That is why the route masks the topic for a page that is not Pi on
 * this computer (app/api/notifications/ntfy).
 */

export const NTFY_DEFAULT_SERVER_URL = "https://ntfy.sh";

export interface NtfySettings {
  enabled: boolean;
  /** Normalized base URL, no trailing slash: `https://ntfy.sh`. */
  serverUrl: string;
  /** Empty means "configured, but no topic yet". */
  topic: string;
}

export const NTFY_DEFAULT_SETTINGS: NtfySettings = {
  enabled: false,
  serverUrl: NTFY_DEFAULT_SERVER_URL,
  topic: "",
};

/** ntfy's own topic grammar (docs: alphanumeric, `-`, `_`, `.`, up to 64 characters). */
const TOPIC_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** One line, no control characters: ntfy headers and the message body are both flat. */
export function ntfyText(value: unknown, maxChars: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r?\n/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/**
 * A header value the HTTP layer can carry.
 *
 * A header value is a ByteString — one byte per character — so a title with an em dash
 * (`Pi Agent Desktop — test`) or a Chinese session name throws
 * `Cannot convert argument to a ByteString …` before the request is sent. Expressing the
 * UTF-8 bytes as latin-1 characters puts exactly those bytes on the wire, and ntfy decodes
 * header values as UTF-8, so the title arrives as written.
 */
export function ntfyHeaderValue(value: string): string {
  // A long non-ASCII title can outgrow the header budget, and cutting bytes would split a
  // character: shorten by characters until the bytes fit.
  let text = value;
  for (;;) {
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length <= 1000) return bytes.toString("latin1");
    const shorter = text.slice(0, Math.max(1, Math.ceil(text.length / 2)));
    if (shorter === text) return "";
    text = shorter;
  }
}

/**
 * Normalize the `Server url`. An empty value is the default; a self-hosted server under
 * a path (`https://ntfy.example.com/ntfy`) keeps its path. Rejects anything a browser
 * would let a settings field turn into: another scheme, credentials in the URL, a query.
 */
export function normalizeNtfyServerUrl(value: unknown): string | null {
  if (value === undefined || value === null) return NTFY_DEFAULT_SERVER_URL;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return NTFY_DEFAULT_SERVER_URL;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") {
    // Allowed: a local ntfy server is the common self-hosted setup.
    if (url.protocol !== "http:") return null;
  }
  return url.toString().replace(/\/+$/, "");
}

/** Normalize a topic; null when it cannot be one. */
export function normalizeNtfyTopic(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const topic = value.trim();
  if (!topic) return "";
  return TOPIC_PATTERN.test(topic) ? topic : null;
}

/** `https://ntfy.sh` + `pi` → `https://ntfy.sh/pi`. Null when the pair cannot publish. */
export function ntfyPublishUrl(serverUrl: string, topic: string): string | null {
  const server = normalizeNtfyServerUrl(serverUrl);
  const normalizedTopic = normalizeNtfyTopic(topic);
  if (!server || !normalizedTopic) return null;
  return `${server}/${normalizedTopic}`;
}

/** Validate a `PUT /api/notifications/ntfy` body into a settings patch. */
export function parseNtfyUpdate(body: unknown): { ok: true; patch: Partial<NtfySettings> } | { ok: false; error: string } {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const patch: Partial<NtfySettings> = {};
  if (record.enabled !== undefined) {
    if (typeof record.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
    patch.enabled = record.enabled;
  }
  if (record.serverUrl !== undefined) {
    const serverUrl = normalizeNtfyServerUrl(record.serverUrl);
    if (!serverUrl) return { ok: false, error: "serverUrl must be an http(s) URL such as https://ntfy.sh" };
    patch.serverUrl = serverUrl;
  }
  if (record.topic !== undefined) {
    const topic = normalizeNtfyTopic(record.topic);
    if (topic === null) return { ok: false, error: "topic may only use letters, digits, dot, dash and underscore (up to 64 characters)" };
    patch.topic = topic;
  }
  if (patch.enabled === true && !(patch.topic ?? "").trim()) {
    // Enabling with no topic is a switch that can never fire: say so at the write.
    return { ok: false, error: "set a topic before enabling ntfy" };
  }
  return { ok: true, patch };
}

export function readNtfySettings(settingsPath = getPiWebSettingsPath()): NtfySettings {
  let stored: Record<string, unknown> = {};
  try {
    stored = readStored(settingsPath);
  } catch {
    // An unreadable Pi Web file must not look like "ntfy is off and has no topic": the
    // route reports the read failure, and the defaults keep the panel usable.
    return { ...NTFY_DEFAULT_SETTINGS };
  }
  const stored_ = stored.ntfy;
  const record = (stored_ && typeof stored_ === "object" && !Array.isArray(stored_) ? stored_ : {}) as Record<string, unknown>;
  const serverUrl = normalizeNtfyServerUrl(record.serverUrl) ?? NTFY_DEFAULT_SERVER_URL;
  const topic = normalizeNtfyTopic(record.topic) ?? "";
  return {
    enabled: record.enabled === true && Boolean(topic),
    serverUrl,
    topic,
  };
}

export function writeNtfySettings(
  patch: Partial<NtfySettings>,
  settingsPath = getPiWebSettingsPath(),
): NtfySettings {
  const current = readNtfySettings(settingsPath);
  const next: NtfySettings = { ...current, ...patch };
  updatePiWebSettings({ ntfy: next }, settingsPath);
  return readNtfySettings(settingsPath);
}

/** What to send to the topic: the publish URL and the fetch init, ready for `fetch`. */
export function buildNtfyRequest(
  settings: NtfySettings,
  message: { title?: unknown; body?: unknown; priority?: unknown },
): { url: string; init: RequestInit } | null {
  const url = ntfyPublishUrl(settings.serverUrl, settings.topic);
  if (!url) return null;
  const title = ntfyText(message.title, 200);
  const body = ntfyText(message.body, 4000);
  if (!title && !body) return null;
  // ntfy reads the title from a header; the message is the body and nothing else. The
  // session name is the title, so it is never pasted into the message too: a phone shows
  // the title as the heading and the message as its content, and repeating the name made
  // the content read as the name three times around the sentence the user asked for.
  // A session name may be non-ASCII, and ntfy decodes header values as UTF-8.
  const priority = typeof message.priority === "number" && message.priority >= 1 && message.priority <= 5
    ? String(message.priority)
    : "3";
  return {
    url,
    init: {
      method: "POST",
      headers: {
        // Header values go through the ByteString encoder: the title is the session's name
        // and is routinely non-ASCII. See ntfyHeaderValue.
        ...(title ? { Title: ntfyHeaderValue(title) } : {}),
        Priority: priority,
        Tags: "pi",
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: body || title,
      cache: "no-store",
    },
  };
}
