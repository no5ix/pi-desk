"use client";

import { useEffect, useState } from "react";

/**
 * The shared appear/disappear for the app's popups.
 *
 * Every menu, panel, card, tip and picker in the app is mounted by the click that opens it
 * and unmounted by the one that closes it, so it appears and vanishes between two frames.
 * `app/native-theme.css` carries the pair (`app-pop-in` / `app-pop-out`, the `is-closing`
 * state, and the opt-out under `prefers-reduced-motion`). The half a component owns is the
 * mount: a node React has already removed cannot animate, so this hook keeps the node
 * mounted for the length of the exit, and the owner puts `is-closing` on it.
 *
 * The flag flips in the **same render** the `open` value changes, not in an effect. Set in
 * an effect, the popup unmounts for one frame first (`open` is false and `closing` is not
 * yet true), and a surface that vanishes and reappears before fading reads as a flicker.
 * Only the timer lives in an effect.
 */

/** The exit's length. It equals the CSS token `--dur-fast` (120ms): a timer shorter than
 *  the animation cuts the fade, a longer one leaves an invisible node on screen. */
export const POP_EXIT_MS = 120;

type Step = "open" | "exit" | "idle";

/** One transition step, given the previous and the new `open` value. Pure, so the pair is
 *  testable without rendering: a popup that unmounts at once has no exit to play. */
export function popStep(wasOpen: boolean, open: boolean): Step {
  if (open) return wasOpen ? "idle" : "open";
  return wasOpen ? "exit" : "idle";
}

export interface PopTransition {
  /** Render the popup while this is true. */
  mounted: boolean;
  /** True for the length of the exit; the popup puts `is-closing` on itself. */
  closing: boolean;
  /** `" is-closing"` while closing, `""` otherwise — for a composed className. */
  className: string;
}

export function usePopTransition(open: boolean, exitMs: number = POP_EXIT_MS): PopTransition {
  const [closing, setClosing] = useState(false);
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    const step = popStep(prevOpen, open);
    setPrevOpen(open);
    // React re-renders immediately with these, so no frame is committed with the popup
    // unmounted: the closed popup is the closing popup, then it is gone.
    if (step === "exit") setClosing(true);
    else if (step === "open") setClosing(false);
  }

  // The exit's length, and nothing else: `closing` turning off is the timer's job, and the
  // timer is cleared when the popup re-opens (closing flips off) or the owner unmounts.
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [closing, exitMs]);

  return {
    mounted: open || closing,
    closing,
    className: closing ? " is-closing" : "",
  };
}

/** The suffix a popup's className carries while it animates away. */
export function popClass(closing: boolean): string {
  return closing ? " is-closing" : "";
}

/**
 * What a closing popup renders: the live value while it is open, and the last value it
 * showed while it animates away. Closing clears the owner's state (`activeTopPanel`
 * becomes null, a menu's `root` goes with it), and a panel that has lost its content
 * mid-exit animates an empty box — a flash, not a disappearance.
 */
export function useShownWhileClosing<T>(value: T | null, closing: boolean): T | null {
  const [last, setLast] = useState<T | null>(value);
  const [prev, setPrev] = useState<T | null>(value);
  if (value !== prev) {
    setPrev(value);
    // Kept in render (the same-value guard React requires) rather than in an effect: an
    // effect leaves the closing popup's first frame empty, which is the flash this avoids.
    if (value !== null) setLast(value);
  }
  return closing ? last : value;
}
