import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:30141";

async function popState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      closing: el.classList.contains("is-closing"),
      name: cs.animationName,
      dur: cs.animationDuration,
      pointer: cs.pointerEvents,
      origin: cs.getPropertyValue("transform-origin").trim(),
    };
  }, selector);
}

async function check(page, label, selector, openSelector) {
  await page.evaluate(() => document.body.click());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.evaluate((sel) => document.querySelector(sel)?.click(), openSelector);
  await page.waitForSelector(selector, { state: "attached", timeout: 5000 });
  const opened = await popState(page, selector);
  await page.keyboard.press("Escape");
  const closing = await popState(page, selector);
  await page.waitForTimeout(320);
  const after = await page.evaluate((sel) => document.querySelectorAll(sel).length, selector);
  const entrance = opened && /in$/.test(opened.name);
  const exit = closing && closing.closing && closing.name === "app-pop-out" && closing.pointer === "none";
  console.log(`\n${label}`);
  console.log(`  open    ${JSON.stringify(opened)}`);
  console.log(`  closing ${JSON.stringify(closing)}`);
  console.log(`  nodes after exit ${after}`);
  console.log(`  => ${entrance && exit && after === 0 ? "OK" : "FAIL"}`);
  return entrance && exit && after === 0;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const list = await (await fetch(`${BASE}/api/sessions`)).json();
const target = list.sessions.find((s) => s.messageCount > 2) || list.sessions[0];
await page.goto(`${BASE}/?session=${encodeURIComponent(target.id)}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const byLabel = (text) => `button[aria-label="${text}"]`;
const results = [];
results.push(await check(page, "topbar More menu", ".app-topbar-more-menu", byLabel("More session actions")));
results.push(await check(page, "header card (.top-panel-card)", ".top-panel-card", "button.app-topbar-context-hit, button[aria-label^='Context:']"));
results.push(await check(page, "projects menu (.project-view-menu)", ".project-view-menu", byLabel("Projects menu")));
results.push(await check(page, "reasoning menu (.composer-run-menu)", ".composer-run-menu", byLabel("Change reasoning level")));
results.push(await check(page, "tool preset menu (.composer-tool-menu)", ".composer-tool-menu", byLabel("Change tool preset")));
results.push(await check(page, "automation menu", ".composer-controls-strip ~ .native-popover.app-menu, .native-popover.app-menu[role=menu]", byLabel("Session automation")));
results.push(await check(page, "model picker", ".native-popover.app-menu[role=listbox]", "button[aria-label$='Change model']"));

// The header's tip: hover the project chip, then move the pointer away.
await page.locator(".app-topbar-project-hit").first().hover();
await page.waitForSelector(".app-topbar-tip", { state: "attached", timeout: 5000 });
const tipOpen = await popState(page, ".app-topbar-tip");
await page.mouse.move(12, 720);
await page.waitForTimeout(20);
const tipClosing = await popState(page, ".app-topbar-tip");
await page.waitForTimeout(320);
const tipAfter = await page.evaluate(() => document.querySelectorAll(".app-topbar-tip").length);
console.log("\nheader tip (.app-topbar-tip)");
console.log(`  open    ${JSON.stringify(tipOpen)}`);
console.log(`  closing ${JSON.stringify(tipClosing)}`);
console.log(`  nodes after exit ${tipAfter}`);
const tipOk = /in$/.test(tipOpen?.name || "") && tipClosing?.closing && tipClosing?.name === "app-pop-out" && tipAfter === 0;
console.log(`  => ${tipOk ? "OK" : "FAIL"}`);

// Reduced motion: the entrance and the exit both give up, and the node still leaves.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.evaluate((sel) => document.querySelector(sel)?.click(), byLabel("More session actions"));
await page.waitForSelector(".app-topbar-more-menu", { state: "attached" });
const rmOpen = await popState(page, ".app-topbar-more-menu");
await page.keyboard.press("Escape");
const rmClosing = await popState(page, ".app-topbar-more-menu");
await page.waitForTimeout(260);
const rmAfter = await page.evaluate(() => document.querySelectorAll(".app-topbar-more-menu").length);
console.log("\nreduced motion — topbar More menu");
console.log(`  open    ${JSON.stringify(rmOpen)}`);
console.log(`  closing ${JSON.stringify(rmClosing)}`);
console.log(`  nodes after exit ${rmAfter}`);
console.log(`  => ${rmOpen?.name === "none" && rmClosing?.closing && rmClosing?.name === "none" && rmAfter === 0 ? "OK" : "FAIL"}`);

const ok = results.every(Boolean) && tipOk;
console.log(`\nsurfaces OK: ${results.filter(Boolean).length}/${results.length}, tip ${tipOk ? "ok" : "FAIL"}`);
await browser.close();
