"use client";

import { useEffect } from "react";

interface ViewportHeightState {
  hasFocusedEditable: boolean;
  innerHeight: number;
  viewportHeight: number;
  viewportScale: number;
}

/**
 * Smallest visual-viewport shrink that can only come from the on-screen
 * keyboard. Safari toolbar and safe-area changes stay well below this, so a
 * focused editor is not mistaken for an open keyboard while the page scrolls.
 */
export const KEYBOARD_MIN_HEIGHT_PX = 60;

/**
 * Page zoom shrinks the visual viewport to `innerHeight / scale` on its own.
 * Comparing the raw `innerHeight` reports a keyboard for every zoomed page and
 * makes iOS auto-zoom (or a user pinch) skip the resize, which leaves the
 * composer behind the real keyboard. Compare against the zoomed height instead.
 */
export function shouldUseVisualViewportHeight({
  hasFocusedEditable,
  innerHeight,
  viewportHeight,
  viewportScale,
}: ViewportHeightState): boolean {
  if (!hasFocusedEditable) return false;
  const scale = viewportScale > 0 ? viewportScale : 1;
  return innerHeight / scale - viewportHeight > KEYBOARD_MIN_HEIGHT_PX;
}

function hasFocusedEditableElement(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  return activeElement.isContentEditable
    || activeElement.tagName === "INPUT"
    || activeElement.tagName === "SELECT"
    || activeElement.tagName === "TEXTAREA";
}

// WebKit reports the shrunken visual viewport only once the keyboard animation
// finishes (bugs.webkit.org 265578), and an IME candidate bar can resize the
// keyboard without any visualViewport event at all. Re-read the geometry for a
// short while after every trigger so the layout lands on the value WebKit
// settles on instead of the mid-animation one.
const SETTLE_DELAYS_MS = [48, 120, 240, 420, 720];

// The settle chain's last step. Until it has passed, every reading of the visual
// viewport is a frame of the keyboard's own animation, so it is only ever taller
// than the height the keyboard ends at.
export const KEYBOARD_STABLE_MS = SETTLE_DELAYS_MS[SETTLE_DELAYS_MS.length - 1];

/**
 * The height to apply for the keyboard, of the reading in front of us.
 *
 * iOS opens the keyboard over a third of a second, and every re-read in that
 * window is a frame of the slide: the visual viewport starts at the full height
 * and ends above the keyboard. Applying each reading as it lands makes the
 * composer travel up past its place and fall back into it — the jump the user
 * called "it moved up too much and then moved down a little bit". While the
 * window is open the height only ever moves to the smallest reading; after it,
 * a taller viewport is real news (the keyboard changed shape, an IME bar went
 * away) and is applied.
 */
export function settleKeyboardViewportHeight({
  appliedHeight,
  candidateHeight,
  keyboardOpen,
  msSinceKeyboardOpen,
}: {
  appliedHeight: number | null;
  candidateHeight: number;
  keyboardOpen: boolean;
  msSinceKeyboardOpen: number;
}): number {
  if (!keyboardOpen || appliedHeight === null) return candidateHeight;
  if (candidateHeight >= appliedHeight && msSinceKeyboardOpen < KEYBOARD_STABLE_MS) return appliedHeight;
  return candidateHeight;
}

/**
 * Keep the app height aligned with the visual viewport while a mobile keyboard
 * is open. iOS standalone PWAs can leave 100dvh at the layout viewport height,
 * which puts the composer behind the keyboard and may scroll the page itself.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let frameId: number | null = null;
    const settleTimers = new Set<number>();
    let settleChainRunning = false;
    // The height written while the keyboard is open, and when the keyboard opened.
    // The settle window reads them, so the composer's travel is one way.
    let appliedKeyboardHeight: number | null = null;
    let keyboardOpenedAt = Number.NEGATIVE_INFINITY;

    const update = () => {
      frameId = null;
      const keyboardOpen = shouldUseVisualViewportHeight({
        hasFocusedEditable: hasFocusedEditableElement(),
        innerHeight: window.innerHeight,
        viewportHeight: viewport.height,
        viewportScale: viewport.scale,
      });
      if (keyboardOpen) {
        if (appliedKeyboardHeight === null) keyboardOpenedAt = Date.now();
        const height = settleKeyboardViewportHeight({
          appliedHeight: appliedKeyboardHeight,
          candidateHeight: viewport.height,
          keyboardOpen,
          msSinceKeyboardOpen: Date.now() - keyboardOpenedAt,
        });
        appliedKeyboardHeight = height;
        root.style.setProperty("--app-viewport-height", `${height}px`);
        // CSS collapses secondary composer chrome while typing so the few
        // hundred pixels above the keyboard go to the conversation.
        root.dataset.keyboardOpen = "true";
      } else {
        appliedKeyboardHeight = null;
        keyboardOpenedAt = Number.NEGATIVE_INFINITY;
        root.style.removeProperty("--app-viewport-height");
        delete root.dataset.keyboardOpen;
      }

      const pageWasShifted = window.scrollX !== 0 || window.scrollY !== 0;
      const isUnscaled = Math.abs(viewport.scale - 1) < 0.01;
      if (pageWasShifted && isUnscaled) {
        window.scrollTo(0, 0);
      }
    };

    // WebKit can dispatch the resize event before visualViewport.height has
    // settled, especially when an installed PWA dismisses the keyboard. Reading
    // it on the next animation frame prevents the keyboard-height CSS value
    // from remaining after the keyboard has closed.
    const scheduleFrame = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(update);
    };

    // One chain at a time: a keystroke arriving mid-chain must not restart it,
    // or continuous typing would keep pushing the last re-read into the future.
    const runSettleChain = () => {
      if (settleChainRunning) return;
      settleChainRunning = true;
      let index = 0;
      const step = () => {
        if (index >= SETTLE_DELAYS_MS.length) {
          settleChainRunning = false;
          return;
        }
        const delay = SETTLE_DELAYS_MS[index++];
        const timer = window.setTimeout(() => {
          settleTimers.delete(timer);
          update();
          step();
        }, delay);
        settleTimers.add(timer);
      };
      step();
    };

    const scheduleUpdate = () => {
      scheduleFrame();
      runSettleChain();
    };

    // IME candidate bars resize the keyboard without a visualViewport event.
    const onEditableActivity = () => {
      if (!hasFocusedEditableElement()) return;
      scheduleUpdate();
    };

    scheduleUpdate();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("focusin", scheduleUpdate);
    window.addEventListener("focusout", scheduleUpdate);
    window.addEventListener("pageshow", scheduleUpdate);
    document.addEventListener("compositionstart", onEditableActivity);
    document.addEventListener("compositionupdate", onEditableActivity);
    document.addEventListener("compositionend", onEditableActivity);
    document.addEventListener("input", onEditableActivity);
    document.addEventListener("keyup", onEditableActivity);

    return () => {
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("focusin", scheduleUpdate);
      window.removeEventListener("focusout", scheduleUpdate);
      window.removeEventListener("pageshow", scheduleUpdate);
      document.removeEventListener("compositionstart", onEditableActivity);
      document.removeEventListener("compositionupdate", onEditableActivity);
      document.removeEventListener("compositionend", onEditableActivity);
      document.removeEventListener("input", onEditableActivity);
      document.removeEventListener("keyup", onEditableActivity);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      for (const timer of settleTimers) window.clearTimeout(timer);
      settleTimers.clear();
      root.style.removeProperty("--app-viewport-height");
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
