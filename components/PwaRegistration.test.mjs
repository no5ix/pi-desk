import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A service worker outlives the server that installed it. It is scoped to the origin
// (scheme + host + port) and answers `/_next/static/**` cache-first, and development chunk
// URLs are not content-hashed. So a browser that once opened the built app on
// 127.0.0.1:30141 (`npm start`, the packaged app) keeps feeding the previous build's bundles
// to `npm run dev` on the same port: the page shows none of the new code, and React reports
// the fresh HTML against the old bundle as a hydration mismatch.
//
// Development therefore registers the same worker with `?v=dev`, and that worker is push
// only: no precache, no cache-first assets, no answered navigations, and its activate
// deletes every `pi-web-*` cache the production run left. The dev page keeps running the
// code on disk, and a phone added to the Home Screen can subscribe to notifications through
// `npm run dev` — which is how the phone path is exercised at all.

const source = readFileSync(new URL("./PwaRegistration.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("development registers the worker too, as the push-only build", () => {
  assert.match(source, /const version = process\.env\.NODE_ENV !== "production" \? "dev" : appVersion;/,
    "?v=dev is what tells the worker it is in development and must stay out of the cache");
  assert.doesNotMatch(source, /NODE_ENV !== "production"\) \{\s*\n\s*forgetWorkers\(\);/,
    "unregistering everything is why a phone on `npm run dev` had no notification subscription");
  assert.match(source, /if \(isTauriDesktop\(\)\) \{\n\s*forgetWorkers\(\);\n\s*return;\n\s*\}/,
    "the desktop shell has no offline requirement and drops any worker it finds");

  const helper = source.match(/function forgetWorkers\(\): void \{[\s\S]*?\n\}/)[0];
  assert.match(helper, /navigator\.serviceWorker\s*\n?\s*\.getRegistrations\(\)/);
  assert.match(helper, /registrations\.forEach\(\(registration\) => void registration\.unregister\(\)\)/);
  assert.match(helper, /key\.startsWith\("pi-web-"\)/, "Cache Storage survives unregistration, so the filled caches go too");
  assert.match(helper, /\.catch\(\(\) => \{\}\);/, "a browser that refuses the call must not break the page");
});

test("the worker is registered for the whole scope, cache-busted by version", () => {
  assert.match(source, /if \(!\("serviceWorker" in navigator\)\) \{\n\s*return;\n\s*\}/);
  assert.match(source, /const scriptUrl = `\/sw\.js\?v=\$\{encodeURIComponent\(version\)\}`;/,
    "the version query keys the cache name in production, and marks the push-only build in development");
  assert.match(source, /navigator\.serviceWorker\.register\(scriptUrl, \{\n\s*scope: "\/",\n\s*updateViaCache: "none",\n\s*\}\)/);
  assert.match(source, /if \(window\.self !== window\.top\) return;/,
    "the relay phone shell's tunnel worker keeps the scope on a framed page");
});

test("the worker keeps /api/ and its own script off the cache", () => {
  assert.match(worker, /if \(url\.pathname\.startsWith\("\/api\/"\) \|\| url\.pathname === "\/sw\.js"\) return;/);
  assert.match(worker, /if \(request\.mode === "navigate"\) \{\n\s*event\.respondWith\(answerNavigation\(request\)\);/,
    "navigations are answered by the worker, never from the cache");
  assert.match(worker, /async function answerNavigation[\s\S]*?setTimeout\(\(\) => controller\.abort\(\), NAVIGATION_TIMEOUT_MS\)[\s\S]*?fetch\(request, \{ signal: controller\.signal \}\)/,
    "network-first with a bounded wait, so the HTML is the server's current render");
  assert.match(worker, /fallbackPage\(controller\.signal\.aborted \? UNAVAILABLE_URL : OFFLINE_URL\)/,
    "a server that is silent and a server that is missing are different news, and both pages reload themselves");
  assert.match(worker, /url\.pathname\.startsWith\("\/_next\/static\/"\)/);
  assert.match(worker, /event\.respondWith\(cacheFirst\(request, event\)\);/,
    "content-hashed production chunks are cache-first");
});

test("the development worker handles push and nothing that touches the cache", () => {
  assert.match(worker, /const OFFLINE_MODE = CACHE_VERSION !== "dev";/,
    "the version query the page registers is what separates the two builds");
  assert.match(worker, /self\.addEventListener\("fetch", \(event\) => \{\n\s*\/\/[^\n]*\n\s*if \(!OFFLINE_MODE\) return;/,
    "every dev request goes to the dev server, so the page runs the code on disk");
  assert.match(worker, /if \(!OFFLINE_MODE\) \{\n\s*\/\/[^\n]*\n\s*event\.waitUntil\(self\.skipWaiting\(\)\);\n\s*return;\n\s*\}/,
    "no precache in development");
  assert.match(worker, /if \(!OFFLINE_MODE\) \{[\s\S]*?key\.startsWith\(`\$\{CACHE_PREFIX\}-`\)[\s\S]*?caches\.delete\(key\)[\s\S]*?self\.clients\.claim\(\)\),\n\s*\);\n\s*return;\n\s*\}/,
    "a production run's caches are deleted, because a worker is scoped to the origin and outlives the server");
});
