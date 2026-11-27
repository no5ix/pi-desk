import { NextResponse } from "next/server";
import type { ToolSettingsResponse } from "@/lib/api-types";
import {
  CODEMODE_INLINE_BUDGET_MAX,
  isCodemodeInlineBudget,
  isCodemodeMode,
  isCodemodePreference,
  readCodemodePreference,
  readCodemodeSettings,
  writeCodemodeInlineBudget,
  writeCodemodeMode,
  writeCodemodePreference,
} from "@/lib/codemode-settings";
import { mcpRefusalResponse } from "@/lib/mcp-entry-request";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// The only writer of the global `defaultTools` key: the PowerShell switch
// (Windows) and the Code mode choice (ADR 0006, chosen in Settings › MCP) both
// edit it, under the lock pi's SettingsManager takes on the same file. Settings
// › MCP saves the global `codemode.mode` and `codemode.inlineBudget` here too,
// under the same lock.
// Every refusal carries a `reason` code the panel translates, beside the
// English `error` it shows only as the diagnostic of an `internal` failure.

const CHANGES = ["enabled", "codemode", "codemodeMode", "codemodeInlineBudget"] as const;

function errorResponse(error: unknown) {
  return mcpRefusalResponse(500, "internal", errorMessage(error));
}

async function readToolSettings(): Promise<ToolSettingsResponse> {
  // One after the other: each takes the file lock, and a reader that finds it
  // held backs off for about a second.
  const powerShellEnabled = await readPowerShellToolEnabled();
  const codemode = await readCodemodePreference();
  const { mode: codemodeMode, inlineBudget: codemodeInlineBudget } = await readCodemodeSettings();
  return { isWindows: process.platform === "win32", powerShellEnabled, codemode, codemodeMode, codemodeInlineBudget };
}

export async function GET() {
  try {
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return mcpRefusalResponse(403, "request-denied", "Untrusted API request");
  }
  if (!hasJsonContentType(req)) {
    return mcpRefusalResponse(415, "content-type", "Content-Type must be application/json");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return mcpRefusalResponse(400, "invalid-request", "Invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return mcpRefusalResponse(400, "invalid-request", "Expected a JSON object");
  }
  const changes = body as { enabled?: unknown; codemode?: unknown; codemodeMode?: unknown; codemodeInlineBudget?: unknown };
  if (CHANGES.filter((key) => key in changes).length !== 1) {
    return mcpRefusalResponse(400, "invalid-request", "Send one of enabled (PowerShell), codemode, codemodeMode or codemodeInlineBudget");
  }

  if ("codemodeMode" in changes) {
    // "on" removes the key: it is pi's default.
    if (!isCodemodeMode(changes.codemodeMode)) {
      return mcpRefusalResponse(400, "invalid-request", "codemodeMode must be \"on\" or \"only\"");
    }
    try {
      await writeCodemodeMode(changes.codemodeMode);
      return NextResponse.json(await readToolSettings());
    } catch (error) {
      return errorResponse(error);
    }
  }

  if ("codemodeInlineBudget" in changes) {
    // null removes the key, which gives sessions pi's default.
    const budget = changes.codemodeInlineBudget;
    if (budget !== null && !isCodemodeInlineBudget(budget)) {
      return mcpRefusalResponse(400, "invalid-request", `codemodeInlineBudget must be a whole number from 0 to ${CODEMODE_INLINE_BUDGET_MAX}, or null`);
    }
    try {
      await writeCodemodeInlineBudget(budget ?? undefined);
      return NextResponse.json(await readToolSettings());
    } catch (error) {
      return errorResponse(error);
    }
  }

  if ("codemode" in changes) {
    if (!isCodemodePreference(changes.codemode)) {
      return mcpRefusalResponse(400, "invalid-request", "codemode must be \"automatic\" or \"always\"");
    }
    try {
      await writeCodemodePreference(changes.codemode);
      return NextResponse.json(await readToolSettings());
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (process.platform !== "win32") {
    return mcpRefusalResponse(404, "invalid-request", "PowerShell tool settings are only available on Windows");
  }
  if (typeof changes.enabled !== "boolean") {
    return mcpRefusalResponse(400, "invalid-request", "enabled must be a boolean");
  }
  try {
    await writePowerShellToolEnabled(changes.enabled);
    return NextResponse.json(await readToolSettings());
  } catch (error) {
    return errorResponse(error);
  }
}
