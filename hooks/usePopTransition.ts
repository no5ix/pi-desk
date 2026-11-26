"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The in/out motion every popup in the app plays.
 *
 * A menu, a header card, a picker or a tip that is mounted on a click and unmounted on
 * the next one blinks: the entrance plays (`.native-popover` animates in), the
 * disappearance does not, because the node is gone before anything can animate. An exit
 * needs the node in the DOM while it plays, so the owner cannot unmount on the click.
 * That is the idiom the settings dialog introduced (keep it mounted, put `is-closing` on
 * it, unmount when the animation is over), and this hook is that idiom for every other
 * popup: the owner's one open flag in, `mounted` and `closing` out.
 *
 * What the state machine keeps straight, learned from that dialog:
 * - an open popup is never `closing`, and re-opening during an exit drops the exit, so a
 *   popup never re-enters from a half-played one;
 * - an exit only starts from a popup that was open: one that has never opened mounts
 *   nothing and animates nothing;
 * - the pending unmount dies with the owner.
 *
 * `POP_EXIT_MS` is the length of the out animation in app/native-theme.css
 * (`--dur-fast`); change one, change the other, and `usePopTransition.test.mjs` says so.
 */
export const POP_EXIT_MS = 120;

/** The one decision the machine makes, from "was it open" and "is it open now". */
export type PopStep = "open" | "exit" | "idle";

export function popStep(wasOpen: boolean, open: boolean): PopStep {
  if (open) return "open";
  // Only a popup that was showing has anything to animate away.
  return wasOpen ? "exit" : "idle";
}

export interface PopTransition {
  /** Render the popup while this is true; it stays true for the length of the exit. */
  mounted: boolean;
  /** Put `is-closing` on the popup element while this is true. */
  closing: boolean;
  /** The suffix for a popup's className: `` `app-menu${pop.className}` ``. */
  className: string;
}

export function usePopTransition(open: boolean, exitMs: number = POP_EXIT_MS): PopTransition {
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | null>(null);
  const wasOpen = useRef(open);

  const cancelExit = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // `closing` is deliberately not a dependency: the effect must not re-run when the exit
  // it just scheduled flips the flag, because that re-run's cleanup is cancelExit, and
  // that would clear the very timeout the exit is waiting on.
  useEffect(() => {
    switch (popStep(wasOpen.current, open)) {
      case "open":
        // Opened, or re-opened mid-exit: the node never left, so the exit is dropped and
        // the popup keeps the entrance it is already playing.
        cancelExit();
        setClosing(false);
        break;
      case "exit":
        // The click that closed it. Hold the node for the animation, then let go.
        setClosing(true);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          setClosing(false);
        }, exitMs);
        break;
      case "idle":
        break;
    }
    wasOpen.current = open;
    return cancelExit;
  }, [open, exitMs, cancelExit]);

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
  useEffect(() => {
    if (value !== null) setLast(value);
  }, [value]);
  return closing ? last : value;
}

