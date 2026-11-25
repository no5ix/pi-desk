"use client";

// Fork-owned: the app's one side-chat glyph.
//
// A side chat is a conversation opened beside the main one, in the panel on the right.
// The mark is the app's chat bubble: a square bubble with rounded corners, its tail at
// the **bottom left**, and a plus centred in the body (lucide's `message-square-plus`).
// It is the shape the user picked from a set of candidates, and it stays legible at the
// header's 11px: the bubble is a square, where the plain session bubble is a circle, so
// the two do not read as one glyph.
//
// It replaces a hand-drawn circle with a cut corner and a plus: at 11px its plus touched
// the rim, and the cut corner read as a chip. The candidate that lost the draw at 12px
// was `messages-square` (two bubbles, which falls apart into a bubble and a detached
// tail).
//
// **One drawing, every place.** The composer's side-chat button, the sidebar's leading
// glyph on a side chat's row, the header's family chip, the Agents panel's row head and
// its "new side chat" button, the right-panel tab, and the quote bar's "Ask in a side
// chat" all render these paths. Two shapes for one kind, ten pixels apart, is the bug
// this file exists to prevent; `SideChatIcon.test.mjs` fails when a component draws the
// retired glyph of its own.
//
// Two variants, the app's existing split:
//  - `SideChatPlusIcon` — the action and the kind: the composer's button that opens one,
//    the panel's button that opens one, and the sidebar row that says "this is a side
//    chat" (the composer's mark, as the row's tooltip words it).
//  - `SideChatIcon` — the bubble alone, where the row is already labelled a side chat:
//    the header's count, a panel row's head, a tab, the quote bar's button.

import type { CSSProperties } from "react";

/** The bubble: a square chat bubble, rounded corners, tail at the bottom left. */
export const SIDE_CHAT_BUBBLE = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";
/** The plus, centred in the bubble's body (x 3–21, y 3–17). */
export const SIDE_CHAT_PLUS = "M12 7v6M9 10h6";

interface GlyphProps {
  /** Pixel box. A row glyph and a header glyph cannot share one size, so it is a prop. */
  size?: number;
  strokeWidth?: number;
  /** A caller that colours by stroke rather than `color` (the sidebar's rows) passes it. */
  stroke?: string;
  className?: string;
  style?: CSSProperties;
}

function Glyph({ size = 14, strokeWidth = 2, stroke = "currentColor", className, style, plus }: GlyphProps & { plus?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={SIDE_CHAT_BUBBLE} />
      {plus && <path d={SIDE_CHAT_PLUS} />}
    </svg>
  );
}

/** The side-chat bubble, alone. */
export function SideChatIcon(props: GlyphProps) {
  return <Glyph {...props} />;
}

/** The side-chat bubble with the plus: "open one", and the sidebar row's kind mark. */
export function SideChatPlusIcon(props: GlyphProps) {
  return <Glyph {...props} plus />;
}
