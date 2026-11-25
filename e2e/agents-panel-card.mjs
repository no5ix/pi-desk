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
  const topbarBottom = box(document.querySelector(".app-topbar")).bottom;
  const rows = [...panel.querySelectorAll(".agent-row")].map((row) => {
    const cs = getComputedStyle(row);
    const actions = row.querySelector(".agent-row-actions");
    const status = row.querySelector(".agent-row-status");
    return {
      main: row.classList.contains("is-main"),
      selected: row.classList.contains("is-selected"),
      title: getComputedStyle(row.querySelector(".agent-row-title")).color,
      subtitle: getComputedStyle(row.querySelector(".agent-row-subtitle")).color,
      statusLeft: Math.round(box(status).left),
      statusRight: Math.round(box(status).right),
      actionsLeft: actions ? Math.round(box(actions).left) : null,
      background: cs.backgroundColor,
      shadow: cs.boxShadow,
    };
  });
  return {
    radius: parseFloat(style.borderTopLeftRadius),
    shadow: style.boxShadow,
    background: style.backgroundColor,
    panel: box(panel),
    layer: box(layer),
    layerOverflowY: getComputedStyle(layer).overflowY,
    topbarBottom,
    chipLeft: box(document.querySelector(".app-topbar-subagents")).left,
    viewport: window.innerWidth,
    rows,
  };
};

/** Text's ink as it lands on this fixture's white card: a 62% wash is the shallower
 *  colour it paints, not a bigger rgb sum. Chromium serialises `color-mix()` results in
 *  the 0..1 `color(srgb …)` form and plain custom properties as `rgb(…, …)`, so both
 *  scales are read. Higher is shallower. */
const ink = (color) => {
  const scale = /srgb|display-p3|\blab\b|\blch\b|\boklab\b|\boklch\b/i.test(color) ? 255 : 1;
  const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number).map((v, i) => (i < 3 ? v * scale : v));
  return (r + g + b) * a + 3 * 255 * (1 - a);
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
    page.on("console", (msg) => console.log(`PAGE[${shape.name}]:`, msg.text()));
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

    // The rows. The row the chat stands on paints nothing — no wash, no inset bar (the
    // user asked for both gone) — and it is named by its ink: every other row in the
    // family is shallower. The states all start on one column, buttons beside a row or
    // not, and none of them runs into the row's buttons.
    assert.ok(m.rows.length >= 3, `${shape.name}: the card lists the main agent and its runs`);
    const selected = m.rows.filter((row) => row.selected);
    assert.equal(selected.length, 1, `${shape.name}: one row is the open session`);
    assert.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(selected[0].background),
      `${shape.name}: the current row carries no highlight, got ${selected[0].background}`);
    assert.equal(selected[0].shadow, "none", `${shape.name}: and no inset bar beside its text`);
    const others = m.rows.filter((row) => !row.selected);
    assert.ok(others.every((row) => ink(row.title) > ink(selected[0].title) + 20),
      `${shape.name}: every other row's title is shallower ink than the current row's (${others.map((r) => r.title).join(" | ")} vs ${selected[0].title})`);
    assert.ok(others.every((row) => ink(row.subtitle) > ink(selected[0].subtitle) + 20),
      `${shape.name}: and its subtitle steps back with it`);
    const lefts = m.rows.map((row) => row.statusLeft);
    const spread = Math.max(...lefts) - Math.min(...lefts);
    assert.ok(spread <= 1, `${shape.name}: Running and Completed start on one column (spread ${spread}px: ${lefts.join(", ")})`);
    for (const row of m.rows) {
      if (row.actionsLeft !== null) {
        assert.ok(row.statusRight <= row.actionsLeft,
          `${shape.name}: a state never runs into the row's buttons (${row.statusRight} vs ${row.actionsLeft})`);
      }
    }
    await page.screenshot({ path: `${out}/${shape.name}.png` });

    // The rows' old layout, put back: the measurement has to see it. One `auto` track
    // for the status and the buttons, a wash and an inset bar on the selected row, and
    // every row's text in the same full ink. The row transitions its background, so the
    // probe reads it after the 120ms `--dur-fast` has settled: mid-transition the computed
    // colour is the old transparent one, and a probe that read it then proved nothing.
    const oldRows = await page.evaluate(async () => {
      const style = document.createElement("style");
      style.textContent = [
        "#panel-layer .agent-row{grid-template-columns:28px minmax(0,1fr) auto !important;}",
        "#panel-layer .agent-row.is-selected{background:var(--bg-selected) !important;box-shadow:inset 3px 0 0 var(--menu-selection-color) !important;}",
        "#panel-layer .agent-row .agent-row-title,#panel-layer .agent-row .agent-row-subtitle{color:var(--text) !important;}",
      ].join("");
      document.head.append(style);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const rows = [...document.querySelectorAll(".agent-row")].map((row) => ({
        selected: row.classList.contains("is-selected"),
        statusLeft: Math.round(row.querySelector(".agent-row-status").getBoundingClientRect().left),
        background: getComputedStyle(row).backgroundColor,
        shadow: getComputedStyle(row).boxShadow,
        title: getComputedStyle(row.querySelector(".agent-row-title")).color,
      }));
      style.remove();
      return rows;
    });
    const oldLefts = oldRows.map((row) => row.statusLeft);
    const oldSpread = Math.max(...oldLefts) - Math.min(...oldLefts);
    assert.ok(oldSpread > 20,
      `${shape.name}: the one-track layout scattered the states ${oldSpread}px apart, so the measurement sees the fix`);
    const oldSelected = oldRows.find((row) => row.selected);
    assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(oldSelected.background),
      `${shape.name}: and it saw the old wash on the current row (${oldSelected.background})`);
    assert.notEqual(oldSelected.shadow, "none", `${shape.name}: and the old inset bar (${oldSelected.shadow})`);
    assert.ok(oldRows.every((row) => row.title === oldRows[0].title),
      `${shape.name}: and every row wore the same ink, so nothing ranked`);

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
