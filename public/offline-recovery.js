/*
 * Both fallback pages run this. The server that was not there, or was too busy to answer,
 * is usually able to answer a second later, and the page that gave up should come back by
 * itself: that second refresh is the thing users had to learn.
 *
 * The poll is a plain fetch of the page's own URL. The worker only answers navigations,
 * static assets, and its own two pages, so a plain same-origin fetch is answered by the
 * network — the reply is the server's, never the cached page's.
 *
 * A reload is only earned by `required` consecutive answered polls, and `required` doubles
 * with every reload this file causes (kept in localStorage, so the next page load inherits
 * it). A server that answers a fetch, but cannot win the browser's six connections for a
 * document, therefore backs off instead of reloading forever. After MAX_RELOADS in
 * RELOAD_WINDOW_MS the page stops and leaves the button to the user.
 *
 * The auto-start guard at the bottom keeps this file importable by
 * public/offline-recovery.test.mjs.
 */

const OFFLINE_RECOVERY_MS = 2000;
const OFFLINE_RECOVERY_MAX_RELOADS = 8;
const OFFLINE_RECOVERY_WINDOW_MS = 10 * 60 * 1000;
const OFFLINE_RECOVERY_KEY = "pi-web:offline-recovery";

globalThis.piWebOfflineRecovery = {
  MAX_RELOADS: OFFLINE_RECOVERY_MAX_RELOADS,
  POLL_MS: OFFLINE_RECOVERY_MS,
  /** The wiring a real page uses. Exported for public/offline-recovery.test.mjs. */
  browserEnv,
  /**
   * @param env {{
   *   fetchPage: () => Promise<unknown>,
   *   reload: () => void,
   *   now: () => number,
   *   read: () => unknown,
   *   write: (value: unknown) => void,
   *   setStatus: (text: string) => void,
   *   every: (intervalMs: number, tick: () => void) => (() => void),
   * }}
   */
  start(env) {
    const readState = () => {
      const saved = (() => {
        try {
          return env.read();
        } catch {
          return null;
        }
      })();
      const now = env.now();
      const reloads = Array.isArray(saved?.reloads)
        ? saved.reloads.filter((at) => typeof at === "number" && now - at < OFFLINE_RECOVERY_WINDOW_MS)
        : [];
      const required = Number.isInteger(saved?.required) && saved.required > 0 ? saved.required : 1;
      return { required, reloads };
    };
    const saveState = (state) => {
      try {
        env.write(state);
      } catch {
        // Private mode, a full quota, a disabled storage: the recovery still works, it
        // just starts from a fresh budget on the next load.
      }
    };

    const elapsed = () => Math.max(0, Math.round((env.now() - startedAt) / 1000));
    const giveUp = () => {
      env.setStatus(
        `Still nothing after ${OFFLINE_RECOVERY_MAX_RELOADS} tries. Start the server `
        + "(npm start) and press Try again.",
      );
    };

    let answered = 0;
    let stopped = false;
    const startedAt = env.now();

    const tick = async () => {
      if (stopped) return;
      const state = readState();
      if (state.reloads.length >= OFFLINE_RECOVERY_MAX_RELOADS) {
        stopped = true;
        giveUp();
        return;
      }
      env.setStatus(`Reconnecting, ${elapsed()}s since this page appeared.`);
      try {
        // Any HTTP reply at all means the server is listening again.
        await env.fetchPage();
        answered += 1;
      } catch {
        answered = 0;
      }
      if (stopped || answered < state.required) return;
      answered = 0;
      state.reloads.push(env.now());
      saveState({ required: state.required * 2, reloads: state.reloads });
      stopped = true;
      env.setStatus("The server is answering. Reloading…");
      env.reload();
    };

    env.every(OFFLINE_RECOVERY_MS, tick);
    return { tick, stop: () => { stopped = true; } };
  },
};

function browserEnv() {
  const status = document.querySelector("[data-offline-status]");
  return {
    fetchPage: () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OFFLINE_RECOVERY_MS * 3);
      return fetch(window.location.href, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    },
    reload: () => window.location.reload(),
    now: () => Date.now(),
    read: () => (typeof localStorage === "undefined" ? null : JSON.parse(localStorage.getItem(OFFLINE_RECOVERY_KEY) ?? "null")),
    write: (value) => { localStorage.setItem(OFFLINE_RECOVERY_KEY, JSON.stringify(value)); },
    setStatus: (text) => { if (status) status.textContent = text; },
    every: (intervalMs, tick) => {
      window.setInterval(tick, intervalMs);
    },
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  globalThis.piWebOfflineRecovery.start(browserEnv());
}
