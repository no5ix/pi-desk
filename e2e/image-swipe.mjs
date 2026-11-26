import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, webkit } from "playwright";

/**
 * The image overlay, travelled by hand.
 *
 * The overlay used to hold one picture with one way out: on a phone a thumb had nothing
 * to swipe, a trackpad's flick did nothing, and a tap on the picture itself — what every
 * photo app answers with "close" — did nothing. The overlay now travels the pictures of
 * its own container: a finger's swipe and a trackpad's flick turn the page, a tap on the
 * picture closes it, and the pictures of a turn are a ring, so the last one arrives at
 * the first. A mouse drag is deliberately not a swipe.
 *
 * Two shapes, on both engines: the phone (touch, 390px) and the desktop (a wheel, and
 * the arrow keys). WebKit is the phone's engine, Chromium the desktop's.
 */
const out = "test-results/image-swipe";
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  entryPoints: ["e2e/image-swipe.fixture.jsx"],
  outfile: `${out}/fixture.js`,
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const bundle = await readFile(`${out}/fixture.js`);

const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url.startsWith("/styles.css")) {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

/** A pointer's press and release, of the type the gesture is supposed to be. */
const drag = ({ x1, y1, x2, y2, pointerType }) => {
  const target = document.querySelector(".image-preview-dialog[open] .image-preview-image");
  const fire = (type, x, y) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, composed: true, pointerType, pointerId: 7, clientX: x, clientY: y, isPrimary: true,
  }));
  fire("pointerdown", x1, y1);
  fire("pointerup", x2, y2);
};

const read = () => {
  const dialog = document.querySelector(".image-preview-dialog[open]");
  if (!dialog) return { open: false };
  const image = dialog.querySelector(".image-preview-image");
  return {
    open: true,
    count: dialog.dataset.count,
    label: dialog.querySelector(".image-preview-count")?.textContent ?? null,
    // The picture on screen, named by its own alt: the three fixtures differ only in
    // their pixels, and their data URLs share a long prefix.
    picture: image.getAttribute("alt"),
    cursor: getComputedStyle(image).cursor,
    buttons: [...dialog.querySelectorAll(".image-preview-swipe-button")].map((button) => ({
      w: Math.round(button.getBoundingClientRect().width),
      shown: getComputedStyle(button).display !== "none",
    })),
  };
};

async function open(page, nth = 0) {
  await page.locator("[data-image-preview-src]").nth(nth).click();
  await page.waitForTimeout(280);
  return page.evaluate(read);
}

for (const [name, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await browserType.launch();
  const errors = [];

  // The phone: a thumb, and nothing else.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name} phone: ${e}`));
    await page.goto(base);
    await page.waitForSelector("[data-image-preview-src]");

    const opened = await open(page);
    assert.equal(opened.open, true, `${name}: the overlay opens`);
    assert.equal(opened.count, "3", `${name}: the overlay knows the three pictures of its container`);
    assert.equal(opened.label, "1 / 3", `${name}: the overlay says which picture this is`);
    assert.equal(opened.cursor, "zoom-out", `${name}: the picture says it is a way out`);
    assert.deepEqual(opened.buttons.map((b) => b.shown), [true, true], `${name}: a thumb gets the two directions`);
    assert.ok(opened.buttons.every((b) => b.w >= 44), `${name}: and both are finger-sized (${opened.buttons.map((b) => b.w).join("px")}px)`);

    const box = await page.locator(".image-preview-image").boundingBox();
    const y = Math.round(box.y + box.height / 2);
    const from = Math.round(box.x + box.width - 24);
    const to = Math.round(box.x + 24);

    await page.evaluate(drag, { x1: from, y1: y, x2: to, y2: y, pointerType: "touch" });
    await page.waitForTimeout(260);
    const swiped = await page.evaluate(read);
    assert.equal(swiped.label, "2 / 3", `a swipe turns the page (${swiped.label})`);
    assert.equal(swiped.picture, "second picture", "and the picture on screen is the next one");

    // The same travel with a mouse pointer is not a swipe.
    await page.evaluate(drag, { x1: from, y1: y, x2: to, y2: y, pointerType: "mouse" });
    await page.waitForTimeout(220);
    const dragged = await page.evaluate(read);
    assert.equal(dragged.label, "2 / 3", `a mouse drag is not a swipe (${dragged.label})`);

    // A swipe ends in a click of its own: that click is not a tap, and the tap that
    // follows it is.
    await page.evaluate(drag, { x1: from, y1: y, x2: to, y2: y, pointerType: "touch" });
    await page.waitForTimeout(260);
    const afterSwipe = await page.evaluate(read);
    assert.equal(afterSwipe.label, "3 / 3", `the swipe's own click did not close the overlay (${afterSwipe.label})`);
    await page.mouse.click(Math.round(box.x + box.width / 2), y);
    await page.waitForTimeout(260);
    assert.equal((await page.evaluate(read)).open, false, `${name}: a tap on the picture closes the overlay`);

    await page.screenshot({ path: `${out}/${name}-phone.png` });

    // A picture with nothing beside it: the overlay travels nothing, so it says nothing
    // and shows no direction. It is still a tap away from being gone.
    await page.locator(".markdown-body [data-image-preview-src]").click();
    await page.waitForTimeout(260);
    const lone = await page.evaluate(read);
    assert.equal(lone.count, "1", `${name}: a lone picture is one, not a gallery`);
    assert.equal(lone.label, null, `${name}: and the overlay counts nothing out`);
    assert.deepEqual(lone.buttons, [], `${name}: with nowhere to go, the overlay draws no direction at all`);
    const loneBox = await page.locator(".image-preview-image").boundingBox();
    await page.mouse.click(Math.round(loneBox.x + loneBox.width / 2), Math.round(loneBox.y + loneBox.height / 2));
    await page.waitForTimeout(260);
    assert.equal((await page.evaluate(read)).open, false, `${name}: a lone picture closes on a tap too`);

    await context.close();
  }

  // The desktop: a trackpad, the arrow keys, and no swipe buttons.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${name} desktop: ${e}`));
    await page.goto(base);
    await page.waitForSelector("[data-image-preview-src]");

    const opened = await open(page);
    assert.deepEqual(opened.buttons.map((b) => b.shown), [false, false], `${name}: a mouse needs no swipe plates`);

    const box = await page.locator(".image-preview-image").boundingBox();
    const y = Math.round(box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2, y);

    // One flick turns one page: the momentum that follows it belongs to the same
    // gesture and is not a second page.
    await page.mouse.wheel(120, 0);
    await page.mouse.wheel(80, 0);
    await page.mouse.wheel(60, 0);
    await page.waitForTimeout(340);
    const flicked = await page.evaluate(read);
    assert.equal(flicked.label, "2 / 3", `one flick turns one page (${flicked.label})`);

    // The ring: past the last picture is the first.
    await page.mouse.wheel(120, 0);
    await page.waitForTimeout(340);
    const wrapped = await page.evaluate(read);
    assert.equal(wrapped.label, "3 / 3", `a second flick turns the next page (${wrapped.label})`);
    await page.mouse.wheel(120, 0);
    await page.waitForTimeout(340);
    const ring = await page.evaluate(read);
    assert.equal(ring.label, "1 / 3", `past the last picture is the first (${ring.label})`);
    await page.mouse.wheel(-120, 0);
    await page.waitForTimeout(340);
    const back = await page.evaluate(read);
    assert.equal(back.label, "3 / 3", `and the ring goes back the other way (${back.label})`);

    // A vertical scroll is the page's business, not the overlay's.
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(300);
    const vertical = await page.evaluate(read);
    assert.equal(vertical.label, "3 / 3", `a vertical scroll turns no page (${vertical.label})`);

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(260);
    const arrowed = await page.evaluate(read);
    assert.equal(arrowed.label, "1 / 3", `${name}: the arrow keys travel the ring too (${arrowed.label})`);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(260);
    assert.equal((await page.evaluate(read)).label, "3 / 3", `${name}: and backwards`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(260);
    assert.equal((await page.evaluate(read)).open, false, `${name}: Escape closes it`);

    await page.screenshot({ path: `${out}/${name}-desktop.png` });
    await context.close();
  }

  assert.deepEqual(errors, [], `${name}: no page errors`);
  await browser.close();
}

server.close();
console.log(`PASS: ${out} — the image overlay travels its container's pictures by swipe, flick, ring and arrow, and a tap on the picture closes it`);
