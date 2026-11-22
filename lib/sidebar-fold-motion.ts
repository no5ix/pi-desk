"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The project fold in the sidebar, animated in both directions.
 *
 * A fold is only smooth when the element's own **height** changes: the projects and
 * sessions below it are laid out in the same column, so a height transition moves them
 * continuously, from the first frame. Keyframes on `clip-path`/`opacity` — and the
 * `interpolate-size` transition of an `auto` height, which not every Safari supports —
 * both leave the layout height untouched, and the rows below jump when the content is
 * finally removed. So the height is measured and set in pixels: the browser has a real
 * numeric start and end to interpolate, on every engine.
 *
 * A closing fold also needs its content mounted while it shrinks, and keeping it mounted
 * permanently is not an option: the sidebar's keyboard row walk
 * (`focusSidebarTreeRow` in components/SessionSidebar.tsx), the project row counts and
 * the flat list all treat a folded project as having no rows, and the Chats fold is
 * conditionally rendered by contract. So a root stays in `closing` until its height
 * transition ends, and no longer.
 *
 * Call it once with the whole collapsed set — the sidebar renders projects in a loop, so
 * a per-project hook would change the hook count.
 */

/** Keep in step with `--dur-fold` in app/native-theme.css. */
export const SIDEBAR_FOLD_MS = 240;
/** The safety net: a transition that never reports (reduced motion, a hidden tab). */
export const SIDEBAR_FOLD_SETTLE_MS = SIDEBAR_FOLD_MS + 120;

export interface SidebarFold {
  /** Roots that collapsed and are still mounted, shrinking to zero height. */
  closing: Set<string>;
  /** Roots that were closed on the previous render, so this opening is a user action. */
  opening: Set<string>;
  /** A height transition ended: the closing rows may go now. */
  settle: (root: string) => void;
}

export function useProjectFold(collapsed: Set<string>, safetyMs = SIDEBAR_FOLD_SETTLE_MS): SidebarFold {
  const previousClosing = useRef(collapsed);
  const lastRendered = useRef(collapsed);
  const [closing, setClosing] = useState<Set<string>>(() => new Set());
  const mounted = useRef(true);

  // Which roots are opening is decided **during render**: the rows mount in this same
  // render and the element's `ref` runs before any effect, so an effect-computed answer
  // arrives too late — the opening list would be treated as a list that mounted open (a
  // page load) and never play.
  const opening = useMemo(() => {
    const before = lastRendered.current;
    if (before === collapsed) return new Set<string>();
    return new Set([...before].filter((root) => !collapsed.has(root)));
  }, [collapsed]);

  useEffect(() => {
    lastRendered.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    const before = previousClosing.current;
    previousClosing.current = collapsed;
    const justClosed = [...collapsed].filter((root) => !before.has(root));
    if (justClosed.length === 0) return;
    setClosing((prev) => {
      const next = new Set(prev);
      for (const root of justClosed) next.add(root);
      return next;
    });
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      setClosing((prev) => {
        const next = new Set(prev);
        for (const root of justClosed) next.delete(root);
        return next;
      });
    }, safetyMs);
    return () => clearTimeout(timer);
  }, [collapsed, safetyMs]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settle = (root: string) => {
    setClosing((prev) => {
      if (!prev.has(root)) return prev;
      const next = new Set(prev);
      next.delete(root);
      return next;
    });
  };

  return { closing, opening, settle };
}

/** A fold the user is opening now, rather than a list that mounted already open. */
export function isOpeningFold(opening: Set<string>, root: string): boolean {
  return opening.has(root);
}

/**
 * The transition listener a fold installed. Rapid clicking starts a new transition from
 * the height reached mid-flight, and the listener of the transition being replaced must
 * go first: it closes over the previous direction, and finishing the new transition with
 * it would clear the height of a fold that is closing.
 */
const activeFolds = new WeakMap<HTMLElement, { detach: () => void }>();

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animate one fold. Call it from the element's `ref`, and it is safe to call on every
 * render: the element remembers which state it was last put into.
 *
 * @param closed The fold's state in this render.
 * @param animateOpen False for a list that mounted open (a page load, a project added):
 *   that is not an expansion, and must not play.
 * @param onSettled Called when a closing fold's height reached zero — the caller may
 *   unmount the rows now.
 */
export function applySidebarFold(
  element: HTMLElement,
  options: { closed: boolean; animateOpen: boolean; onSettled: () => void },
): void {
  const want = options.closed ? "closing" : "opening";
  if (element.dataset.foldApplied === want) return;
  element.dataset.foldApplied = want;

  const previous = activeFolds.get(element);
  previous?.detach();
  activeFolds.delete(element);

  if (prefersReducedMotion()) {
    // The CSS declares no transition there; jumping to the end state is the honest
    // behaviour, and the caller unmounts the closing rows at once.
    if (options.closed) options.onSettled();
    return;
  }
  if (!options.closed && !options.animateOpen) {
    element.removeAttribute("data-fold");
    return;
  }

  const startHeight = options.closed ? element.offsetHeight : 0;
  const endHeight = options.closed ? 0 : element.scrollHeight;
  const restingPadding = Number.parseFloat(getComputedStyle(element).paddingBottom) || 0;
  const startPadding = options.closed ? restingPadding : 0;
  const endPadding = options.closed ? 0 : restingPadding;
  element.style.height = `${startHeight}px`;
  element.style.paddingBottom = `${startPadding}px`;
  element.style.opacity = options.closed ? "1" : "0";
  // The start state has to be laid out before the end state is set, or the browser
  // transitions from the end state and nothing moves.
  void element.offsetHeight;
  requestAnimationFrame(() => {
    element.style.height = `${endHeight}px`;
    element.style.paddingBottom = `${endPadding}px`;
    element.style.opacity = "1";
  });

  const detach = () => element.removeEventListener("transitionend", finish);
  function finish(event: TransitionEvent) {
    if (event.target !== element || event.propertyName !== "height") return;
    detach();
    activeFolds.delete(element);
    if (options.closed) {
      options.onSettled();
      return;
    }
    // An `auto` height again, so a session added later is not trapped in the animation.
    element.style.height = "";
    element.style.paddingBottom = "";
    element.removeAttribute("data-fold");
  }
  element.addEventListener("transitionend", finish);
  activeFolds.set(element, { detach });
}
