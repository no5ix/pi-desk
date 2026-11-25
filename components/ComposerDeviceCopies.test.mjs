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
 * no delete button** — no device edits or deletes another's content — and the row
 * is marked by a **pair**: the machine, then the **browser** that typed it (a
 * screen with Safari's compass; a phone body with Chrome's wheel), because "whose
 * draft is this" asks about both and one compass made a MacBook and an iPhone
 * twins. The device's slug is not printed — it is the row's tooltip and its
 * accessible name — because a slug is scan noise where two marks are read at a
 * glance. The row's one action is `onUse`, which prepends the copy into this
 * composer and leaves the row alone.
 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { browserDisplayName, detectBrowser, deviceCopyNames, detectDevice } = await jiti.import("@/lib/device-identity.ts");

const row = readFileSync(new URL("./ComposerDeviceCopies.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a copy row is read-only: no edit, no delete, no send", () => {
  const rows = row.slice(row.indexOf("copies.map("));
  assert.doesNotMatch(rows, /composer-outbox-actions/, "no action column: a row cannot edit another device's draft");
  assert.doesNotMatch(rows, /"edit"|"delete"|"send"|sendQueuedNow|editQueuedMessage|deleteQueuedMessage/, "no queued-message affordances leak in");
  assert.match(rows, /onClick=\{\(\) => onUse\(copy\)\}/, "the row's one action is picking the copy up");
  assert.match(row, /className="composer-outbox composer-device-copies"/, "it reuses the outbox's docked surface");
});

test("the mark is a pair: the machine, then the browser that typed the copy", () => {
  assert.match(row, /<DeviceCopyGlyph kind=\{copy\.kind\} \/>/, "the machine comes first: a MacBook's screen, an iPhone's body");
  assert.match(row, /<BrowserCopyGlyph browser=\{copy\.browser\} \/>/, "and its browser follows");
  for (const browser of ["safari", "chrome", "edge", "firefox", "opera"]) {
    assert.match(row, new RegExp(`^  ${browser}: \\[`, "m"), `${browser} has a mark`);
  }
  assert.match(row, /const strokes = browser && browser !== "other" \? BROWSER_GLYPHS\[browser\] : null;\n\s*if \(!strokes\) return null;/,
    "a browser with no mark, and a copy written before the browser was recorded, draw no brand: the device glyph already carries the row, and a guessed brand is a lie");
  // The phone glyph used to be a thin slab; at 15px it read as a line. A rounded
  // body, a speaker and a home dot survive the size.
  assert.match(row, /"M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14"/, "a phone with a body");
  assert.match(row, /strokeWidth="2"/, "the app's stroke weight, not a thin 1.75");
  assert.match(css, /\.composer-copy-row \.composer-outbox-mark \{[^}]*gap: 3px;/s, "the pair is spaced, not glued");
  const narrow = css.slice(css.indexOf("@media (max-width: 480px) {\n  /* The mark is the machine and its browser"));
  assert.match(narrow, /\.composer-device-copies \.composer-outbox-mark \{ display: flex; \}/,
    "on a phone the mark stays: the outbox hides its queue glyph, a copy row's mark is its point");
});

test("the row prints no `mac-content-copy`: the mark is the row's text, the name is its tooltip", () => {
  assert.doesNotMatch(row, /className="composer-copy-name"/, "the slug is not printed in the row");
  assert.match(row, /title=\{`\$\{name\} · \$\{browser\} · \$\{copy\.value \|\| text\}`\}/, "the tooltip says whose copy, in which browser");
  assert.match(row, /aria-label=\{`\$\{t\("chat\.deviceCopyUse"\)\}: \$\{name\} · \$\{browser\}`\}/, "the accessible name names its owner and its browser");
  assert.ok(!css.includes(".composer-copy-name"), "the name's style went with the name");
});

test("the copy keeps a name for its tooltip: mac-content-copy, iphone-content-copy, ipad-content-copy", () => {
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

test("the browser mark comes from the browser's own description of itself", () => {
  const ua = (rest) => ({ userAgent: `Mozilla/5.0 (${rest})` });
  const mac = "Macintosh; Intel Mac OS X 10_15_7";
  const phone = "iPhone; CPU iPhone OS 18_1 like Mac OS X";
  assert.equal(detectBrowser(ua(`${mac}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15`)), "safari", "Safari on a MacBook: the compass");
  assert.equal(detectBrowser(ua(`${phone}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1`)), "safari", "an iPhone's Safari");
  assert.equal(detectBrowser(ua(`${mac}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36`)), "chrome", "Chromium ends its UA with Safari/ and is not Safari");
  assert.equal(detectBrowser(ua(`${mac}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0`)), "edge", "Edge wins over its Chrome/ token");
  assert.equal(detectBrowser(ua("Linux; Android 14; Pixel 8 Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.0.0")), "edge", "Edge on Android");
  assert.equal(detectBrowser(ua("Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/46.0.2486.0 Safari/537.36 Edge/13.10586")), "edge", "legacy Edge");
  assert.equal(detectBrowser(ua(`${phone}) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.199 Mobile/15E148 Safari/604.1`)), "chrome", "Chrome on iOS");
  assert.equal(detectBrowser(ua(`${mac}; rv:132.0) Gecko/20100101 Firefox/132.0`)), "firefox");
  assert.equal(detectBrowser(ua(`${phone}) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15`)), "firefox", "Firefox on iOS");
  assert.equal(detectBrowser(ua(`${mac}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/116.0.0.0`)), "opera");
  assert.equal(detectBrowser(ua(`${mac}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Vivaldi/6.12`)), "other", "a browser with no mark is other, never a guess");
  assert.equal(detectBrowser(ua("Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36")), "chrome", "an Android WebView");
  assert.equal(detectBrowser(ua(`${mac}) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36`)), "chrome", "a headless Chromium is Chromium, not the Safari/537.36 that ends every Blink UA");
  assert.equal(detectBrowser(ua("Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)")), "other", "the desktop shell's webview with no Version/ token: no guess");
  assert.equal(detectBrowser({}), "other", "nothing reported: the device glyph");
  assert.equal(browserDisplayName("safari"), "Safari", "a brand name is a brand name in every locale");
  assert.equal(browserDisplayName(undefined), "browser", "an unknown browser is named honestly");
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
