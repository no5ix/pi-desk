import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("@/lib/composer-copy-store.ts");
const route = await jiti.import("./route.ts");
const { clearAllComposerCopies, readDeviceCopies } = store;

const MAC = "mac-a1b2c3d4";
const PHONE = "iphone-b2c3d4e5";
/** The store expires a copy after a day, so the stamps are real times. */
const T = Date.now();

function put(body) {
  return route.PUT(new Request("http://localhost/api/composer-copies", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}
function get(key, deviceId) {
  const query = new URLSearchParams({ key });
  if (deviceId) query.set("deviceId", deviceId);
  return route.GET(new Request(`http://localhost/api/composer-copies?${query}`));
}
function del(key, deviceId, token) {
  const headers = token ? { "x-composer-copy-token": token } : undefined;
  return route.DELETE(new Request(`http://localhost/api/composer-copies?key=${encodeURIComponent(key)}&deviceId=${deviceId}`, {
    method: "DELETE",
    headers,
  }));
}

test("a device's first write is handed its token, and every later write needs it", async () => {
  clearAllComposerCopies();
  const first = await put({ key: "session:s1", deviceId: MAC, label: "mac", kind: "desktop", browser: "safari", value: "typed on the mac", images: [], files: [], updatedAt: T + 1000 });
  assert.equal(first.status, 200);
  const { token } = await first.json();
  assert.ok(typeof token === "string" && token.length > 8);
  assert.equal(readDeviceCopies("session:s1", PHONE)[0].browser, "safari", "a write carries the browser its row is marked with");

  const stolen = await put({ key: "session:s1", deviceId: MAC, label: "iphone", kind: "phone", value: "overwritten", images: [], files: [], updatedAt: T + 5000 });
  assert.equal(stolen.status, 403, "no device edits another device's copy");
  const kept = await put({ key: "session:s1", deviceId: MAC, token, label: "mac", kind: "desktop", value: "typed on the mac, longer", images: [], files: [], updatedAt: T + 6000 });
  assert.equal(kept.status, 200);
  assert.equal(readDeviceCopies("session:s1", PHONE)[0].value, "typed on the mac, longer");
});

test("GET answers the other devices' copies and never the caller's own", async () => {
  clearAllComposerCopies();
  await put({ key: "session:s2", deviceId: MAC, label: "mac", kind: "desktop", browser: "safari", value: "on the mac", images: [{ data: "AAA", mimeType: "image/png" }], files: [{ id: "f1", name: "notes.md", size: 3, text: "abc" }], updatedAt: T + 1000 });
  await put({ key: "session:s2", deviceId: PHONE, label: "iphone", kind: "phone", browser: "chrome", value: "on the iphone", images: [], files: [], updatedAt: T + 2000 });

  const onPhone = await get("session:s2", PHONE);
  const phoneView = (await onPhone.json()).copies;
  assert.deepEqual(phoneView.map((copy) => [copy.label, copy.kind]), [["mac", "desktop"]]);
  assert.equal(phoneView[0].browser, "safari", "the row's mark travels with the copy");
  assert.deepEqual(phoneView[0].images, [{ data: "AAA", mimeType: "image/png" }], "the row carries the attachments it will prepend");
  assert.deepEqual(phoneView[0].files.map((file) => file.name), ["notes.md"]);

  const onIpad = await get("session:s2", "ipad-c3d4e5f6");
  assert.deepEqual((await onIpad.json()).copies.map((copy) => copy.label), ["mac", "iphone"]);
});

test("an empty composer clears this device's copy through the route", async () => {
  clearAllComposerCopies();
  const seeded = await put({ key: "session:s3", deviceId: MAC, label: "mac", kind: "desktop", value: "sent", images: [], files: [], updatedAt: T + 1000 });
  const { token } = await seeded.json();
  const cleared = await put({ key: "session:s3", deviceId: MAC, token, label: "mac", kind: "desktop", value: "", images: [], files: [], updatedAt: T + 2000 });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await (await get("session:s3", PHONE)).json()).copies, []);
});

test("DELETE removes the caller's own copy, and the token is checked", async () => {
  clearAllComposerCopies();
  const seeded = await put({ key: "cwd:/repo", deviceId: MAC, label: "mac", kind: "desktop", value: "a prompt", images: [], files: [], updatedAt: T + 1000 });
  const phone = await put({ key: "cwd:/repo", deviceId: PHONE, label: "iphone", kind: "phone", value: "another prompt", images: [], files: [], updatedAt: T + 2000 });
  const { token } = await seeded.json();

  assert.equal((await del("cwd:/repo", MAC, null)).status, 403, "no token, no delete");
  assert.equal((await del("cwd:/repo", PHONE, token)).status, 403, "the mac's token does not open the phone's copy");
  assert.equal((await del("cwd:/repo", PHONE, (await phone.json()).token)).status, 200);
  assert.deepEqual((await (await get("cwd:/repo", "ipad-c3d4e5f6")).json()).copies.map((copy) => copy.label), ["mac"]);
});

test("a copy past the caps is refused, not stored trimmed", async () => {
  clearAllComposerCopies();
  const long = await put({ key: "session:s4", deviceId: MAC, label: "mac", kind: "desktop", value: "x".repeat(200_001), images: [], files: [], updatedAt: T + 1000 });
  assert.equal(long.status, 413);
  assert.equal(readDeviceCopies("session:s4", PHONE).length, 0);

  const fat = await put({
    key: "session:s5",
    deviceId: MAC,
    label: "mac",
    kind: "desktop",
    value: "with a file",
    images: [],
    files: [{ id: "f1", name: "big.md", size: 5, text: "T".repeat(4_000_001) }],
    updatedAt: T + 1000,
  });
  assert.equal(fat.status, 413);

  const hugeImage = await put({
    key: "session:s6",
    deviceId: MAC,
    label: "mac",
    kind: "desktop",
    value: "with a screenshot",
    images: [{ data: "A".repeat(400_001), mimeType: "image/png" }, { data: "B".repeat(50), mimeType: "image/png" }],
    files: [],
    updatedAt: T + 1000,
  });
  assert.equal(hugeImage.status, 200, "an attachment the caps refuse is dropped and counted, the copy survives");
  assert.equal((await (await get("session:s6", PHONE)).json()).copies[0].droppedImages, 1);
});

test("a bad request is answered, and a foreign composer key shape is normalised", async () => {
  clearAllComposerCopies();
  assert.equal((await route.GET(new Request("http://localhost/api/composer-copies"))).status, 400);
  assert.equal((await del("session:s7", "short", "tok")).status, 400, "a device id must be a device id");
  const broken = await route.PUT(new Request("http://localhost/api/composer-copies", { method: "PUT", body: "{not json" }));
  assert.equal(broken.status, 400);
  assert.equal((await put({ key: "session:s7", value: "no device", images: [], files: [] })).status, 400);
  const wideBrowser = await put({ key: "session:s7", deviceId: MAC, label: "mac", kind: "desktop", browser: "Safari/605.1.15 (KHTML, like Gecko) Version/17.4", value: "a browser slug is a word", images: [], files: [], updatedAt: T + 1000 });
  assert.equal(wideBrowser.status, 400, "a browser is one word from a fixed set, not a user agent");

  // A fresh composer's draft id is the device's own; the folder is the shared key.
  const written = await put({ key: "new:7f3a:/repo", deviceId: MAC, label: "mac", kind: "desktop", value: "fresh composer", images: [], files: [], updatedAt: T + 1000 });
  assert.equal(written.status, 200);
  assert.deepEqual((await (await get("cwd:/repo", PHONE)).json()).copies.map((copy) => copy.value), ["fresh composer"]);
  assert.deepEqual((await (await get("new:other-draft:/repo", PHONE)).json()).copies.map((copy) => copy.value), ["fresh composer"], "another device's fresh composer in the same folder is the same composer");
});
