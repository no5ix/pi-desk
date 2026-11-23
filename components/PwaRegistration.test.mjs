import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A service worker outlives the server that installed it. It is scoped to the origin
// (scheme + host + port) and answers `/_next/static/**` cache-first, and development chunk
// URLs are not content-hashed. So a browser that once opened the built app on
// 127.0.0.1:30141 (`npm start`, the packaged app) keeps feeding the previous build's
// bundles to `npm run dev` on the same port: the page shows none of the new code, and
// React reports the fresh HTML against the old bundle as a hydration mismatch.

const source = readFileSync(new URL("./PwaRegistration.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("development removes any worker left from a production run, with its caches", () => {
  const dev = source.match(/if \(process\.env\.NODE_ENV !== "production"\) \{\n\s*forgetWorkers\(\);\n\s*return;\n\s*\}/);
  assert.ok(dev, "development registers nothing and drops the old worker before returning");
  const helper = source.match(/function forgetWorkers\(\): void \{[\s\S]*?\n\}/)[0];
  assert.match(helper, /navigator\.serviceWorker\s*\n?\s*\.getRegistrations\(\)/);
  assert.match(helper, /registrations\.forEach\(\(registration\) => void registration\.unregister\(\)\)/);
  assert.match(helper, /key\.startsWith\("pi-web-"\)/, "Cache Storage survives unregistration, so the filled caches go too");
  assert.match(helper, /caches\.delete\(key\)/);
  assert.match(helper, /\.catch\(\(\) => \{\}\);/, "a browser that refuses the call must not break the page");
});

test("the desktop shell keeps its own removal path", () => {
  assert.match(source, /if \(isTauriDesktop\(\)\) \{\n\s*forgetWorkers\(\);\n\s*return;\n\s*\}/);
});

test("production still installs the offline worker", () => {
  assert.match(source, /if \(!\("serviceWorker" in navigator\)\) \{\n\s*return;\n\s*\}/);
  assert.match(source, /const scriptUrl = `\/sw\.js\?v=\$\{encodeURIComponent\(appVersion\)\}`;/,
    "the version query keys the cache name, so a new release replaces the old cache");
  assert.match(source, /navigator\.serviceWorker\.register\(scriptUrl, \{\n\s*scope: "\/",\n\s*updateViaCache: "none",\n\s*\}\)/);
  assert.match(source, /if \(window\.self !== window\.top\) return;/,
    "the relay phone shell's tunnel worker keeps the scope on a framed page");
});

test("the worker keeps /api/ and its own script off the cache", () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(sw, /if \(url\.pathname\.startsWith\("\/api\/"\) \|\| url\.pathname === "\/sw\.js"\) return;/);
  assert.match(sw, /if \(request\.mode === "navigate"\) \{\n\s*event\.respondWith\(answerNavigation\(request\)\);/,
    "navigations are answered by the worker, never from the cache");
  assert.match(sw, /async function answerNavigation[\s\S]*?setTimeout\(\(\) => controller\.abort\(\), NAVIGATION_TIMEOUT_MS\)[\s\S]*?fetch\(request, \{ signal: controller\.signal \}\)/,
    "network-first with a bounded wait, so the HTML is the server's current render");
  assert.match(sw, /fallbackPage\(controller\.signal\.aborted \? UNAVAILABLE_URL : OFFLINE_URL\)/,
    "a server that is silent and a server that is missing are different news, and both pages reload themselves");
  assert.match(sw, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.match(sw, /event\.respondWith\(cacheFirst\(request, event\)\);/,
    "content-hashed production chunks are cache-first; development registers no worker at all");
});
