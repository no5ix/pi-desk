"use client";
import { useEffect } from "react";

/** Set on `<html>` by {@link useStandaloneSafeArea}; app/native-theme.css gives
 *  the shell its top inset when this attribute is present. */
export const STANDALONE_SAFE_AREA_ATTRIBUTE = "data-standalone-safe-area";

/** True while the page runs as an installed app: the manifest's
 *  `display: standalone`, `fullscreen` for a home-screen shortcut that takes the
 *  whole screen, and iOS before 16.4, which installed from the meta tag and
 *  exposes only `navigator.standalone`. */
export function isStandaloneDisplay(): boolean {
  const media = window.matchMedia.bind(window);
  return (
    media("(display-mode: standalone)").matches ||
    media("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Mark the one machine the shell cannot size from CSS alone: an installed web
 * app on a touch device.
 *
 * In a mobile browser tab the shell's inline `env(safe-area-inset-*)` padding
 * is the whole inset story and it works. In the iPhone's home-screen app WebKit
 * draws the status bar over the page and reports `env(safe-area-inset-top)` as
 * 0, so the topbar ends up under the notch (the same reason `app/settings.css`
 * floors the settings dialog's top padding at 59px). `app/native-theme.css`
 * needs a floor for the shell, and a floor must not reach a desktop browser or
 * the Tauri window, where 0 is the honest value: `navigator.maxTouchPoints`
 * separates them.
 */
export function useStandaloneSafeArea(): void {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      if (isStandaloneDisplay() && navigator.maxTouchPoints > 0) {
        root.setAttribute(STANDALONE_SAFE_AREA_ATTRIBUTE, "");
      } else {
        root.removeAttribute(STANDALONE_SAFE_AREA_ATTRIBUTE);
      }
    };
    update();
    // Entering or leaving fullscreen (an Android "Add to Home" prompt, a
    // fullscreen video) changes the answer mid-session.
    const queries = ["(display-mode: standalone)", "(display-mode: fullscreen)"].map((query) => {
      const listener = window.matchMedia(query);
      listener.addEventListener("change", update);
      return listener;
    });
    return () => {
      root.removeAttribute(STANDALONE_SAFE_AREA_ATTRIBUTE);
      for (const listener of queries) listener.removeEventListener("change", update);
    };
  }, []);
}
