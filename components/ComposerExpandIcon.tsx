"use client";

/**
 * The composer's corner: expand a long prompt into a tall editor, collapse it back.
 *
 * Two glyphs, one component, because the two states are the same mark turned around:
 * corners that open outward say "there is more room this way", corners that fold
 * inward say "back to the row". The marks run the **top-left to bottom-right** diagonal
 * (the 2026-12 ask: the bottom-left/top-right pair read against the card's own left
 * edge, where the `+` and the corner stand in one column). The button that draws it
 * lives in the composer card's upper-left corner (components/ChatInput.tsx) and the
 * text drops below it, so the glyph never sits over a line.
 */
export function ComposerExpandIcon({ expanded, size = 18 }: { expanded?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // The two states share a centre, so the mark turns around it rather than
      // being swapped for an unrelated glyph.
      style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--dur-base) var(--ease-native)" }}
    >
      {expanded ? (
        <>
          {/* Folded inwards: each corner is drawn at the glyph's far side and points
              back at the centre, along the top-left / bottom-right diagonal. */}
          <path d="M20 10h-6V4" />
          <path d="M4 14h6v6" />
        </>
      ) : (
        <>
          {/* Open outwards: the room the editor can take — a corner at the top-left
              and one at the bottom-right, so the mark runs 左上斜向右下. */}
          <path d="M10 4H4v6" />
          <path d="M14 20h6v-6" />
        </>
      )}
    </svg>
  );
}
