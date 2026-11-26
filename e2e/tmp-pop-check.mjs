import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:30141";

/**
 * Sample a closing popup every frame: a node that leaves and comes back (the flash) shows
 * up as a frame where it is missing, and as opacity that restarts.
 */
async function sampleExit(page, selector) {
  return page.evaluate(async (sel) => {
    const frames = [];
    const start = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const el = document.querySelector(sel);
        const cs = el ? getComputedStyle(el) : null;
        frames.push({
          t: Math.round(performance.now() - start),
          present: Boolean(el),
          closing: el ? el.classList.contains("is-closing") : false,
          opacity: cs ? Number(Number(cs.opacity).toFixed(2)) : null,
          name: cs ? cs.animationName : null,
        });
        if (performance.now() - start < 260) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return frames;
  }, selector);
}

function verdict(frames) {
  const present = frames.filter((f) => f.present);
  const gaps = [];
  let lost = 0;
  for (const f of frames) {
    if (!f.present && lost === 0) gaps.push(f.t);
    if (f.present) lost = 0;
    else lost++;
  }
  const first = present[0]?.opacity ?? null;
  const last = present[present.length - 1]?.opacity ?? null;
  const names = [...new Set(present.map((f) => f.name))];
  const closingAll = present.every((f) => f.closing);
  // The flash: present, gone, present again.
  const vanished = gaps.length > 0 && frames.some((f, i) => !f.present && frames.slice(i + 1).some((g) => g.present));
  return {
    frames: frames.length,
    presentFrames: present.length,
    vanishedAndReturned: vanished,
    firstOpacity: first,
    lastOpacity: last,
    animations: names,
    closingFromFirstFrame: closingAll,
    ok: !vanished && closingAll && first >= 0.9 && last <= 0.05,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const list = await (await fetch(`${BASE}/api/sessions`)).json();
const target = list.sessions.find((s) => s.messageCount > 2) || list.sessions[0];
await page.goto(`${BASE}/?session=${encodeURIComponent(target.id)}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const byLabel = (text) => `button[aria-label="${text}"]`;
const surfaces = [
  ["topbar More menu", ".app-topbar-more-menu", byLabel("More session actions")],
  ["header card (Agents / stats)", ".top-panel-card", "button.app-topbar-context-hit"],
  ["projects menu", ".project-view-menu", byLabel("Projects menu")],
  ["reasoning menu", ".composer-run-menu", byLabel("Change reasoning level")],
  ["tool preset menu", ".composer-tool-menu", byLabel("Change tool preset")],
  ["model picker", ".native-popover.app-menu[role=listbox]", "button[aria-label$='Change model']"],
];

let okCount = 0;
for (const [label, selector, trigger] of surfaces) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(220);
  const clicked = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, trigger);
  if (!clicked) { console.log(`\n${label}: trigger ${trigger} not found — skipped`); continue; }
  await page.waitForSelector(selector, { state: "attached", timeout: 5000 }).catch(() => {});
  const opened = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: cs.animationDuration, origin: cs.getPropertyValue("transform-origin").trim() };
  }, selector);
  await page.keyboard.press("Escape");
  const frames = await sampleExit(page, selector);
  const v = verdict(frames);
  console.log(`\n${label}`);
  console.log(`  open  ${JSON.stringify(opened)}`);
  console.log(`  exit  ${JSON.stringify(v)}`);
  if (v.ok) okCount += 1;
  else console.log(`  sample ${JSON.stringify(frames.slice(0, 8))}`);
}

// The header tip: hover, then leave.
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const tip = page.locator(".app-topbar-project-hit").first();
await tip.hover();
await page.waitForSelector(".app-topbar-tip", { state: "attached", timeout: 5000 }).catch(() => {});
const tipOpen = await page.evaluate(() => {
  const el = document.querySelector(".app-topbar-tip");
  return el ? { name: getComputedStyle(el).animationName } : null;
});
await page.mouse.move(12, 720);
const tipFrames = await sampleExit(page, ".app-topbar-tip");
console.log("\nheader tip");
console.log(`  open  ${JSON.stringify(tipOpen)}`);
console.log(`  exit  ${JSON.stringify(verdict(tipFrames))}`);

// Reduced motion: no animation, and the node still leaves.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.waitForTimeout(200);
await page.evaluate((sel) => document.querySelector(sel)?.click(), byLabel("More session actions"));
await page.waitForSelector(".app-topbar-more-menu", { state: "attached" });
const rmOpen = await page.evaluate(() => {
  const el = document.querySelector(".app-topbar-more-menu");
  return el ? getComputedStyle(el).animationName : null;
});
await page.keyboard.press("Escape");
const rmFrames = await sampleExit(page, ".app-topbar-more-menu");
const rm = verdict(rmFrames);
console.log("\nreduced motion — topbar More menu");
console.log(`  open animation ${rmOpen}`);
console.log(`  exit  ${JSON.stringify(rm)}`);

await browser.close();
