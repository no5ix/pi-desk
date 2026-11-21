import { execFile } from "node:child_process";

/**
 * The macOS scripting bridge the web UI uses for the two things a browser page cannot
 * do by itself: show the native Finder folder panel, and raise a Notification Center
 * notification (app/api/cwd/pick, app/api/notifications/local).
 *
 * Route files may only export HTTP handlers, so the shared parts live here.
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
 * Run one AppleScript through /usr/bin/osascript. Resolves always — the caller decides
 * what a non-zero exit means (a cancelled panel is exit 1 with -128 on stderr).
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

/** The user dismissed an AppleScript panel (`User canceled. (-128)`). */
export function appleScriptCancelled(stderr: string): boolean {
  return stderr.includes("-128") || /user canceled/i.test(stderr);
}
