import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:30141";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
const list = await (await fetch(`${BASE}/api/sessions`)).json();
const target = list.sessions.find((s) => s.messageCount > 2) || list.sessions[0];
await page.goto(`${BASE}/?session=${encodeURIComponent(target.id)}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const labels = await page.evaluate(() =>
  [...document.querySelectorAll("button[aria-label], button[title]")]
    .map((b) => b.getAttribute("aria-label") || b.getAttribute("title"))
    .filter(Boolean),
);
console.log(labels.join("\n"));
await browser.close();
