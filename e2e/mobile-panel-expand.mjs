import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The phone's panel expand, measured at a phone width.
 *
 * The right panel on a phone is an overlay card below the chat's topbar, and the
 * strip's expand button is kept there for the Git view: a branch tree, a commit
 * list and a diff do not fit in a short card. Pressing it has to change the card
 * into the screen. While the shell kept the full-width class desktop-only, the
 * button was pressed, its state moved, and the card did not — so the check asserts
 * the two boxes, and the last pass wires the button to nothing and expects the
 * card to be unchanged.
 */
const out = "test-results/mobile-panel-expand";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/mobile-panel-expand.fixture.jsx"],
  bundle: true,
  platform: "browser",
  outfile: `${out}/fixture.js`,
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = await readFile(`${out}/fixture.js`);
const sheets = ["app/globals.css", "app/settings.css", "app/native-theme.css"];

function serve() {
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    // The app's sheets, served as the app serves them: one <link> each, in the
    // app's order. Concatenated into one sheet, a parse error in one file takes
    // the others with it, and a phone media query silently stops applying.
    const index = sheets.findIndex((path) => `/${path}` === req.url);
    if (index >= 0) {
      readFile(sheets[index], "utf8").then((text) => {
        res.setHeader("Content-Type", "text/css");
        res.end(text);
      });
      return;
    }
    res.setHeader("Content-Type", "text/html");
    // A phone viewport needs the meta tag: without it the emulated browser lays
    // the page out at 980px, and every phone media query misses.
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${sheets.map((path) => `<link rel="stylesheet" href="/${path}">`).join("")}</head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function measure() {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, display: s.display, visibility: s.visibility };
  };
  const button = document.querySelector(".file-panel-expand-button");
  return {
    panel: box(".right-panel-container"),
    strip: box(".right-panel-tab-strip"),
    button: box(".file-panel-expand-button"),
    pressed: button?.getAttribute("aria-pressed"),
    label: button?.getAttribute("aria-label"),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  };
}

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const failures = [];

async function openPage(query) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  await page.goto(`http://127.0.0.1:${port}/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".file-panel-expand-button", { timeout: 15000 });
  await page.waitForTimeout(400);
  return page;
}

const press = async (page) => {
  await page.click(".file-panel-expand-button");
  await page.waitForTimeout(450);
};

for (const query of ["", "unfixed=1"]) {
  const unfixed = query.includes("unfixed");
  const label = unfixed ? "the un-fixed shell" : "the phone panel";
  const page = await openPage(query);
  const card = await page.evaluate(measure);
  if (!card.button || card.button.display === "none") {
    failures.push(`${label}: the panel's expand button is hidden on a phone`);
  } else {
    if (!(card.panel.right - card.button.right <= 12 && card.button.right <= card.panel.right + 0.5)) {
      failures.push(`${label}: the expand button is not in the header row's right end (button right ${card.button.right.toFixed(1)}, panel right ${card.panel.right.toFixed(1)})`);
    }
    if (!(card.strip && card.button.y >= card.strip.y - 0.5 && card.button.bottom <= card.strip.bottom + 0.5)) {
      failures.push(`${label}: the expand button is not inside the panel's header row (button ${card.button.y.toFixed(1)}..${card.button.bottom.toFixed(1)}, strip ${card.strip?.y.toFixed(1)}..${card.strip?.bottom.toFixed(1)})`);
    }
  }
  if (Math.abs(card.panel.w - card.innerWidth) > 1) {
    failures.push(`${label}: the phone's card does not span the width (width ${card.panel.w.toFixed(1)}, window ${card.innerWidth})`);
  }
  // The card is not the screen: it leaves the chat's topbar above it, by a top
  // inset or by stopping short of the bottom.
  const isViewport = (box, innerHeight) => box.y <= 1 && box.bottom >= innerHeight - 1;
  if (isViewport(card.panel, card.innerHeight)) {
    failures.push(`${label}: the unexpanded card is already the whole viewport, so the expand button has nothing to do`);
  }

  await press(page);
  const full = await page.evaluate(measure);
  if (unfixed) {
    // The bug this pass exists to see: the press moves the state and the card
    // stays a card. If the un-fixed flow changed the box, the fixed flow's
    // assertion above is not measuring the class.
    if (Math.abs(full.panel.y - card.panel.y) > 1 || Math.abs(full.panel.h - card.panel.h) > 1) {
      failures.push(`${label}: the un-fixed press moved the card (y ${card.panel.y.toFixed(1)} → ${full.panel.y.toFixed(1)}), so the box is not what the class decides`);
    }
  } else {
    if (full.pressed !== "true") failures.push(`${label}: the button did not report pressed after the press`);
    if (full.label !== "Shrink back to a card") failures.push(`${label}: the button's word after expanding is "${full.label}"`);
    if (!isViewport(full.panel, full.innerHeight)) {
      failures.push(`${label}: expanded, the card is not the viewport (top ${full.panel.y.toFixed(1)}, bottom ${full.panel.bottom.toFixed(1)}, viewport ${full.innerHeight})`);
    }
    await press(page);
    const back = await page.evaluate(measure);
    if (back.pressed !== "false") failures.push(`${label}: the second press did not restore the card`);
    if (isViewport(back.panel, back.innerHeight)) failures.push(`${label}: restored, the card is still the whole viewport`);
    if (back.label !== "Expand to the whole screen") failures.push(`${label}: the button's word after restoring is "${back.label}"`);
  }
  await page.close();
}

await browser.close();
server.close();

if (failures.length) {
  console.error("FAILURES:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("e2e/mobile-panel-expand.mjs: the phone's expand button is in the card's upper-right, and it turns the card into the viewport and back");
