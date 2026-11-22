import { execFile } from "node:child_process";

/**
 * The macOS scripting bridge for the one thing a browser page cannot do by itself: raise a
 * Notification Center notification (app/api/notifications/local, lib/safari-notification.ts).
 * Route files may only export HTTP handlers, so the shared parts live here.
 *
 * This module used to build a folder panel for "Add project" as well. Measured on a Mac:
 * showing it through Finder activates Finder (the Dock bounce, the desktop coming forward),
 * and a panel owned by a bare osascript is not the key window, so the keyboard stays in the
 * browser tab. "Add project" opens the app's own window now — components/DirectoryPicker.tsx.
 */

export interface OsascriptResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** An AppleScript string literal. Only the backslash and the quote need escaping. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

/**
 * Run one AppleScript through /usr/bin/osascript. Resolves always — the caller decides what
 * a non-zero exit means (a notification needs Accessibility, and a plain failure is a log
 * line, not a broken conversation).
 */
export function runOsascript(script: string, timeoutMs = 10_000): Promise<OsascriptResult> {
  return new Promise((resolve) => {
    execFile("/usr/bin/osascript", ["-e", script], { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 1
          : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      });
  });
}
