"use client";

import { useEffect } from "react";
import { isTauriDesktop } from "@/lib/desktop-updater";

/**
 * Drop every worker registered for this origin, and the caches it filled.
 *
 * A registered worker outlives the server that installed it: it is scoped to the origin
 * (scheme + host + port), and it answers `/_next/static/**` cache-first. Unregistering
 * leaves the Cache Storage behind, so a later server on the same port — a production build
 * turned into `npm run dev`, a worktree that took the main checkout's port — keeps serving
 * the previous build's bundles. The page then renders HTML from the current server with
 * JavaScript from the old one, which React reports as a hydration mismatch and the user
 * sees as "my changes are not there".
 *
 * The desktop shell needs this outright: it has no offline requirement and no reason to
 * keep a worker between installs. A browser that mixes a production run and `npm run dev`
 * on one origin is handled by the dev worker itself, whose activate deletes every
 * `pi-web-*` cache.
 */
function forgetWorkers(): void {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      registrations.forEach((registration) => void registration.unregister());
      if (typeof caches === "undefined") return;
      return caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("pi-web-"))
            .map((key) => caches.delete(key)),
        ),
      );
    })
    .catch(() => {});
}

export function PwaRegistration() {
  useEffect(() => {
    // The desktop shell has no offline requirement, and a registered worker
    // persists in the webview's origin-scoped cache across installs and can
    // serve stale bundles. Skip registration and drop any previous worker.
    if (isTauriDesktop()) {
      forgetWorkers();
      return;
    }
    if (!("serviceWorker" in navigator)) {
      return;
    }
    // Framed by the relay's phone shell: its tunnel worker owns the "/" scope on the
    // entry host, and registering ours would replace it and cut the connection.
    if (window.self !== window.top) return;

    // Development registers the same worker as `?v=dev`, and that worker does one thing:
    // web push. It precaches nothing, answers no navigation, and clears the caches a
    // production run left on this origin, so the dev page still runs the code on disk while
    // a phone added to the Home Screen can subscribe through Tailscale and get its
    // notification — which is how the phone path gets tested at all.
    const appVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
    const version = process.env.NODE_ENV !== "production" ? "dev" : appVersion;

    const register = () => {
      const scriptUrl = `/sw.js?v=${encodeURIComponent(version)}`;

      void navigator.serviceWorker.register(scriptUrl, {
        scope: "/",
        updateViaCache: "none",
      }).catch((error: unknown) => {
        console.error("Failed to register the Pi Web service worker:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
