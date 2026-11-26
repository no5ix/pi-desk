"use client";

import { useSyncExternalStore } from "react";

// Mobile breakpoint shared with app/globals.css (max-width: 640px).
const MOBILE_QUERY = "(max-width: 640px)";
// Narrow phones keep secondary toolbar actions behind the More button.
const NARROW_MOBILE_QUERY = "(max-width: 480px)";
// A touch device: the finger is the pointer, so a row of small icon buttons is a row of
// taps that land beside their targets. The composer keeps its row to the `+`, the prompt
// and Send there, and every other control goes into the `+`'s menu (a phone in landscape
// and a tablet are wide, and their fingers do not get narrower).
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribeToQuery(query: string, cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(query);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function queryMatches(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

const subscribeMobile = (cb: () => void) => subscribeToQuery(MOBILE_QUERY, cb);
const getMobileSnapshot = () => queryMatches(MOBILE_QUERY);
const subscribeNarrowMobile = (cb: () => void) => subscribeToQuery(NARROW_MOBILE_QUERY, cb);
const getNarrowMobileSnapshot = () => queryMatches(NARROW_MOBILE_QUERY);

function getServerSnapshot(): boolean {
  return false;
}

/**
 * Returns true when the viewport is at or below the mobile breakpoint.
 * SSR-safe: renders as desktop (false) on the server and first client paint,
 * then syncs to the real viewport after hydration.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerSnapshot);
}

/** Returns true when the compact mobile toolbar should collapse extra actions. */
export function useIsNarrowMobile(): boolean {
  return useSyncExternalStore(subscribeNarrowMobile, getNarrowMobileSnapshot, getServerSnapshot);
}

/**
 * True on a touch device (no precise pointer), false on SSR and the first client paint —
 * the same SSR-safe shape as `useIsMobile`, so a server render never picks the menu tier
 * and the composer's own measurement settles it a frame later.
 */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (cb) => subscribeToQuery(COARSE_POINTER_QUERY, cb),
    () => queryMatches(COARSE_POINTER_QUERY),
    getServerSnapshot,
  );
}
