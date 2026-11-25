import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * A live subagent run, worn by the two controls the user reaches for.
 *
 * The header counted a run and breathed (`[robot] ↻1`), the Agents panel's row breathed,
 * and the two places the user is actually aiming at said nothing of it: the composer
 * answered with the same square it shows for an ordinary turn, and the sidebar row's fold
 * head sat still. The shape and the movement are now one thing in all four places.
 *
 * The claims are measurable:
 *
 *  · with a live run the disc's glyph **is the head** (five drawn parts, an ink box
 *    wider than the square's 9px), and it **moves** — `agent-run-pulse`, 1.6s;
 *  · the button is still the one Stop: same `data-action`, same accessible name;
 *  · the head fits its disc with room on every side and sits centred, so a bigger glyph
 *    has not become a clipped glyph;
 *  · a turn with no run under it keeps the square and nothing animates;
 *  · the sidebar row's fold head animates at the row's 11px, inside the 18px pill;
 *  · `prefers-reduced-motion: reduce` stops every one of them, identically shaped;
 *  · in the dark theme the head keeps its ink on the disc it is painted on (measured
 *    WCAG contrast, not a colour name);
 *  · a glyph with no state class animates nothing (the blindness guard), and the square
 *    the disc used to show for a live run is rejected by the head check (the regression
 *    pass), so a green run here cannot be a green run that measures nothing.
 */
const out = "test-results/subagent-run-glyph";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/subagent-run-glyph.fixture.jsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: `${out}/fixture.js`,
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
    html,body{margin:0}button{font:inherit}
    </style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

/**
 * Read the page's glyphs: each one's shape, its box, its ink box and its animation.
 *
 * `getBBox()` is in the viewBox's user units, so the ink box is scaled by the rendered
 * size: the head paints 18 of its 24 units, the square 9 of its 16. An svg with no
 * drawing reports a 0×0 box, which is what makes the `control` case usable as a guard.
 */
const read = (page) => page.evaluate(() => {
  const glyph = (svg) => {
    const box = svg.getBoundingClientRect();
    const cs = getComputedStyle(svg);
    const vb = (svg.getAttribute("viewBox") || "0 0 24 24").split(/\s+/).map(Number);
    let ink = { width: 0, height: 0 };
    try {
      const b = svg.getBBox();
      const scale = box.width / vb[2];
      ink = { width: +(b.width * scale).toFixed(2), height: +(b.height * scale).toFixed(2) };
    } catch { /* an empty svg has no box */ }
    return {
      parts: [...svg.children].map((el) => el.tagName.toLowerCase()),
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      stroke: cs.stroke,
      width: +box.width.toFixed(2),
      height: +box.height.toFixed(2),
      centre: +(box.left + box.width / 2).toFixed(2),
      ink,
    };
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, centre: r.left + r.width / 2 };
  };
  const composer = (caseName) => {
    const button = document.querySelector(`[data-case="${caseName}"] .composer-send-button`);
    if (!button) return { caseName, missing: "the disc is not rendered" };
    return {
      caseName,
      action: button.dataset.action,
      label: button.getAttribute("aria-label"),
      disabled: button.disabled,
      disc: box(button),
      discBackground: getComputedStyle(button).backgroundColor,
      glyph: glyph(button.querySelector("svg")),
    };
  };
  const toggle = document.querySelector('[data-case="row"] .session-item-children-toggle');
  return {
    runs: composer("runs"),
    turn: composer("turn"),
    idle: composer("idle"),
    pageBackground: getComputedStyle(document.body).backgroundColor,
    row: {
      height: box(toggle).height,
      width: box(toggle).width,
      running: toggle.classList.contains("is-running"),
      label: toggle.getAttribute("aria-label"),
      glyph: glyph(toggle.querySelector(".session-item-children-glyph")),
    },
    control: glyph(document.querySelector('[data-case="control"]')),
    old: glyph(document.querySelector('[data-case="old"] svg')),
    viewport: window.innerWidth,
  };
});

const browser = await chromium.launch();
/** The light-theme desktop measurement, kept for the dark pass to compare against. */
let light = null;

/** Colour of a serialised CSS colour, in 0..255 channels. Chromium writes plain colours
 *  as `rgb(…, …)` and `color-mix()` results as `color(srgb …)` (0..1), so both scales
 *  are read — the same pairing `e2e/agents-panel-card.mjs` documents. */
const channels = (color) => {
  const nums = (color.match(/[\d.]+/g) ?? []).map(Number);
  const [r, g, b, a = 1] = /srgb|display-p3|\blab\b|\blch\b|\boklab\b|\boklch\b/i.test(color)
    ? nums.map((v, i) => (i < 3 ? v * 255 : v))
    : nums;
  return { r, g, b, a };
};
const luminance = ({ r, g, b }) => {
  const lin = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
/** WCAG contrast of a glyph's stroke over the disc it is painted on. */
const contrast = (stroke, background) => {
  const fg = channels(stroke);
  const bg = channels(background);
  const over = (c) => ({
    r: c.r * c.a + bg.r * (1 - c.a),
    g: c.g * c.a + bg.g * (1 - c.a),
    b: c.b * c.a + bg.b * (1 - c.a),
  });
  const a = luminance(over(fg));
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

try {
  for (const shape of [
    { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
    { name: "iphone", viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const page = await browser.newPage({ viewport: shape.viewport, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-case="runs"] .composer-send-button');
    const m = await read(page);
    if (!light) light = m;

    // A live run: the head, and it moves.
    const runs = m.runs;
    assert.ok(!runs.missing, `${shape.name}: the composer's disc rendered (${runs.missing})`);
    assert.equal(runs.action, "stop", `${shape.name}: a live run keeps the Stop action`);
    assert.equal(runs.label, "Stop agent", `${shape.name}: the button is still named Stop`);
    assert.ok(!runs.disabled, `${shape.name}: Stop is pressable`);
    assert.equal(runs.glyph.parts.length, 5,
      `${shape.name}: the head is drawn (${runs.glyph.parts.join(",")})`);
    assert.deepEqual(runs.glyph.parts, ["path", "circle", "rect", "path", "path"],
      `${shape.name}: the lit-eyes head, the shape the header and the Agents panel draw`);
    assert.equal(runs.glyph.animationName, "agent-run-pulse",
      `${shape.name}: the head breathes, the header's cycle`);
    assert.equal(runs.glyph.animationDuration, "1.6s", `${shape.name}: at the header's speed`);
    const discContrast = contrast(runs.glyph.stroke, runs.discBackground);
    assert.ok(discContrast >= 4.5,
      `${shape.name}: the head is readable on the disc (${discContrast.toFixed(2)}:1, ${runs.glyph.stroke} on ${runs.discBackground})`);
    assert.ok(runs.glyph.ink.width >= 11 && runs.glyph.ink.height >= 9,
      `${shape.name}: the head is legible on the disc, ink ${runs.glyph.ink.width}×${runs.glyph.ink.height}px`);
    assert.ok(runs.glyph.ink.width > 9.5,
      `${shape.name}: wider than the 9px square it replaces (${runs.glyph.ink.width}px)`);

    // It fits.
    const clearanceX = (runs.disc.width - runs.glyph.width) / 2;
    const clearanceY = (runs.disc.height - runs.glyph.height) / 2;
    assert.ok(clearanceX >= 6 && clearanceY >= 6,
      `${shape.name}: the glyph keeps ${clearanceX.toFixed(1)}×${clearanceY.toFixed(1)}px of disc around it (disc ${runs.disc.width}×${runs.disc.height}, glyph ${runs.glyph.width}×${runs.glyph.height})`);
    assert.ok(Math.abs(runs.glyph.centre - runs.disc.centre) <= 1.5,
      `${shape.name}: the head sits centred in the disc (${(runs.glyph.centre - runs.disc.centre).toFixed(2)}px off)`);

    // A turn with no run under it, and an idle composer: the old glyphs, unanimated.
    assert.equal(m.turn.action, "stop", `${shape.name}: a turn is still stoppable`);
    assert.deepEqual(m.turn.glyph.parts, ["rect"], `${shape.name}: the square stays with no run`);
    assert.equal(m.turn.glyph.animationName, "none", `${shape.name}: nothing breathes that is not running`);
    assert.equal(m.idle.action, "send", `${shape.name}: an idle composer sends`);
    assert.equal(m.idle.glyph.animationName, "none", `${shape.name}: the arrow does not breathe`);

    // The sidebar row's fold head, at the row's size, in the row's pill.
    assert.ok(m.row.running, `${shape.name}: the toggle carries the running state`);
    assert.equal(m.row.glyph.animationName, "agent-run-pulse", `${shape.name}: the fold head breathes with the header`);
    assert.equal(m.row.glyph.animationDuration, "1.6s", `${shape.name}: one cycle everywhere`);
    assert.ok(m.row.glyph.width <= 12 && m.row.glyph.height <= 12,
      `${shape.name}: the row's head stays a glyph (${m.row.glyph.width}×${m.row.glyph.height}px)`);
    assert.ok(Math.abs(m.row.height - 18) <= 1, `${shape.name}: the 18px pill is not pushed (${m.row.height}px)`);
    assert.match(m.row.label, /· 1 running/, `${shape.name}: the breathing icon is also said (${m.row.label})`);

    // The guards: a stateless glyph animates nothing, and the square the disc used to
    // show is not a head.
    assert.equal(m.control.animationName, "none", `${shape.name}: the blindness guard — an unclassed glyph does not animate`);
    assert.ok(m.control.parts.length === 0, `${shape.name}: the guard svg draws nothing`);
    assert.ok(m.old.parts.length < 5 && m.old.ink.width < 10,
      `${shape.name}: the old square fails the head check (${m.old.parts.join(",")} at ${m.old.ink.width}px)`);

    assert.deepEqual(errors, [], `${shape.name}: the fixture runs clean`);
    await page.screenshot({ path: `${out}/${shape.name}.png`, fullPage: true });
    // The two controls at their own size, so a screenshot shows what was measured.
    await page.locator('[data-case="runs"] .composer-send-button').screenshot({ path: `${out}/${shape.name}-disc.png` });
    await page.locator('[data-case="turn"] .composer-send-button').screenshot({ path: `${out}/${shape.name}-disc-square.png` });
    await page.locator('[data-case="row"] .session-item-children-toggle').screenshot({ path: `${out}/${shape.name}-row.png` });
    console.log(`${shape.name}: head ${runs.glyph.ink.width}×${runs.glyph.ink.height}px in a ${runs.disc.width}px disc at ${discContrast.toFixed(1)}:1, ${runs.glyph.animationName} ${runs.glyph.animationDuration}; row head ${m.row.glyph.width}px ${m.row.glyph.animationName}; square and arrow at rest`);
    await page.close();
  }

  // Reduced motion: the identical shape, unanimated.
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-case="runs"] .composer-send-button');
  const calm = await read(page);
  assert.equal(calm.runs.glyph.parts.length, 5, "reduced motion: the head is still drawn");
  assert.equal(calm.runs.glyph.animationName, "none", "reduced motion: the disc's head is at rest");
  assert.equal(calm.row.glyph.animationName, "none", "reduced motion: the row's head is at rest");
  await page.screenshot({ path: `${out}/reduced-motion.png`, fullPage: true });
  await page.close();

  // The dark theme: the disc is a light button there, so the head must keep its ink.
  const dark = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await dark.goto(url, { waitUntil: "networkidle" });
  await dark.waitForSelector('[data-case="runs"] .composer-send-button');
  await dark.evaluate(() => document.documentElement.classList.add("dark"));
  const night = await read(dark);
  assert.equal(night.runs.glyph.animationName, "agent-run-pulse", "dark: the head breathes here too");
  const nightContrast = contrast(night.runs.glyph.stroke, night.runs.discBackground);
  assert.ok(nightContrast >= 4.5,
    `dark: the head is readable on the light disc (${nightContrast.toFixed(2)}:1, ${night.runs.glyph.stroke} on ${night.runs.discBackground})`);
  assert.notEqual(night.pageBackground, light.pageBackground, "dark: the page really is the other theme (`html.dark` took)");
  await dark.locator('[data-case="runs"] .composer-send-button').screenshot({ path: `${out}/dark-disc.png` });
  await dark.locator('[data-case="row"] .session-item-children-toggle').screenshot({ path: `${out}/dark-row.png` });
  await dark.screenshot({ path: `${out}/dark.png`, fullPage: true });
  await dark.close();

  console.log("subagent-run-glyph: the live run is worn by the disc and the row head, and a turn with no run is not");
} finally {
  await browser.close();
  server.close();
}
