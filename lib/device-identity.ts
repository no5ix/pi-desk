"use client";

// Fork-owned: who this device is, for the composer's per-device copies.
//
// The composer keeps one copy of its content per device (`lib/composer-copy-store.ts`),
// and a copy needs a name the user recognises: `mac-content-copy`,
// `iphone-content-copy`, `ipad-content-copy`. The label comes from the browser's
// own description of itself, and the id is this browser's — minted once and kept
// in localStorage, because two browsers on the same Mac are two devices, and the
// id is what tells the copies apart when both say "mac".
//
// The label is a slug, never a path, host or user name. It is shown in a row.

import { APP_PREF_KEYS, getPrefJson, setPrefJson } from "./app-prefs";
import type { ComposerBrowser, ComposerDeviceKind } from "./composer-copy-store";

export type { ComposerBrowser, ComposerDeviceKind };

export interface DeviceIdentity {
  /** Stable per browser install. The store's second key segment. */
  id: string;
  /** `mac`, `iphone`, `ipad`, `windows`, … The slug the copy is named after. */
  label: string;
  kind: ComposerDeviceKind;
  /** `safari`, `chrome`, … The mark the copy's row wears. */
  browser: ComposerBrowser;
  /** The token the store handed this device for one composer. */
  tokenFor: (composerKey: string) => string | null;
  /** Remembered from a write's answer, and sent with every later write and delete. */
  rememberToken: (composerKey: string, token: string) => void;
}

interface StoredIdentity {
  id: string;
  tokens: Record<string, string>;
}

const MAX_TOKEN_ENTRIES = 40;

interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  /** Chrome's user-agent data; Safari has none, so iOS detection falls back to the UA. */
  mobile?: boolean;
  uaMobile?: boolean;
}

/**
 * A slug and a kind from what the browser reports.
 *
 * Order matters: an iPad on iPadOS 13+ asks for the desktop site and its UA says
 * "Macintosh", so the touch points decide before the platform name does. An
 * Android tablet says Android without "Mobile".
 */
export function detectDevice(info: NavigatorLike): { label: string; kind: ComposerDeviceKind } {
  const userAgent = info.userAgent ?? "";
  const platform = info.platform ?? "";
  const touches = (info.maxTouchPoints ?? 0) > 0;
  if (/\biPhone\b|\biPod\b/i.test(userAgent)) return { label: "iphone", kind: "phone" };
  if (/\biPad\b/i.test(userAgent)) return { label: "ipad", kind: "tablet" };
  if (/MacIntel/i.test(platform) && touches) return { label: "ipad", kind: "tablet" };
  if (/\bAndroid\b/i.test(userAgent)) {
    return /\bMobile\b/i.test(userAgent)
      ? { label: "android-phone", kind: "phone" }
      : { label: "android-tablet", kind: "tablet" };
  }
  if (/\bMacintosh\b|\bMac OS X\b/i.test(userAgent) || /Mac/i.test(platform)) return { label: "mac", kind: "desktop" };
  if (/\bWindows\b/i.test(userAgent) || /Win32/i.test(platform)) return { label: "windows", kind: "desktop" };
  if (/\bCrOS\b/i.test(userAgent)) return { label: "chromebook", kind: "desktop" };
  if (/\bLinux\b|\bX11\b/i.test(userAgent) || /Linux/i.test(platform)) return { label: "linux", kind: "desktop" };
  if ((info.uaMobile ?? info.mobile) === true) return { label: "phone", kind: "phone" };
  if (touches) return { label: "tablet", kind: "tablet" };
  return { label: "device", kind: "other" };
}

/**
 * The browser this copy was typed in, from what the UA reports.
 *
 * Order is the whole trick: every Chromium fork ends its UA with
 * `Chrome/… Safari/537.36`, so the brand-specific tokens decide first and plain
 * `Safari/` is asked last. A browser we have no mark for (Vivaldi, the DuckDuckGo
 * app, an Android WebView) is `other`, and its row falls back to the device
 * glyph: a computer is honest, a wrong brand is not.
 *
 * The desktop app is a WKWebView/WebView2 shell, so its UA *is* the system
 * browser's — a copy written in the app wears the same mark as one written in
 * Safari, which is what the user sees when they open the same site in Safari.
 */
export function detectBrowser(info: NavigatorLike): ComposerBrowser {
  const userAgent = info.userAgent ?? "";
  if (/\bEdg(A|iOS)?\b|\bEdge\//i.test(userAgent)) return "edge";
  if (/\bOPR\/|\bOPiOS\/|\bOpera\b/i.test(userAgent)) return "opera";
  if (/\bFirefox\/|\bFxiOS\//i.test(userAgent)) return "firefox";
  if (/\bVivaldi\//i.test(userAgent)) return "other";
  // No leading word boundary: a headless Chromium says "HeadlessChrome/", and it
  // is Chromium — the `Safari/537.36` that ends every Blink UA is not Safari.
  if (/Chrome\/|CriOS\//i.test(userAgent)) return "chrome";
  if (/\bVersion\/\d|\bSafari\//i.test(userAgent)) return "safari";
  return "other";
}

/** Brand names stay brand names in every locale: zh-CN writes "Safari". */
const BROWSER_NAMES: Record<ComposerBrowser, string> = {
  safari: "Safari",
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  opera: "Opera",
  other: "browser",
};

/** The browser's name, for a row's tooltip and its accessible name. */
export function browserDisplayName(browser: ComposerBrowser | null | undefined): string {
  return BROWSER_NAMES[browser ?? "other"] ?? BROWSER_NAMES.other;
}

/** The name the user reads on a row's tooltip: `mac-content-copy`. */
export function deviceCopyName(label: string, deviceId: string): string {
  const name = `${label || "device"}-content-copy`;
  const suffix = deviceId.slice(0, 6).replace(/[^a-z0-9]/gi, "").toLowerCase();
  return suffix ? `${name} (${suffix})` : name;
}

/** Name the copies a screen shows, keeping the plain name for the first device of
 *  a kind: two Macs are two devices, and `mac-content-copy` is only unambiguous
 *  once. */
export function deviceCopyNames(copies: { label: string; deviceId: string }[]): string[] {
  const firstOfLabel = new Map<string, string>();
  for (const copy of copies) {
    if (!firstOfLabel.has(copy.label)) firstOfLabel.set(copy.label, copy.deviceId);
  }
  return copies.map((copy) => (
    firstOfLabel.get(copy.label) === copy.deviceId
      ? `${copy.label || "device"}-content-copy`
      : deviceCopyName(copy.label, copy.deviceId)
  ));
}

function newDeviceId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  // The store's device id pattern: 6..64 of [A-Za-z0-9_-].
  return `device-${random}`.slice(0, 64);
}

function readStoredIdentity(): StoredIdentity | null {
  if (typeof window === "undefined") return null;
  const stored = getPrefJson<StoredIdentity>(APP_PREF_KEYS.deviceCopyIdentity);
  if (!stored || typeof stored !== "object" || typeof stored.id !== "string") return null;
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(stored.id)) return null;
  return { id: stored.id, tokens: stored.tokens && typeof stored.tokens === "object" ? stored.tokens : {} };
}

let identity: (StoredIdentity & { label: string; kind: ComposerDeviceKind; browser: ComposerBrowser }) | null = null;

function ensureIdentity() {
  if (identity) return identity;
  const stored = readStoredIdentity();
  const device = detectDevice(typeof navigator === "undefined"
    ? {}
    : {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      uaMobile: (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile,
    });
  const browser = detectBrowser(typeof navigator === "undefined" ? {} : { userAgent: navigator.userAgent });
  identity = { id: stored?.id ?? newDeviceId(), tokens: stored?.tokens ?? {}, ...device, browser };
  if (!stored) persistIdentity();
  return identity;
}

function persistIdentity(): void {
  if (typeof window === "undefined" || !identity) return;
  const entries = Object.entries(identity.tokens);
  const trimmed = entries.length > MAX_TOKEN_ENTRIES
    ? Object.fromEntries(entries.slice(entries.length - MAX_TOKEN_ENTRIES))
    : Object.fromEntries(entries);
  setPrefJson(APP_PREF_KEYS.deviceCopyIdentity, { id: identity.id, tokens: trimmed });
}

/** This device: a stable id, a slug for the copy's name, its browser, and its write tokens. */
export function getDeviceIdentity(): DeviceIdentity {
  const self = ensureIdentity();
  return {
    id: self.id,
    label: self.label,
    kind: self.kind,
    browser: self.browser,
    tokenFor: (composerKey) => self.tokens[composerKey] ?? null,
    rememberToken: (composerKey, token) => {
      if (self.tokens[composerKey] === token) return;
      self.tokens[composerKey] = token;
      persistIdentity();
    },
  };
}

/** Test seam: forget this browser's device id and tokens. */
export function resetDeviceIdentity(): void {
  identity = null;
}
