import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:30141";

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
  let gap = false;
  for (let i = 0; i < frames.length; i += 1) {
    if (!frames[i].present && frames.slice(i + 1).some((g) => g.present)) gap = true;
  }
  return {
    frames: frames.length,
    presentFrames: present.length,
    vanishedAndReturned: gap,
    firstOpacity: present[0]?.opacity ?? null,
    lastOpacity: present[present.length - 1]?.opacity ?? null,
    animations: [...new Set(present.map((f) => f.name))],
    closingFromFirstFrame: present.length > 0 && present.every((f) => f.closing),
    ok: !gap && present.length > 0 && present.every((f) => f.closing)
      && (present[0]?.opacity ?? 0) >= 0.9 && (present[present.length - 1]?.opacity ?? 1) <= 0.05,
  };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const list = await (await fetch(`${BASE}/api/sessions`)).json();
const target = list.sessions.find((s) => s.messageCount > 2) || list.sessions[0];
await page.goto(`${BASE}/?session=${encodeURIComponent(target.id)}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const surfaces = [
  ["header card (context / stats)", ".top-panel-card", "button[aria-label^='Context:']"],
  ["reasoning menu", ".composer-run-menu", "button[aria-label='Change reasoning level']"],
  ["tool preset menu", ".composer-tool-menu", "button[aria-label='Change tool preset']"],
  ["model picker", ".native-popover.app-menu[role=listbox]", "button[aria-label$='Change model']"],
  ["session automation menu", ".composer-controls-strip ~ .native-popover.app-menu", "button[aria-label='Session automation']"],
];

for (const [label, selector, trigger] of surfaces) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(220);
  const box = await page.locator(trigger).first().boundingBox().catch(() => null);
  if (!box) { console.log(`\n${label}\n  trigger missing: ${trigger}`); continue; }
  await page.locator(trigger).first().click();
  const appeared = await page.waitForSelector(selector, { state: "attached", timeout: 4000 })
    .then(() => true).catch(() => false);
  if (!appeared) { console.log(`\n${label}\n  panel never opened: ${selector}`); continue; }
  const opened = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const cs = el ? getComputedStyle(el) : null;
    return cs ? { name: cs.animationName, dur: cs.animationDuration } : null;
  }, selector);
  await page.keyboard.press("Escape");
  console.log(`\n${label}`);
  console.log(`  open  ${JSON.stringify(opened)}`);
  console.log(`  exit  ${JSON.stringify(verdict(await sampleExit(page, selector)))}`);
}
await browser.close();
