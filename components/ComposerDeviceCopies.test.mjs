import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The rows that show the other devices' composer copies (pic1's row, worn by a
 * different feature).
 *
 * The row is the outbox's row with two differences, and both are the design:
 * a copy belongs to the device that typed it, so there is **no edit button and
 * no delete button** — no device edits or deletes another's content — and the
 * glyph names that device (a computer, a phone, a tablet), because "whose draft
 * is this" is the only question a row has to answer. The row's one action is
 * `onUse`, which prepends the copy into this composer and leaves the row alone.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { deviceCopyNames, detectDevice } = await jiti.import("@/lib/device-identity.ts");

const row = readFileSync(new URL("./ComposerDeviceCopies.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a copy row is read-only: no edit, no delete, no send", () => {
  const rows = row.slice(row.indexOf("copies.map("));
  assert.doesNotMatch(rows, /composer-outbox-actions/, "no action column: a row cannot edit another device's draft");
  assert.doesNotMatch(rows, /"edit"|"delete"|"send"|sendQueuedNow|editQueuedMessage|deleteQueuedMessage/, "no queued-message affordances leak in");
  assert.match(rows, /onClick=\{\(\) => onUse\(copy\)\}/, "the row's one action is picking the copy up");
  assert.match(row, /className="composer-outbox composer-device-copies"/, "it reuses the outbox's docked surface");
});

test("the glyph names the device: computer, phone, tablet", () => {
  assert.match(row, /desktop: "M2 5h20v12H2zM9 21h6M12 17v4"/, "a computer");
  assert.match(row, /phone: "M8 2h8v20H8zM11 19h2"/, "a phone");
  assert.match(row, /tablet: "M5 3h14v18H5zM11 18h2"/, "a tablet");
  assert.match(row, /<DeviceCopyGlyph kind=\{copy\.kind\} \/>/, "the glyph follows the device kind");
  const narrow = css.slice(css.indexOf("@media (max-width: 480px) {\n  /* The glyph names the device"));
  assert.match(narrow, /\.composer-device-copies \.composer-outbox-mark \{ display: flex; \}/,
    "on a phone the mark stays: the outbox hides its queue glyph, a copy row's glyph is its point");
});

test("the copy is named after the device: mac-content-copy, iphone-content-copy, ipad-content-copy", () => {
  assert.deepEqual(deviceCopyNames([
    { label: "mac", deviceId: "mac-aaaaaa" },
    { label: "iphone", deviceId: "iphone-bbbbbb" },
  ]), ["mac-content-copy", "iphone-content-copy"]);
  assert.deepEqual(deviceCopyNames([{ label: "ipad", deviceId: "ipad-cccccc" }]), ["ipad-content-copy"]);
  // Two Macs are two devices: only the second of a pair carries its own id.
  const twoMacs = deviceCopyNames([
    { label: "mac", deviceId: "mac-aaaaaa" },
    { label: "mac", deviceId: "mac-zzz999" },
  ]);
  assert.equal(twoMacs[0], "mac-content-copy");
  assert.equal(twoMacs[1], "mac-content-copy (maczz)", "the second Mac is named by its own device id");
  assert.notEqual(twoMacs[0], twoMacs[1], "two Macs never share one name");
});

test("the labels come from the browser's own description of itself", () => {
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 0 }), { label: "mac", kind: "desktop" });
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari", platform: "iPhone" }), { label: "iphone", kind: "phone" });
  // iPadOS 13+ asks for the desktop site: the UA says Macintosh, the touch points do not.
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.1 Safari", platform: "MacIntel", maxTouchPoints: 5 }), { label: "ipad", kind: "tablet" });
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) Safari", platform: "iPad" }), { label: "ipad", kind: "tablet" });
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile)", platform: "Linux armv81" }), { label: "android-phone", kind: "phone" });
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; SM-X710)", platform: "Linux x86_64" }), { label: "android-tablet", kind: "tablet" });
  assert.deepEqual(detectDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", platform: "Win32" }), { label: "windows", kind: "desktop" });
});

test("a copy that lost attachments says so, in the row", () => {
  assert.match(row, /copy\.droppedImages \+ copy\.droppedFiles/, "the row counts what the caps refused");
  assert.match(row, /t\("chat\.deviceCopyDropped", \{ count: dropped \}\)/);
  assert.match(row, /t\("chat\.deviceCopyFiles", \{ count: copy\.files\.length \}\)/);
});

test("every locale names the rows and their action", () => {
  const plugins = readFileSync(new URL("../lib/i18n/locale-plugins.ts", import.meta.url), "utf8");
  for (const key of ["chat.deviceCopies", "chat.deviceCopyUse", "chat.deviceCopyFiles", "chat.deviceCopyDropped"]) {
    const occurrences = plugins.split(`"${key}"`).length - 1;
    assert.equal(occurrences, 3, `${key} is set in en, zh-CN and zh-TW`);
  }
});
