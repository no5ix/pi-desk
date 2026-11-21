import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { jsonResponse } = await jiti.import("./json-response.ts");

test("does not gzip a large JSON response when the client disables gzip", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip;q=0, br" } }),
    { value: "large payload ".repeat(200) },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Accept-Encoding(?:\s*,|$)/i);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("does not gzip when the gzip quality value is invalid", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip;q=invalid, *;q=1" } }),
    { value: "large payload ".repeat(200) },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.equal((await response.json()).value, "large payload ".repeat(200));
});

test("leaves small JSON responses uncompressed", async () => {
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }),
    { ok: true },
  );

  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.deepEqual(await response.json(), { ok: true });
});

test("encodes nothing itself, so the server's compression is the only layer", async () => {
  const payload = { sessions: Array.from({ length: 60 }, (_, index) => ({ id: `s${index}`, title: "a session title long enough to compress" })) };
  const response = jsonResponse(
    new Request("http://localhost/test", { headers: { "Accept-Encoding": "gzip" } }),
    payload,
  );

  // Next 16.4.6 gzips route-handler responses and drops a handler's
  // `Content-Encoding` as forwarded framing. Gzipping here produced gzip bytes
  // behind one `Content-Encoding: gzip`, and the sidebar read them as JSON.
  assert.equal(response.headers.get("Content-Encoding"), null);
  assert.match(response.headers.get("Vary") ?? "", /(?:^|,\s*)Accept-Encoding(?:\s*,|$)/i);
  assert.deepEqual(await response.json(), payload);
});

