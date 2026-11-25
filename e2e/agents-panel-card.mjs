import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The Agents panel, measured in a browser.
 *
 * The panel used to be a sheet: pinned to the topbar's right edge, squared off by a rule
 * at the tail of the user stylesheet (`border-radius: 0`, the topbar's translucent ink),
 * so what hung over the conversation was a grey box with right angles and no shadow,
 * a screen away from the subagent count that opened it — and over the file panel, where
 * nobody reads a run.
 *
 * The claims are therefore measurable:
 * - the app menu's surface: a rounded rectangle, the menu's shadow, an elevated surface;
 * - on a desktop and a pad the card opens under the count, its left edge in line with it;
 * - on a phone it centres on the page below the header, and keeps a gutter from the
 *   screen so its shadow is not cut.
 *
 * The last pass puts the old rules back (the squared surface, the right-edge pin) and
 * expects the measurement to see them, so the assertions cannot pass by being blind.
 */
const out = "test-results/agents-panel-card";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/agents-panel-card.fixture.jsx"],
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

function serve() {
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
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const MEASURE = () => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
  };
  const panel = document.querySelector(".agent-session-panel");
  const layer = document.getElementById("panel-layer");
  const style = getComputedStyle(panel);
  return {
    radius: parseFloat(style.borderTopLeftRadius),
    shadow: style.boxShadow,
    background: style.backgroundColor,
    panel: box(panel),
    layer: box(layer),
    layerOverflowY: getComputedStyle(layer).overflowY,
    topbarBottom: box(document.querySelector(".app-topbar")).bottom,
    chipLeft: box(document.querySelector(".app-topbar-subagents")).left,
    viewport: window.innerWidth,
  };
};

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
try {
  for (const shape of [
    { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
    { name: "pad", viewport: { width: 834, height: 1112 }, mobile: false },
    { name: "iphone", viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const page = await browser.newPage({ viewport: shape.viewport, deviceScaleFactor: 2 });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector(".agent-session-panel");
    const m = await page.evaluate(MEASURE);
    const centre = m.panel.left + m.panel.width / 2;

    // The surface: the app's own menu card, the one the More menu wears.
    assert.ok(m.radius >= 12, `${shape.name}: a rounded rectangle, got ${m.radius}px corners`);
    assert.notEqual(m.shadow, "none", `${shape.name}: the card carries the menu's shadow`);
    assert.match(m.shadow, /rgba?\(/, `${shape.name}: the shadow is a real shadow, not a border`);
    assert.equal(m.background, "rgb(255, 255, 255)", `${shape.name}: the elevated surface, not the chrome's translucent ink`);
    assert.ok(m.panel.top >= m.topbarBottom, `${shape.name}: the card is below the header, not under it`);
    assert.ok(m.panel.top - m.topbarBottom >= 4, `${shape.name}: it hangs below the header, so its top shadow is on the page`);
    assert.ok(m.panel.left >= 6, `${shape.name}: the card's left edge and shadow are on the page`);
    assert.ok(m.panel.right <= m.viewport - 6, `${shape.name}: nothing of the card is off the screen (right ${m.panel.right} of ${m.viewport})`);
    assert.equal(m.layerOverflowY, "visible", `${shape.name}: the layer does not scroll, so it cannot clip the shadow`);

    if (shape.mobile) {
      assert.ok(Math.abs(centre - m.viewport / 2) <= 1,
        `${shape.name}: the card centres on the page (centre ${centre.toFixed(1)} of ${m.viewport})`);
    } else {
      assert.ok(Math.abs(m.panel.left - m.chipLeft) <= 1,
        `${shape.name}: the card opens under the subagent count (card ${m.panel.left.toFixed(1)}, count ${m.chipLeft.toFixed(1)})`);
    }
    await page.screenshot({ path: `${out}/${shape.name}.png` });

    // The old rules, put back: the measurement has to see them. The probe names the
    // layer too, so it outranks the fix's `.agent-session-panel.app-menu` the way the
    // tail rule the fix deleted did not — a rule that could not repaint the card would
    // prove nothing.
    const squared = await page.evaluate(() => {
      const style = document.createElement("style");
      style.id = "old-rules";
      style.textContent = "#panel-layer .agent-session-panel{border-radius:0 !important;background:var(--bg-panel) !important;box-shadow:none !important;}";
      document.head.append(style);
      const panel = document.querySelector(".agent-session-panel");
      const cs = getComputedStyle(panel);
      const result = { radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow, background: cs.backgroundColor };
      style.remove();
      return result;
    });
    assert.equal(squared.radius, 0, `${shape.name}: the tail rule the fix deleted did square the card`);
    assert.equal(squared.shadow, "none", `${shape.name}: and it dropped the shadow`);
    assert.notEqual(squared.background, "rgb(255, 255, 255)", `${shape.name}: and repainted it with the chrome's ink`);

    // The old geometry, put back: the measurement has to see it. On a desktop and a pad
    // the pin was the topbar's right edge, so the card sat flush with the window (its
    // shadow cut) and away from the count; on a phone the sheet took the column's whole
    // width and started at the header's own bottom, with no gap and no gutter.
    const pinned = await page.evaluate((mobile) => {
      const layer = document.getElementById("panel-layer");
      const topbar = document.querySelector(".app-topbar").getBoundingClientRect();
      const panel = document.querySelector(".agent-session-panel").getBoundingClientRect();
      if (mobile) {
        layer.style.left = `${topbar.left}px`;
        layer.style.width = `${topbar.width}px`;
        layer.style.top = `${topbar.bottom}px`;
      } else {
        layer.style.left = `${topbar.right - panel.width}px`;
      }
      const moved = document.querySelector(".agent-session-panel").getBoundingClientRect();
      const chip = document.querySelector(".app-topbar-subagents").getBoundingClientRect();
      return {
        distance: Math.abs(moved.left - chip.left),
        gap: moved.top - topbar.bottom,
        flushWithWindow: moved.right > window.innerWidth - 6,
        flushWithHeader: moved.left < 6 || moved.right > window.innerWidth - 6,
      };
    }, shape.mobile);
    assert.ok(pinned.flushWithWindow || pinned.flushWithHeader,
      `${shape.name}: the old geometry sat the card flush with an edge, so its shadow was cut`);
    if (shape.mobile) {
      assert.ok(pinned.gap < 1, `${shape.name}: the old sheet was welded to the header (gap ${pinned.gap.toFixed(1)}px)`);
    } else {
      assert.ok(pinned.distance > 40,
        `${shape.name}: the old right-edge pin put the card ${pinned.distance.toFixed(0)}px from the count that opens it`);
    }

    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`the Agents panel is a rounded, shadowed card under its count (desktop, pad) and centred on a phone — ${out}`);
