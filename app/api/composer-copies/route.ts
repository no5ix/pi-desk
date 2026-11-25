import { NextResponse } from "next/server";
import {
  composerCopyKey,
  deleteDeviceCopy,
  isDeviceId,
  MAX_DEVICE_ID_CHARS,
  MAX_LABEL_CHARS,
  readDeviceCopies,
  writeDeviceCopy,
} from "@/lib/composer-copy-store";

// Fork-owned: each device's own copy of what is in its composer.
//
// The route is reachable from any client the app already serves — the web
// password in proxy.ts is the gate, exactly as for the session APIs — and it
// holds only what a composer holds: the text, the attached images the composer
// already carries as data, and the attached text files.
//
// A caller addresses one record: `(composer, its own deviceId)`. It never names
// another device's copy, and the store refuses a write or delete whose token is
// not the one it handed to that device, so a device cannot edit or delete
// another's content even by claiming its id. `GET` answers the *other* devices'
// copies, which is what the row above the composer shows; picking one up is a
// local prepend, never a write.

/** One composer's worth, and one key. Anything bigger is a client bug. */
const MAX_BODY_CHARS = 6_000_000;
const MAX_KEY_CHARS = 1024;
/** The token is not a secret worth putting in a URL: DELETE carries it in a header. */
const TOKEN_HEADER = "x-composer-copy-token";

function keyFrom(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("key");
  if (!raw || raw.length > MAX_KEY_CHARS) return null;
  return composerCopyKey(raw);
}

function deviceIdFrom(searchParams: URLSearchParams): string | null {
  const raw = searchParams.get("deviceId");
  if (!raw || raw.length > MAX_DEVICE_ID_CHARS || !isDeviceId(raw)) return null;
  return raw;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = keyFrom(url.searchParams);
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const deviceId = url.searchParams.get("deviceId");
  const self = deviceId && deviceId.length <= MAX_DEVICE_ID_CHARS && isDeviceId(deviceId) ? deviceId : null;
  return NextResponse.json({ copies: readDeviceCopies(key, self) });
}

export async function PUT(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Draft is too large to sync." }, { status: 413 });
  }
  let body: {
    key?: unknown;
    deviceId?: unknown;
    token?: unknown;
    label?: unknown;
    kind?: unknown;
    value?: unknown;
    images?: unknown;
    files?: unknown;
    updatedAt?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const key = typeof body.key === "string" && body.key.length <= MAX_KEY_CHARS ? composerCopyKey(body.key) : null;
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  if (!isDeviceId(body.deviceId) || body.deviceId.length > MAX_DEVICE_ID_CHARS) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }
  if (typeof body.label === "string" && body.label.length > MAX_LABEL_CHARS) {
    return NextResponse.json({ error: "label is too long" }, { status: 400 });
  }
  const result = writeDeviceCopy(key, body.deviceId, body);
  if (!result.ok) {
    if (result.reason === "forbidden") {
      // A write under a device id whose token this caller does not hold. The
      // rule the design rests on: no device edits another device's copy.
      return NextResponse.json({ error: "This copy belongs to another device." }, { status: 403 });
    }
    if (result.reason === "too-large") {
      // Past what a copy may hold. The composer keeps its own content; the row
      // on the other device keeps the last copy that fitted.
      return NextResponse.json({ error: result.error, copy: result.copy }, { status: 413 });
    }
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, token: result.token, copy: result.copy });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const key = keyFrom(url.searchParams);
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  const deviceId = deviceIdFrom(url.searchParams);
  if (!deviceId) return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  const token = request.headers.get(TOKEN_HEADER);
  const result = deleteDeviceCopy(key, deviceId, token);
  if (!result.ok && result.reason === "forbidden") {
    return NextResponse.json({ error: "This copy belongs to another device." }, { status: 403 });
  }
  return NextResponse.json({ ok: result.ok });
}
