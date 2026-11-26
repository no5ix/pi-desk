import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, webkit } from "playwright";

/**
 * The scroll-to-latest disc, sampled from pixels.
 *
 * Resting, the disc was an opaque panel chip with a hairline: it sat on the moving
 * prose like a form control, and the only state that looked like a floating control
 * was the hover. So the calm state now wears the hover's own fill and lets the page
 * through it, and a hover answers by closing the transparency — the same fill, no
 * hue change, measured: shallower than the panel chip it was, more solid than itself
 * at rest, and a demonstrably different colour over prose than over an empty page.
 */
const out = "test-results/scroll-to-bottom-disc";
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  entryPoints: ["e2e/scroll-to-bottom-disc.fixture.jsx"],
  outfile: `${out}/fixture.js`,
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const bundle = await readFile(`${out}/fixture.js`);

const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) { res.setHeader("Content-Type", "text/javascript"); res.end(bundle); return; }
  if (req.url.startsWith("/styles.css")) { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const lum = ([r, g, b]) => Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

/** The disc's fill, away from the glyph and the edge. */
async function fill(page, handle) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const shot = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  const dataUrl = "data:image/png;base64," + shot.toString("base64");
  return page.evaluate(async (src) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = src; });
    const s = img.width;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, s, s).data;
    // A patch of the disc's fill, clear of the glyph (the arrow occupies the
    // centre: x 0.34..0.79 of the disc) and clear of the edge and its shadow.
    let n = 0, r = 0, g = 0, b = 0;
    for (let y = Math.round(s * 0.4); y < Math.round(s * 0.6); y++) {
      for (let x = Math.round(s * 0.18); x < Math.round(s * 0.28); x++) {
        const i = (y * s + x) * 4;
        r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
      }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }, dataUrl);
}

/** The colour a browser reports for a translucent paint is its own dialect
 *  (`color(srgb …)`, `rgba(…)`) and a computed style never composites, so the alpha
 *  is measured from pixels: paint the colour over black and over white and read how
 *  much of each survived. */
async function measureAlpha(page, color) {
  const id = "alpha-probe-" + Math.random().toString(36).slice(2);
  const boxes = await page.evaluate(({ color, id }) => {
    const host = document.createElement("div");
    host.id = id;
    host.style.cssText = "position:fixed;left:0;top:0;z-index:99999;display:flex";
    const faces = [];
    for (const back of ["#000", "#ffffff"]) {
      const cell = document.createElement("div");
      cell.style.cssText = `width:24px;height:24px;background:${back}`;
      const face = document.createElement("div");
      face.style.cssText = `width:24px;height:24px;background:${color}`;
      cell.appendChild(face);
      host.appendChild(cell);
      faces.push(face);
    }
    document.body.appendChild(host);
    const r = host.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width };
  }, { color, id });
  const means = [];
  for (const i of [0, 1]) {
    const shot = await page.screenshot({ clip: { x: boxes.x + i * 24 + 6, y: boxes.y + 6, width: 12, height: 12 } });
    const dataUrl = "data:image/png;base64," + shot.toString("base64");
    means.push(await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res) => { img.onload = res; img.src = src; });
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, img.width, img.height).data;
      let n = 0, r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      return [r / n, g / n, b / n];
    }, dataUrl));
  }
  await page.evaluate((id) => document.getElementById(id)?.remove(), id);
  // Over black the paint leaves a*c; over white it leaves a*c + (1-a)*255. So the
  // gap between the two is (1-a)*255, and the alpha is what is left of the 255.
  const gap = means[0].map((v, i) => Math.abs(means[1][i] - v) / 255);
  return Math.round((1 - gap.reduce((x, y) => x + y, 0) / gap.length) * 1000) / 1000;
}

async function token(page, name) {
  return page.evaluate((n) => {
    const el = document.createElement("div");
    el.style.cssText = `position:fixed;left:-999px;top:0;width:8px;height:8px;background:${getComputedStyle(document.documentElement).getPropertyValue(n)}`;
    document.body.appendChild(el);
    const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g).map(Number);
    el.remove();
    return m.slice(0, 3);
  }, name);
}

const reports = [];
const launched = [["chromium", await chromium.launch()], ["webkit", await webkit.launch()]];
for (const [name, browser] of launched) {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForSelector(".chat-scroll-to-bottom.is-visible");
    await page.click(`#theme-${theme}`);
    await page.waitForTimeout(250);

    const discs = await page.$$(".chat-scroll-to-bottom.is-visible");
    const overInk = discs[0];
    const overPage = discs[1];
    const style = await overPage.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, border: cs.borderTopWidth, shadow: cs.boxShadow };
    });
    const fillOverInk = await fill(page, overInk);
    const rest = await fill(page, overPage);
    // A pointer is what hovers: the phone has no hover, and that is the point of a
    // resting state that already reads as the control.
    const desk = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
    const dpage = await desk.newPage();
    await dpage.goto(url);
    await dpage.waitForSelector(".chat-scroll-to-bottom.is-visible");
    await dpage.click(`#theme-${theme}`);
    await dpage.waitForTimeout(250);
    const discsDesktop = await dpage.$$(".chat-scroll-to-bottom.is-visible");
    const restDesktop = await fill(dpage, discsDesktop[1]);
    await dpage.hover(`${".chat-scroll-to-bottom.is-visible"} >> nth=1`);
    await dpage.waitForTimeout(250);
    const hoverStyle = await dpage.evaluate(() => getComputedStyle(document.querySelectorAll(".chat-scroll-to-bottom.is-visible")[1]).backgroundColor);
    const hover = await fill(dpage, (await dpage.$$(".chat-scroll-to-bottom.is-visible"))[1]);

    reports.push({
      name,
      theme,
      tokens: { bg: await token(page, "--bg"), panel: await token(page, "--bg-panel"), surface: await token(page, "--surface") },
      rest: { rgba: style.background, a: await measureAlpha(page, style.background), rgb: rest, lum: lum(rest), border: style.border, shadowLayers: style.shadow.split(/,(?![^(]*\))/).length },
      overInk: fillOverInk,
      overPage: rest,
      overInkVsPageLumDelta: Math.abs(lum(fillOverInk) - lum(rest)),
      desktop: { rest: restDesktop, restLum: lum(restDesktop), hover, hoverLum: lum(hover), hoverRgba: hoverStyle, hoverA: await measureAlpha(dpage, hoverStyle) },
    });
    await page.screenshot({ path: `${out}/${name}-${theme}.png` });
    await context.close();
    await desk.close();
  }
}
for (const [, b] of launched) await b.close();
server.close();

await writeFile(`${out}/report.json`, JSON.stringify(reports, null, 1));

for (const r of reports) {
  const label = `${r.name} ${r.theme}`;
  const pageLum = lum(r.tokens.bg);
  const panelLum = lum(r.tokens.panel);
  const plateLum = lum(r.tokens.surface);

  assert.ok(r.rest.a > 0.4 && r.rest.a < 0.78, `${label}: the resting disc is translucent (alpha ${r.rest.a})`);
  assert.equal(r.rest.border, "0px", `${label}: no edge`);
  assert.ok(r.rest.shadowLayers >= 2, `${label}: the shadow is a pair of layers`);

  // The palette makes --bg-panel the page's own colour, so what the disc was is a
  // chip in the page's colour ("the flat disc in the screenshot"). The resting disc
  // must stand off the page by a part of the plate, not all of it, in both themes.
  assert.equal(panelLum, pageLum, `${label}: the palette's panel is the page's colour, which is why the old fill read as flat`);
  assert.ok(r.rest.lum > pageLum, `${label}: the resting disc is a lift off the page (${pageLum} -> ${r.rest.lum})`);
  assert.ok(r.rest.lum < plateLum, `${label}: and it is a part of the plate, not the plate (${r.rest.lum} of ${plateLum})`);
  assert.ok(r.desktop.hoverLum > r.desktop.restLum, `${label}: a hover answers (${r.desktop.restLum} -> ${r.desktop.hoverLum})`);
  assert.ok(r.desktop.hoverA > r.rest.a, `${label}: by closing the transparency (${r.rest.a} -> ${r.desktop.hoverA})`);

  // The transparency is real, not a token that happens to be opaque: prose behind
  // the disc changes what the disc looks like.
  assert.ok(r.overInkVsPageLumDelta > 6, `${label}: the disc reads what is behind it (over ink ${lum(r.overInk)} vs over the page ${lum(r.overPage)})`);
}

console.log(`PASS: ${out} — the scroll-to-latest disc rests as a translucent plate, and a hover closes it (${reports.map((r) => `${r.name}/${r.theme} a=${r.rest.a}->${r.desktop.hoverA} page=${lum(r.tokens.bg)} rest=${r.rest.lum} hover=${r.desktop.hoverLum} plate=${lum(r.tokens.surface)} ink=${lum(r.overInk)}`).join(", ")})`);
