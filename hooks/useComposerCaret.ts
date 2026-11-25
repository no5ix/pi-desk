"use client";

import { useEffect, type RefObject } from "react";
import { CARET_REPAINT_DELAYS_MS, repaintComposerCaret } from "@/lib/composer-caret";

/**
 * Keep the caret visible while the on-screen keyboard lifts the composer.
 *
 * The keyboard's lift is a layout change: `hooks/useViewportHeight.ts` follows the
 * visual viewport and the app's height — the flex column the composer sits at the
 * end of — shrinks to it. WebKit paints the caret where the field stood when the
 * focus arrived, and a field that travels out from under its caret is left with a
 * keyboard and no cursor. Setting the selection is what makes WebKit paint it, so
 * the selection is set to itself at the end of the travel, and once more after it,
 * for an engine that settles late.
 */
export function useComposerCaret(ref: RefObject<HTMLTextAreaElement | null>): void {
  useEffect(() => {
    const root = document.documentElement;
    const timers = new Set<number>();
    const clearTimers = () => {
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
    const repaintAfterLift = () => {
      for (const delay of CARET_REPAINT_DELAYS_MS) {
        const id = window.setTimeout(() => {
          timers.delete(id);
          repaintComposerCaret(ref.current);
        }, delay);
        timers.add(id);
      }
    };
    const observer = new MutationObserver(() => {
      if (root.dataset.keyboardOpen === "true") repaintAfterLift();
      else clearTimers();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-keyboard-open"] });
    return () => {
      observer.disconnect();
      clearTimers();
    };
  }, [ref]);
}
