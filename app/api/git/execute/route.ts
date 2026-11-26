import { NextResponse } from "next/server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { GitCommandFailure, isGitCommand, listGitCommands, runGitCommand } from "@/lib/git/commands";
import { BranchShiftErrorCode } from "@/lib/git/errors";
import { isWindowsAbsolutePath } from "@/lib/file-access";

/**
 * The Git panel's request endpoint — the replacement for Branchshift's VS Code
 * postMessage bridge.
 *
 * The body carries the same shape the webview sent the extension host
 * (`{ command, params, repoId }`) plus the project `cwd` the panel is showing.
 * `command` is checked against the command table before anything runs, so this
 * route is not a general command runner: no argv, no shell string and no
 * repository path comes from the browser. The repository is resolved from the
 * cwd (lib/git/workspace.ts), and a `repoId` is honoured only when discovery
 * reached it from that cwd.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request) || !hasJsonContentType(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }
    body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = (body ?? {}) as Record<string, unknown>;
  const cwd = typeof input.cwd === "string" ? input.cwd.trim() : "";
  const command = typeof input.command === "string" ? input.command : "";
  const repoId = typeof input.repoId === "string" ? input.repoId : null;
  const params = input.params && typeof input.params === "object" && !Array.isArray(input.params)
    ? input.params as Record<string, unknown>
    : {};

  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }
  if (!isGitCommand(command)) {
    return NextResponse.json({
      error: {
        code: BranchShiftErrorCode.UNKNOWN,
        message: `Unknown Git command "${command}".`,
      },
      commands: listGitCommands(),
    }, { status: 400 });
  }

  try {
    const data = await runGitCommand({ cwd, repoId, command, params });
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const failure = error instanceof GitCommandFailure
      ? error
      : new GitCommandFailure(
        BranchShiftErrorCode.UNKNOWN,
        error instanceof Error ? error.message : String(error),
      );
    return NextResponse.json({
      ok: false,
      error: { code: failure.code, message: failure.message, recovery: failure.recovery },
    }, { status: failure.code === BranchShiftErrorCode.UNKNOWN ? 500 : 400 });
  }
}
