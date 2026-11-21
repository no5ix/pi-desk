// Next 16.4.6 compresses route-handler responses itself (`compress` in the
// router server, 1 KB threshold). A route handler must therefore not gzip its
// own body: `send-response` drops a handler's `Content-Encoding`,
// `Content-Length` and `Transfer-Encoding` as forwarded framing, and the
// compressor then encodes bytes it no longer sees as already encoded. The
// client decodes one layer and gets gzip bytes — the 16.4.5
// "Could not load conversations" failure (see the 16.4.4 hold, dc954bd1) in a
// new shape. This helper returns plain JSON; the server does the encoding.
const COMPRESSIBLE_THRESHOLD_BYTES = 1024;

function appendVary(headers: Headers, value: string): void {
  const current = headers.get("Vary");
  if (!current) {
    headers.set("Vary", value);
    return;
  }
  if (!current.split(",").some((entry) => entry.trim().toLowerCase() === value.toLowerCase())) {
    headers.set("Vary", `${current}, ${value}`);
  }
}

export function jsonResponse(
  request: Request,
  data: unknown,
  init: ResponseInit = {},
): Response {
  const body = JSON.stringify(data);
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  // A body under the server's threshold is never encoded, so it is not
  // content-negotiated and must not be varied on it.
  if (Buffer.byteLength(body) >= COMPRESSIBLE_THRESHOLD_BYTES) {
    appendVary(headers, "Accept-Encoding");
  }

  return new Response(body, { ...init, headers });
}
