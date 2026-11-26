import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ImagePreview.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
// app/globals.css is upstream's and byte-identical; the overlay the user sees is the
// fork's override in app/native-theme.css, imported last.
const forkCss = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

test("composer attachments open in the shared preview with a separate remove button", async () => {
  const inputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(inputSource, /import \{ ImagePreview \} from "\.\/ImagePreview"/);
  assert.match(
    inputSource,
    /<ImagePreview key=\{img\.previewUrl\} src=\{img\.previewUrl\}>[\s\S]*?<img[\s\S]*?src=\{img\.previewUrl\}[\s\S]*?<\/ImagePreview>\s*<button\s*type="button"\s*onClick=\{\(\) => removeImage\(i\)\}/,
  );
});

test("uses a native modal dialog and restores focus to its trigger", () => {
  assert.match(source, /useRef<HTMLDialogElement>\(null\)/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /closeButtonRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /const trigger = triggerRef\.current[\s\S]*?trigger\?\.isConnected[\s\S]*?trigger\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(source, /createPortal/);
});

test("Escape closes image preview without reaching global shortcuts", () => {
  assert.match(
    source,
    /const closePreview = \(\) => \{[\s\S]*?dialogRef\.current\?\.open[\s\S]*?dialogRef\.current\.close\(\)[\s\S]*?setOpen\(false\)/,
  );
  assert.match(
    source,
    /event\.key !== "Escape"[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?closePreview\(\)/,
  );
  assert.match(
    source,
    /onCancel=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)[\s\S]*?closePreview\(\)/,
  );
});

test("closes only when the backdrop itself is clicked", () => {
  assert.match(source, /event\.target === event\.currentTarget[\s\S]*?closePreview\(\)/);
});

test("keeps the preview and Pi-style close button inside mobile safe areas", () => {
  assert.match(
    cssSource,
    /\.image-preview-dialog \{[\s\S]*?env\(safe-area-inset-top\)[\s\S]*?env\(safe-area-inset-right\)[\s\S]*?env\(safe-area-inset-bottom\)[\s\S]*?env\(safe-area-inset-left\)/,
  );
  assert.match(
    cssSource,
    /\.image-preview-close \{[\s\S]*?top: max\(12px, env\(safe-area-inset-top\)\)[\s\S]*?right: max\(12px, env\(safe-area-inset-right\)\)[\s\S]*?border-radius: 6px[\s\S]*?background: var\(--bg-panel\)/,
  );
  assert.match(cssSource, /@media \(pointer: coarse\) \{[\s\S]*?\.image-preview-close \{[\s\S]*?width: 44px;[\s\S]*?height: 44px;/);
  assert.match(source, /<path d="M6 6l12 12M18 6 6 18" \/>/);
});

test("the overlay has no direction plates, and its two plates let the photo through", () => {
  // The ring is travelled by the hand (swipe, wheel, arrows) and counted by the pill.
  // The two 44px discs that used to mark the directions sat on the photo and over the
  // image's own tap-to-close area, so they were removed at the user's request.
  assert.doesNotMatch(source, /image-preview-swipe/, "the component draws no swipe buttons");
  assert.doesNotMatch(forkCss, /\.image-preview-swipe/, "and no rule styles them");
  assert.match(source, /onPointerDown=\{onPointerDown\}[\s\S]*?onPointerUp=\{onPointerUp\}/, "the gestures stay behind");
  assert.match(source, /if \(event\.key === "ArrowRight"\) \{[\s\S]*?step\(1\)/, "the arrow keys travel the ring");

  const close = forkCss.match(/\.image-preview-close \{[\s\S]*?\n\}/);
  assert.ok(close, "the fork overrides the close");
  assert.match(close[0], /border: 0;/, "no hairline: the box upstream drew reads as a form control on a photo");
  assert.match(close[0], /border-radius: 999px;/, "a circle, like every control that floats over the page");
  assert.match(close[0], /background-color: color-mix\(in srgb, var\(--surface\) 52%, transparent\);/,
    "a translucent plate at rest: the user opened the overlay to look at the photo");
  assert.match(close[0], /backdrop-filter: blur\(10px\);/, "with a blur, so its ink is readable on any photo");

  const count = forkCss.match(/\.image-preview-count \{[\s\S]*?\n\}/);
  assert.ok(count, "the count is the fork's too");
  assert.match(count[0], /background: color-mix\(in srgb, var\(--surface\) 52%, transparent\);/, "the same translucent plate");
  assert.match(count[0], /backdrop-filter: blur\(10px\);/, "and the same blur");

  // A hover closes the plate to the app's opaque base plus the tint: the failure the
  // hover pass pinned (a 5% wash over a black backdrop reading as "a bit transparent")
  // must not come back with the translucency.
  const hover = forkCss.match(/\.image-preview-close:hover \{[\s\S]*?\n\}/);
  assert.ok(hover, "the close keeps its hover rule");
  assert.match(hover[0], /background-color: var\(--surface\);/, "an opaque base under the tint");
  assert.match(hover[0], /background-image: linear-gradient\(var\(--bg-hover\), var\(--bg-hover\)\);/, "the tint laid over it");
});
