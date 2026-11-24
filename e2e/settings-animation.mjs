import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The settings dialog's appearance and disappearance, measured in a browser.
 *
 * The panel used to be added to and removed from the DOM on the click, so the
 * sheet blinked in and the disappearance was never seen. The entrance is the app's
 * shared dialog motion; the fork added the exit and keeps the panel mounted for it
 * (components/AppShell.tsx pins the mount, this pins that the motion is real). The
 * markup is the panel's own — `.settings-dialog-backdrop` over
 * `.settings-dialog-surface` — styled by the app's real CSS.
 */
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)">
<div class="settings-dialog-backdrop" style="position:fixed;inset:0;display:flex">
  <div class="settings-dialog-surface"><div class="settings-dialog-header">Settings</div></div>
</div>
</body></html>`;

const server = createServer((req, res) => {
  if (req.url === "/styles.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const SURFACE_STATE = () => {
  const surface = document.querySelector(".settings-dialog-surface");
  const style = getComputedStyle(surface);
  return {
    animation: style.animationName,
    opacity: Number(style.opacity),
    transform: style.transform,
    pointerEvents: style.pointerEvents,
    backdrop: getComputedStyle(document.querySelector(".settings-dialog-backdrop")).animationName,
    running: surface.getAnimations().map((animation) => `${animation.animationName}:${animation.playState}`),
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(url);

const opening = await page.evaluate(SURFACE_STATE);
assert.equal(opening.animation, "native-modal-in", "the sheet arrives with the app's shared dialog motion");
assert.equal(opening.backdrop, "native-backdrop-in", "the scrim fades in");
assert.ok(opening.opacity < 1 || opening.transform !== "none",
  `it is mid-animation, not already settled (${opening.opacity}, ${opening.transform})`);

await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".settings-dialog-surface")).opacity) === 1);

// Close: the shared reverse, and a closing dialog takes no clicks. The class goes
// on in one round-trip and is read in the next; the animation timeline does not
// advance inside a single evaluate (measured: it is still at 0ms there).
await page.evaluate(() => {
  document.querySelector(".settings-dialog-backdrop").classList.add("is-closing");
  document.querySelector(".settings-dialog-surface").classList.add("is-closing");
});
const closing = await page.evaluate(SURFACE_STATE);
assert.equal(closing.animation, "native-modal-out", "the sheet animates out");
assert.equal(closing.backdrop, "native-backdrop-out", "the scrim fades out");
assert.equal(closing.pointerEvents, "none", "a closing dialog takes no clicks");
assert.ok(closing.running.some((entry) => entry.startsWith("native-modal-out:")),
  `the exit is running: ${closing.running.join(", ")}`);
// The exit ends somewhere short of the mount length AppShell keeps the panel alive
// for (SETTINGS_EXIT_MS = 180), so the sheet is fully gone before the unmount.
await page.waitForFunction(() => Number(getComputedStyle(document.querySelector(".settings-dialog-surface")).opacity) === 0);

// The motion is opt-out, like everywhere else in the app.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.reload();
const reduced = await page.evaluate(SURFACE_STATE);
assert.equal(reduced.animation, "none", "prefers-reduced-motion: no sheet animation");
assert.equal(reduced.backdrop, "none", "prefers-reduced-motion: no scrim fade");

await browser.close();
server.close();
console.log(`settings dialog: in ${opening.animation} (mid opacity ${opening.opacity}), out ${closing.animation} [${closing.running.join(", ")}] to opacity 0, reduced motion ${reduced.animation}`);
