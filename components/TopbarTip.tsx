"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export const TIP_GAP = 6;
/** The tip never touches the window's edge. */
export const TIP_MARGIN = 8;
/** A tip wider than this is clamped; long names and paths wrap instead of cutting. */
export const TIP_MAX_WIDTH = 420;

/**
 * The conversation header's tips, shared by the branch chip and the project chip.
 *
 * Both labels get cut in a narrow window, and a native `title` cannot carry them:
 * Safari once showed the raw i18n key (the key was missing from every catalogue), and
 * on a phone a native tooltip never opens at all — so the full value was unreachable
 * exactly where the row cut it. The tip is the app's own surface, opened by hover,
 * focus **or a tap**, closed by Escape or a tap elsewhere.
 *
 * Its value never ellipsizes: the surface is `min(70vw, 420px)` and the text wraps, so
 * a long branch name and a long path read complete on a 390px phone too. The tip exists
 * to carry what the row could not fit — cutting it in the tip defeats the point.
 */
export function useTopbarTip<T extends HTMLElement = HTMLButtonElement>() {
  const anchorRef = useRef<T>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const tipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A phone has no hover: the tap is what opens the tip, and it stays until the user
  // taps it again, taps away, or presses Escape.
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pinned || hovered || focused;

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = tipRef.current?.getBoundingClientRect().width ?? 240;
    const left = Math.min(
      Math.max(TIP_MARGIN, rect.left),
      Math.max(TIP_MARGIN, window.innerWidth - width - TIP_MARGIN),
    );
    setPos({ top: rect.bottom + TIP_GAP, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setPinned(false);
      setHovered(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
      anchorRef.current?.blur();
    };
    const onReflow = () => place();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, place]);

  /** Spread onto the label's `<button>`. */
  const triggerProps = {
    ref: anchorRef,
    type: "button" as const,
    "aria-describedby": open ? tipId : undefined,
    onPointerEnter: (event: React.PointerEvent) => {
      // A touch pointer enters and leaves with the tap; the click owns that case.
      if (event.pointerType === "touch") return;
      setHovered(true);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "touch") return;
      setHovered(false);
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onClick: () => setPinned((current) => !current),
  };

  return { anchorRef, tipRef, tipId, open, pos, triggerProps };
}

/** The tip's surface. Render it only while `open`, so it is not in the a11y tree when closed. */
export function TopbarTip({
  tipId,
  pos,
  tipRef,
  children,
}: {
  tipId: string;
  pos: { top: number; left: number } | null;
  tipRef: RefObject<HTMLSpanElement | null>;
  children: ReactNode;
}) {
  return (
    <span
      ref={tipRef}
      id={tipId}
      role="tooltip"
      className="app-topbar-tip"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        maxWidth: `min(70vw, ${TIP_MAX_WIDTH}px)`,
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </span>
  );
}

/** One tip row: a small label, then the value that must read complete. */
export function TopbarTipRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="app-topbar-tip-label">{label}</span>
      <span className="app-topbar-tip-value">{value}</span>
    </>
  );
}
