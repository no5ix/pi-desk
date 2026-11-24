import { NextResponse } from "next/server";
import {
  clearComposerDraft,
  composerSyncKey,
  readComposerDraft,
  writeComposerDraft,
} from "@/lib/composer-draft-store";

// Fork-owned: the composer draft a device is editing, as the server's copy.
//
// A prompt typed in the composer on one device shows up in the same composer on
// another (lib/composer-draft-store.ts explains the keys and the ordering). The
// route is reachable from any client the app already serves — the web password
// in proxy.ts is the gate, exactly as for the session APIs — and it holds only
// what a composer holds: the text, the attached images the composer already
// carries as data, and the attached text files.

/** One composer's worth, and one key. Anything bigger is a client bug. */
const MAX_BODY_CHARS = 6_000_000;
const MAX_KEY_CHARS = 1024;

function keyFrom(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("key");
  if (!raw || raw.length > MAX_KEY_CHARS) return null;
  return composerSyncKey(raw);
}

export async function GET(request: Request) {
  const key = keyFrom(new URL(request.url).searchParams);
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  return NextResponse.json({ draft: readComposerDraft(key) });
}

export async function PUT(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Draft is too large to sync." }, { status: 413 });
  }
  let body: { key?: unknown; value?: unknown; images?: unknown; files?: unknown; updatedAt?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = typeof body.key === "string" && body.key.length <= MAX_KEY_CHARS ? composerSyncKey(body.key) : null;
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const result = writeComposerDraft(key, body);
  if (!result.ok) {
    // The client's write lost to a newer one; hand back the copy it is behind so
    // it can decide to take it (lib/composer-sync.ts keeps a newer local edit).
    return NextResponse.json({ error: result.error, draft: result.draft ?? readComposerDraft(key) }, { status: 409 });
  }
  return NextResponse.json({ ok: true, draft: result.draft });
}

export async function DELETE(request: Request) {
  const key = keyFrom(new URL(request.url).searchParams);
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  clearComposerDraft(key);
  return NextResponse.json({ ok: true });
}
