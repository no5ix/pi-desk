import { NextRequest, NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { COMPARE_FAILURE_STATUS, compareFiles } from "@/lib/file-compare";

/**
 * `GET /api/files/compare?a=<absolute>&b=<absolute>` — the patch between two
 * files the user picked in the tree ("Select for Compare").
 *
 * The pair is read from disk and compared by `lib/file-compare.ts`; the answer
 * is a unified patch, which `DiffView` renders in the file panel's Diff mode.
 * Authorization is the file API's: a browsable root, resolved through links,
 * never a credential store.
 */
export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  const left = request.nextUrl.searchParams.get("a");
  const right = request.nextUrl.searchParams.get("b");
  if (!left?.trim() || !right?.trim()) {
    return NextResponse.json({ error: "a and b are both required", code: "BAD_REQUEST" }, { status: 400 });
  }
  const result = await compareFiles(left, right);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.message, code: result.code },
      { status: COMPARE_FAILURE_STATUS[result.code] },
    );
  }
  return NextResponse.json({ ok: true, patch: result.patch, identical: result.identical, a: left, b: right });
}
