import { webkit } from "playwright";

const init = () => {
  const real = window.visualViewport;
  const own = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const proto = Object.getOwnPropertyDescriptor(window.prototype ?? {}, "visualViewport");
  let defineResult = "not-attempted";
  const proxy = { get height() { return 508; }, get width() { return real.width; }, get scale() { return real.scale; }, get offsetTop() { return 0; }, get offsetLeft() { return 0; }, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} };
  try { Object.defineProperty(window, "visualViewport", { configurable: true, get: () => proxy }); defineResult = "ok"; } catch (e) { defineResult = String(e); }
  let ihResult = "not-attempted";
  try { Object.defineProperty(window, "innerHeight", { configurable: true, get: () => 844 }); ihResult = "ok"; } catch (e) { ihResult = String(e); }
  window.__probe = {
    hasOwn: !!own, hasProto: !!proto, defineResult, ihResult,
    innerHeight: window.innerHeight, innerWidth: window.innerWidth,
    vvH: real ? real.height : null, vvW: real ? real.width : null, scale: real ? real.scale : null,
    nowVvH: window.visualViewport.height,
  };
};

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await page.addInitScript(init);
await page.goto("data:text/html,<!doctype html><html><head><meta name=viewport content='width=device-width, initial-scale=1, viewport-fit=cover'></head><body style='margin:0'><div style='width:390px;height:600px'>x</div></body></html>");
console.log(JSON.stringify(await page.evaluate(() => window.__probe), null, 1));
console.log("after load:", JSON.stringify(await page.evaluate(() => ({ ih: window.innerHeight, iw: window.innerWidth, vvH: window.visualViewport.height, vvW: window.visualViewport.width, scale: window.visualViewport.scale, scrollW: document.documentElement.scrollWidth }))));
await browser.close();
