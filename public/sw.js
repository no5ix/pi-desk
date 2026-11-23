const CACHE_PREFIX = "pi-web";
const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC_CACHE = `${CACHE_PREFIX}-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";
// The two fallback pages split the two failures. A port that refuses the connection has no
// server; a port that accepts it and never answers has a server that is starting, busy, or
// shut out of the browser's six connections to this origin. Telling them apart matters: the
// second heals itself in a second, and "reconnect to the local server" is the wrong advice.
const UNAVAILABLE_URL = "/unavailable.html";
const RECOVERY_SCRIPT_URL = "/offline-recovery.js";
const PRECACHE_URLS = [
  OFFLINE_URL,
  UNAVAILABLE_URL,
  RECOVERY_SCRIPT_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
// A reachable port backed by a dead upstream accepts the connection and then
// never answers: fetch() neither resolves nor rejects, so the navigation hangs
// forever instead of falling back to offline.html. Bound every network wait.
// The budget is a time-to-first-byte ceiling, and it is deliberately generous: a
// production server that is mid-task (a session starting, a big session opening) answers
// a document in a few seconds, and the browser's connection pool can queue a refresh
// behind the page's own event streams. Eight seconds turned both into a fallback page a
// healthy server never deserved; the fallback pages reload themselves now, so a long
// budget only delays the honest message, never the recovery.
const NAVIGATION_TIMEOUT_MS = 15000;
const ASSET_TIMEOUT_MS = 8000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(`${CACHE_PREFIX}-`) && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Session data and live agent traffic must always come from the local server.
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  // The manifest is runtime configuration. Bypass even entries left in an old
  // cache, including requests with a query string or navigation mode.
  if (url.pathname === "/manifest.webmanifest") return;

  if (request.mode === "navigate") {
    event.respondWith(answerNavigation(request));
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    PRECACHE_URLS.includes(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(request, event));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // Ignore malformed or missing push payloads.
  }
  const { title, body, url, tag, sentAt } = payload;
  if (typeof title !== "string" || !title || typeof body !== "string" || !body) return;

  // Always surface a system notification. iOS revokes the push subscription
  // when a service worker handles a push without showing a notification, so
  // suppressing the notification while a window is visible poisons the
  // subscription in the background-delivery case. Notifications sharing a tag
  // replace each other instead of stacking, so a visible window merely sees
  // the completion notification re-appear.
  event.waitUntil(showPushNotification(title, body, url, tag, sentAt));
});

// An open page announces a completion itself from its event stream, and the
// push for the same completion lands a moment later. Both carry the session's
// tag (lib/notification-tags.ts, the tag the payload is built with); with
// renotify the push replaces the page's notification and alerts a second time
// (#1515). A same-tag notification shown this recently is that completion's, so
// the push replaces it quietly. An older one belongs to an earlier task and the
// push alerts again (#701).
const RECENT_NOTIFICATION_MS = 10000;

// A push the push service sat on is not a finished task. The server sends with a short
// TTL (lib/notification-tags.ts PUSH_TTL_SECONDS), so a phone that was off, offline, or in
// a Focus mode loses a stale notice rather than collecting it; anything that still lands
// minutes after it was sent is a queued delivery, and a stack of those is the bug people
// report as "a lot of notifications with nothing running". One quiet row under one
// catch-up tag: silent, not alerting, and collapsed by the tag, and a notification is
// still shown, because iOS revokes the subscription when a push is handled without one.
const LATE_PUSH_MAX_AGE_MS = 300000;
const LATE_PUSH_TAG = "pi-session-catchup";

async function showPushNotification(title, body, url, tag, sentAt) {
  const shownAt = Date.now();
  const data = { url: typeof url === "string" && url ? url : "/", shownAt };
  if (typeof sentAt === "number" && Number.isFinite(sentAt) && shownAt - sentAt > LATE_PUSH_MAX_AGE_MS) {
    return self.registration.showNotification(title, {
      body,
      data,
      tag: LATE_PUSH_TAG,
      renotify: false,
      silent: true,
    });
  }
  if (typeof tag !== "string" || !tag) {
    return self.registration.showNotification(title, { body, data });
  }
  const renotify = !(await hasRecentNotification(tag, shownAt));
  return self.registration.showNotification(title, { body, data, tag, renotify });
}

async function hasRecentNotification(tag, now) {
  try {
    const notifications = await self.registration.getNotifications({ tag });
    return notifications.some((notification) => {
      const shownAt = notification.data?.shownAt;
      return typeof shownAt === "number" && now - shownAt >= 0 && now - shownAt < RECENT_NOTIFICATION_MS;
    });
  } catch {
    return false;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const requestedUrl = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/";
  let targetUrl = new URL("/", self.location.origin);
  try {
    const candidate = new URL(requestedUrl, self.location.origin);
    if (candidate.origin === self.location.origin) targetUrl = candidate;
  } catch {
    // Keep the root URL when notification data is malformed.
  }

  event.waitUntil(focusOrOpenWindow(targetUrl.href));
});

async function focusOrOpenWindow(targetUrl) {
  const windowClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const exactClient = windowClients.find((client) => client.url === targetUrl);
  const candidates = exactClient
    ? [exactClient, ...windowClients.filter((client) => client !== exactClient)]
    : windowClients;

  for (const client of candidates) {
    try {
      const targetClient = client.url === targetUrl
        ? client
        : (await client.navigate(targetUrl)) ?? client;
      await targetClient.focus();
      return;
    } catch {
      // The window may have closed between matchAll and focus; try the next one.
    }
  }

  await self.clients.openWindow(targetUrl);
}

/**
 * A navigation is answered by the server whenever it answers in time. The fallback page
 * is picked by the kind of failure: no connection at all (offline.html) or a connection
 * that stays silent past the budget (unavailable.html). Both pages poll the server and
 * reload themselves, so a refresh that lost a race with the browser's connection pool
 * recovers without a second refresh.
 */
async function answerNavigation(request) {
  // The browser already knows this machine has no network: do not spend the budget.
  if (navigator?.onLine === false) return fallbackPage(OFFLINE_URL);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    return await fetch(request, { signal: controller.signal });
  } catch {
    // Our abort is the timeout; anything else (connection refused, reset, DNS) means the
    // server is not there to answer.
    return fallbackPage(controller.signal.aborted ? UNAVAILABLE_URL : OFFLINE_URL);
  } finally {
    clearTimeout(timer);
  }
}

async function fallbackPage(url) {
  const cached = await caches.match(url);
  // A cold cache (the first load ever, or Cache Storage cleared) has nothing to show, and
  // the browser's own error page is the honest answer.
  return cached ?? Response.error();
}

/**
 * Fetch with a ceiling on the wait for the response headers (time to first
 * byte). The timer is cleared as soon as they arrive, so a response that
 * streams a long body — Next.js streams SSR output — is never cut off
 * mid-stream.
 */
async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(request, event) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetchWithTimeout(request, ASSET_TIMEOUT_MS);
  if (response.ok && response.type === "basic") {
    // Deliberately NOT awaited before returning the response.
    //
    // The SW script URL is versioned (?v=<app version>), so every upgrade
    // starts a fresh cache: the first load after an upgrade misses on every
    // chunk and writes them all at once. Awaiting each write here held every
    // response behind Cache Storage I/O, which stalled navigations past
    // NAVIGATION_TIMEOUT_MS — the browser showed the offline page while the
    // local server was perfectly healthy. waitUntil keeps this worker alive
    // until the write finishes without blocking the response.
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((cache) => cache.put(request, copy))
        .catch(() => {
          // A failed write only costs one network re-fetch next time.
        }),
    );
  }
  return response;
}
