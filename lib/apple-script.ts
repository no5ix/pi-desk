import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * The macOS scripting bridge the web UI uses for the two things a browser page cannot
 * do by itself: show the native folder panel (folderPanelScript below), and raise a
 * Notification Center notification (app/api/cwd/pick, app/api/notifications/local).
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

/**
 * Where a folder panel should open: the folder that holds `cwd`, so the projects beside
 * the one the user is in are visible straight away. A path from a browser is only a hint:
 * it has to resolve to a real directory, and it never reaches the answer, which is always
 * the panel's own.
 */
export function folderPanelLocation(cwd: unknown): string | undefined {
  if (typeof cwd !== "string" || !cwd.startsWith("/") || cwd.length > 4096) return undefined;
  try {
    const parent = dirname(resolve(cwd));
    return statSync(parent).isDirectory() ? parent : undefined;
  } catch {
    return undefined;
  }
}

export interface FolderPanelOptions {
  prompt: string;
  /**
   * A folder to open the panel inside — the parent of the project the sidebar has
   * selected, so a sibling project is one click away. A bad path is ignored in the
   * script itself, which falls back to the home folder.
   */
  defaultPath?: string;
}

/**
 * The AppleScript for the project folder panel, written to behave like the browser's own
 * file panel (the composer's **Add files**, which is a plain `<input type="file">`):
 * the panel is there as soon as the click lands, nothing in the Dock bounces, and the
 * page has the front again the moment the user answers.
 *
 * The obvious script — `tell application "Finder" to choose folder` — does none of that:
 * Finder is woken and activated, the desktop flashes forward, and Safari keeps the menu
 * bar only after the user clicks back into it. Running the panel from osascript itself is
 * worse in a different way: osascript is a background-only process, so its panel is not
 * the key window and the keyboard keeps typing into whatever app was open.
 *
 * So the panel is shown **by System Events** — a background agent with no Dock icon, which
 * `activate` makes the front app, giving the panel a key window and the browser-like feel
 * of the composer's Add files panel — and the app that was frontmost when the click
 * happened (Safari) is made frontmost again on both exits: the choice and the cancel.
 *
 * The frontmost-app query and the frontmost write are the two calls that need the
 * Accessibility permission for the process running osascript; both sit in `try` blocks, so
 * a machine that has not granted it still gets a working panel, just without the focus
 * hand-back. The panel command itself needs neither.
 *
 * The browser cannot do this by itself: `showDirectoryPicker()` is not in Safari (not
 * through 27.x), and a directory `<input type="file" webkitdirectory>` reports the folder's
 * *name* plus relative paths — never the absolute path Pi needs as a cwd.
 */
export function folderPanelScript({ prompt, defaultPath }: FolderPanelOptions): string {
  const lines = [
    // One handler for both exits: answering and cancelling must leave focus where it was.
    "on restoreFront(frontApp)",
    '  if frontApp is "" then return',
    '  tell application "System Events"',
    "    try",
    "      set frontmost of application process frontApp to true",
    "    end try",
    "  end tell",
    "end restoreFront",
    'set frontApp to ""',
    "try",
    '  tell application "System Events" to set frontApp to name of first application process whose frontmost is true',
    "end try",
    "set defaultLocation to (path to home folder)",
  ];
  if (defaultPath) {
    lines.push(
      "try",
      `  set defaultLocation to (POSIX file ${appleScriptString(defaultPath)}) as alias`,
      "end try",
    );
  }
  lines.push(
    "try",
    "  tell application \"System Events\"",
    "    activate",
    // The location goes **before** the prompt, in parentheses: AppleScript reads a
    // trailing `of` as its possession operator applied to the prompt string
    // (`Can’t get "Choose a project folder" of (defaultLocation)`, -1723).
    `    set chosenItem to choose folder of (defaultLocation) with prompt ${appleScriptString(prompt)}`,
    "  end tell",
    "on error number -128",
    "  restoreFront(frontApp)",
    "  error number -128",
    "end try",
    "restoreFront(frontApp)",
    "return POSIX path of chosenItem",
  );
  return lines.join("\n");
}
