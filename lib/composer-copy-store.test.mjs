import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  clearAllComposerCopies,
  compareDeviceCopies,
  composerCopyKey,
  deleteDeviceCopy,
  isCopyEmpty,
  normalizeDeviceCopy,
  readDeviceCopies,
  writeDeviceCopy,
} = await jiti.import("@/lib/composer-copy-store.ts");

/** A device id the store accepts: 6..64 of [A-Za-z0-9_-]. */
const MAC = "mac-a1b2c3d4";
const PHONE = "iphone-b2c3d4e5";
const IPAD = "ipad-c3d4e5f6";
/** The store expires a copy after a day, so the stamps are real times. */
const T = Date.now();

function write(key, deviceId, fields) {
  return writeDeviceCopy(key, deviceId, { label: deviceId.split("-")[0], ...fields });
}

function copyText(result) {
  return result.copy?.value ?? null;
}

test("the composer key is a shared identity, not this browser's draft id", () => {
  // Two devices that open a new composer in the same folder share that composer.
  assert.equal(composerCopyKey("new:7f3a:/repo"), "cwd:/repo");
  // A Windows folder carries its own colon; the draft id never does.
  assert.equal(composerCopyKey("new:7f3a:C:\\work\\repo"), "cwd:C:\\work\\repo");
  // A session id and a parked draft are shared identities already.
  assert.equal(composerCopyKey("1f0b2c3d-0000-4000-8000-000000000000"), "1f0b2c3d-0000-4000-8000-000000000000");
  assert.equal(composerCopyKey("parked-new:/repo"), "parked-new:/repo");
});

test("every device keeps its own copy, and a write never touches another's", () => {
  clearAllComposerCopies();
  const mac = write("session:s1", MAC, { value: "typed on the mac", images: [], files: [], updatedAt: T + 1000 });
  const phone = write("session:s1", PHONE, { value: "typed on the phone", images: [], files: [], updatedAt: T + 2000 });
  assert.ok(mac.ok && phone.ok);
  const macToken = mac.token;
  const phoneToken = phone.token;
  assert.notEqual(macToken, phoneToken, "each device is handed its own token");

  // The mac keeps typing. The phone's copy is untouched by it.
  const again = writeDeviceCopy("session:s1", MAC, { token: macToken, label: "mac", value: "typed on the mac, longer", images: [], files: [], updatedAt: T + 3000 });
  assert.ok(again.ok);
  const fromPhone = readDeviceCopies("session:s1", PHONE);
  assert.deepEqual(fromPhone.map((copy) => [copy.deviceId, copy.value]), [[MAC, "typed on the mac, longer"]]);
  const fromMac = readDeviceCopies("session:s1", MAC);
  assert.deepEqual(fromMac.map((copy) => [copy.deviceId, copy.value]), [[PHONE, "typed on the phone"]]);
});

test("a write under a device id whose token the caller does not hold is refused", () => {
  clearAllComposerCopies();
  const mac = write("session:s2", MAC, { value: "the mac's prompt", images: [], files: [], updatedAt: T + 1000 });
  assert.ok(mac.ok, "the mac has a copy of its own before anyone tries to change it");
  const stolen = writeDeviceCopy("session:s2", MAC, { token: "not-the-token", label: "iphone", value: "overwritten", images: [], files: [], updatedAt: T + 5000 });
  assert.equal(stolen.ok, false);
  assert.equal(stolen.reason, "forbidden");
  assert.equal(copyText(stolen), "the mac's prompt", "the refusal shows the copy it tried to change");
  assert.deepEqual(readDeviceCopies("session:s2", "iphone-zzzzzz").map((copy) => copy.value), ["the mac's prompt"]);

  // No token at all is the same answer once a copy exists.
  const anonymous = writeDeviceCopy("session:s2", MAC, { label: "iphone", value: "overwritten", images: [], files: [] });
  assert.equal(anonymous.ok, false);
  assert.equal(anonymous.reason, "forbidden");
  assert.equal(readDeviceCopies("session:s2", "iphone-zzzzzz")[0].value, "the mac's prompt");
});

test("deleting a copy needs the token it was written with", () => {
  clearAllComposerCopies();
  const mac = write("cwd:/repo", MAC, { value: "a prompt", images: [], files: [], updatedAt: T + 1000 });
  const phone = write("cwd:/repo", PHONE, { value: "another prompt", images: [], files: [], updatedAt: T + 2000 });
  const foreign = deleteDeviceCopy("cwd:/repo", PHONE, mac.token);
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, "forbidden");
  assert.equal(readDeviceCopies("cwd:/repo", MAC).length, 1, "the phone's copy survives");
  const own = deleteDeviceCopy("cwd:/repo", PHONE, phone.token);
  assert.equal(own.ok, true);
  assert.deepEqual(readDeviceCopies("cwd:/repo", MAC).map((copy) => copy.deviceId), []);
  // A composer's copies expire one device at a time: the mac's is still there.
  assert.deepEqual(readDeviceCopies("cwd:/repo", "ipad-zzzzzz").map((copy) => copy.deviceId), [MAC]);
});

test("an empty composer removes this device's copy and stores nothing", () => {
  clearAllComposerCopies();
  const seeded = write("session:s3", MAC, { value: "sent", images: [], files: [], updatedAt: T + 1000 });
  assert.ok(seeded.ok);
  const cleared = writeDeviceCopy("session:s3", MAC, { token: seeded.token, label: "mac", value: "   ", images: [], files: [], updatedAt: T + 2000 });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.copy, null);
  assert.deepEqual(readDeviceCopies("session:s3", "iphone-zzzzzz"), [], "no empty copy is offered to another device");
  // A blank first write never mints a record at all.
  const blank = write("session:s4", PHONE, { value: "", images: [], files: [], updatedAt: T + 1000 });
  assert.ok(blank.ok);
  assert.deepEqual(readDeviceCopies("session:s4", "iphone-zzzzzz"), []);
});

test("a copy that cannot carry an attachment reports what it lost", () => {
  clearAllComposerCopies();
  const huge = { data: "A".repeat(400_001), mimeType: "image/png" };
  const small = { data: "B".repeat(100), mimeType: "image/png" };
  const result = write("session:s5", MAC, { value: "look at this", images: [huge, small], files: [], updatedAt: T + 1000 });
  assert.ok(result.ok, "the write is not refused — the composer keeps its attachments, the copy carries what fits");
  const [copy] = readDeviceCopies("session:s5", "iphone-zzzzzz");
  assert.deepEqual(copy.images.map((image) => image.data), ["B".repeat(100)]);
  assert.equal(copy.droppedImages, 1);
  assert.equal(copy.value, "look at this");
  assert.equal(isCopyEmpty({ value: "", images: [], files: [] }), true);

  const textOnly = normalizeDeviceCopy({ value: "x".repeat(200_001), images: [], files: [] });
  assert.equal(textOnly.ok, false, "a copy that lost the text is no copy at all");

  const fatFile = { id: "f1", name: "notes.md", size: 5, text: "T".repeat(4_000_001) };
  const oversized = write("session:s6", MAC, { value: "with a file", images: [], files: [fatFile], updatedAt: T + 1000 });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.reason, "too-large");
  assert.equal(readDeviceCopies("session:s6", "iphone-zzzzzz").length, 0, "nothing was stored for it");
});

test("the mac's copy leads the phone's, and the phone's leads a tablet's", () => {
  clearAllComposerCopies();
  // Written newest-first on purpose: the row order is the device kind, not the clock.
  write("session:s7", IPAD, { label: "ipad", kind: "tablet", value: "on the ipad", images: [], files: [], updatedAt: T + 3000 });
  write("session:s7", PHONE, { label: "iphone", kind: "phone", value: "on the iphone", images: [], files: [], updatedAt: T + 2000 });
  write("session:s7", MAC, { label: "mac", kind: "desktop", value: "on the mac", images: [], files: [], updatedAt: T + 1000 });
  const rows = readDeviceCopies("session:s7", IPAD).map((copy) => copy.label);
  assert.deepEqual(rows, ["mac", "iphone"], "the ipad sees the mac first, the phone second");
  const onPhone = readDeviceCopies("session:s7", PHONE).map((copy) => copy.label);
  assert.deepEqual(onPhone, ["mac", "ipad"], "the phone sees the other two, and never its own");
});

test("the ordering a client uses is the store's ordering", () => {
  const desktop = { deviceId: "d1", label: "mac", kind: "desktop", value: "a", images: [], files: [], updatedAt: T + 1, droppedImages: 0, droppedFiles: 0 };
  const phone = { deviceId: "p1", label: "iphone", kind: "phone", value: "b", images: [], files: [], updatedAt: T + 9, droppedImages: 0, droppedFiles: 0 };
  assert.ok(compareDeviceCopies(desktop, phone) < 0, "an older desktop copy still leads a newer phone copy");
  const older = { ...phone, updatedAt: T + 1 };
  const newer = { ...phone, updatedAt: T + 2 };
  assert.ok(compareDeviceCopies(newer, older) < 0, "inside one kind, the newest write leads");
});

test("a composer keeps the most recent devices' copies", () => {
  clearAllComposerCopies();
  for (let index = 0; index < 10; index += 1) {
    write("session:s8", `device-${index}-aaaaaaaa`, { value: `copy ${index}`, images: [], files: [], updatedAt: T + 1000 + index });
  }
  const kept = readDeviceCopies("session:s8", "nobody-aaaaaa");
  assert.equal(kept.length, 8, "eight devices on one composer is the cap");
  assert.equal(kept[0].value, "copy 9", "the newest survives, the oldest goes");
});

test("a device's clock orders its own copies, and a clock that jumps back cannot bury them", () => {
  clearAllComposerCopies();
  const first = write("session:s9", MAC, { value: "first", images: [], files: [], updatedAt: T + 50_000 });
  const back = writeDeviceCopy("session:s9", MAC, { token: first.token, label: "mac", value: "second", images: [], files: [], updatedAt: T - 40_000 });
  assert.ok(back.ok);
  const [copy] = readDeviceCopies("session:s9", "iphone-zzzzzz");
  assert.equal(copy.value, "second");
  assert.ok(copy.updatedAt > T + 50_000, "the stamp keeps moving forward for this device");
});
