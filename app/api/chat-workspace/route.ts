import { NextResponse } from "next/server";
import { ensureChatWorkspace } from "@/lib/chat-workspace";
import { allowFileRoot } from "@/lib/file-access";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** The hidden cwd used by non-project chats, created on demand. */
export async function GET() {
  try {
    const cwd = await ensureChatWorkspace();
    allowFileRoot(cwd);
    return NextResponse.json(
      { cwd },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
