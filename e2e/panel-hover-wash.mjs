import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * Hovering the right panel's close button must not make it look transparent.
 *
 * A hover state is a layer, not a window. The palette's `--bg-hover` is a 4–5% overlay
 * (it has to be, to sit over the desktop's translucent vibrancy window), and mixing it
 * with an opaque colour leaves a layer that is about half transparent — so in the
 * desktop app the wallpaper showed through the × the user was aiming at, and the
 * control read as faint at the moment the pointer arrived. The rule now lays the tint
 * over an opaque base, which is a solid wash in every palette.
 *
 * Measured in a real browser, in both themes, from the computed layer stack: an opaque
 * base, a tint over it, and a composite that differs from the strip behind it. A source
 * test cannot do this arithmetic — `color-mix` and its alpha are exactly what broke.
 */
const out = "test-results/panel-hover-wash";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/panel-hover-wash.fixture.jsx"],
  bundle: true,
  platform: "browser",
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
  if (req.url === "/styles.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});

/** `rgb(...)` / `rgba(...)` → `{ red, green, blue, alpha }`. */
function parseColor(value) {
  const parts = String(value).replace(/^rgba?\(|\)$/g, "").split(/[\s,]+/).map(Number);
  return { red: parts[0], green: parts[1], blue: parts[2], alpha: parts.length > 3 ? parts[3] : 1 };
}

/** The tint over the base, as the compositor would lay it down. */
function composite(tint, base) {
  const a = tint.alpha;
  return {
    red: Math.round(tint.red * a + base.red * (1 - a)),
    green: Math.round(tint.green * a + base.green * (1 - a)),
    blue: Math.round(tint.blue * a + base.blue * (1 - a)),
  };
}

const measure = () => {
  const styles = (selector) => {
    const el = document.querySelector(selector);
    const computed = getComputedStyle(el);
    return {
      background: computed.backgroundColor,
      image: computed.backgroundImage,
      opacity: computed.opacity,
    };
  };
  return {
    button: styles(".right-panel-close-button"),
    strip: getComputedStyle(document.querySelector(".right-panel-tab-strip")).backgroundColor,
    // The control pass: the recipe the user saw through, measured in the same page.
    oldWash: getComputedStyle(document.querySelector(".old-wash-probe")).backgroundColor,
    dark: document.documentElement.classList.contains("dark"),
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

for (const theme of ["light", "dark"]) {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector(".right-panel-close-button");
  if (theme === "dark") {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(60);
  }
  const rest = await page.evaluate(measure);
  assert.equal(rest.dark, theme === "dark", `${theme}: the theme is applied`);
  assert.match(rest.button.background, /^rgba\(0, 0, 0, 0\)$/,
    `${theme}: at rest the button carries no plate of its own (${rest.button.background})`);

  await page.hover(".right-panel-close-button");
  await page.waitForTimeout(120);
  const hover = await page.evaluate(measure);
  const box = await page.locator(".right-panel-tab-strip").boundingBox();
  await page.screenshot({ path: `${out}/${theme}-hover.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  await page.mouse.move(10, box.y + 200);

  const base = parseColor(hover.button.background);
  assert.equal(Number(hover.button.opacity), 1, `${theme}: the control never fades`);
  assert.equal(base.alpha, 1, `${theme}: the hover wash sits on an opaque base — this is what the wallpaper cannot pass through`);
  const tintMatch = hover.button.image.match(/rgba?\([^)]+\)/);
  assert.ok(tintMatch && hover.button.image.startsWith("linear-gradient"),
    `${theme}: the tint is the palette's hover colour, laid over that base (${hover.button.image})`);
  const tint = parseColor(tintMatch[0]);
  assert.ok(tint.alpha > 0 && tint.alpha < 0.6, `${theme}: the tint is a tint (${tint.alpha})`);
  const washed = composite(tint, base);
  const strip = parseColor(rest.strip);
  const delta = Math.max(
    Math.abs(washed.red - strip.red),
    Math.abs(washed.green - strip.green),
    Math.abs(washed.blue - strip.blue),
  );
  assert.ok(delta >= 3,
    `${theme}: the hovered control is set apart from the strip it sits in (${delta} levels)`);

  // The control pass: had the rule kept the old `color-mix(in srgb, var(--bg-hover),
  // var(--bg-panel))`, the layer's alpha would be well under 1 and the assertion above
  // would fail. Measured here so the test cannot pass by being blind.
  const old = parseColor(rest.oldWash);
  assert.ok(old.alpha < 1, `${theme}: the control pass — the old color-mix wash is translucent (${rest.oldWash})`);
  console.log(`ok: ${theme} — base ${hover.button.background} + tint ${tintMatch[0]} → ${washed.red},${washed.green},${washed.blue} over strip ${rest.strip}; the old wash ${rest.oldWash}`);
}

await browser.close();
server.close();
console.log("PASS: the panel's close button paints a solid hover wash in both themes");
