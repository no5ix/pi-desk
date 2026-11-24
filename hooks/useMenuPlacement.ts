"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  MENU_MAX_HEIGHT_PX,
  menuExpectedHeight,
  placeMenuWithinViewport,
  type MenuAnchor,
  type MenuSide,
} from "@/lib/menu-placement";

/**
 * Positions a fixed-position menu next to its anchor using the menu's real
 * measured size, so a menu near the bottom of the window flips upward instead
 * of running off the screen. The measurement runs in a layout effect, so the
 * corrected position is applied before the browser paints.
 *
 * Two rules keep the panel still while its content arrives:
 * - the **first** placement is for the height the menu settles at
 *   (`menuExpectedHeight`), not the shape it is born at (a loading skeleton, a
 *   list a fetch has not filled). Placing from the born shape picks a side and a
 *   top that the real list does not fit, and the panel jumps as the list lands —
 *   the flash the user saw on the composer's branch chip.
 * - the **side** is remembered for the menu's whole life. A height change may
 *   move the far edge (the list growing away from its anchor, as a native menu
 *   does); it must never flip the panel to the other side mid-flight.
 */
export function useMenuPlacement(
  anchor: MenuAnchor | null,
  menuRef: RefObject<HTMLElement | null>,
  options: { growing?: boolean } = {},
): { top: number; left: number } | null {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const sideRef = useRef<MenuSide | null>(null);
  const firstRef = useRef(true);

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !anchor) {
      sideRef.current = null;
      setPosition(null);
      return;
    }
    sideRef.current = null;
    firstRef.current = true;
    const place = () => {
      const rect = element.getBoundingClientRect();
      // The cap floor is in force while the menu is *born* and while it is
      // `growing` (a list a fetch has not filled): the panel is placed for the
      // height its content settles at, so the frame the user first sees is the
      // frame the content lands in. Once the content is final, the measured
      // height rules, and a short list sits against its anchor.
      const capFloor = firstRef.current || options.growing
        ? menuExpectedHeight(window.innerHeight, MENU_MAX_HEIGHT_PX)
        : 0;
      const height = Math.max(rect.height, capFloor);
      const next = placeMenuWithinViewport(
        anchor,
        { width: rect.width, height },
        { width: window.innerWidth, height: window.innerHeight },
        { side: sideRef.current ?? undefined },
      );
      sideRef.current = next.side;
      firstRef.current = false;
      setPosition((current) =>
        current && current.top === next.top && current.left === next.left ? current : next,
      );
    };
    place();
    // The menu's height changes when it switches page (actions -> branches).
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor, menuRef, options.growing]);

  return position;
}
