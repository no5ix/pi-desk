"use client";

/**
 * The composer's corner: expand a long prompt into a tall editor, collapse it back.
 *
 * Two glyphs, one component: corners that open outward say "there is more room this
 * way", corners that fold inward say "back to the row", and the button turns the mark
 * through its centre between the two states.
 *
 * The expand mark runs the **top-left to bottom-right** diagonal — the 2026-12 ask,
 * because the old bottom-left/top-right pair read against the card's own left edge, the
 * column where the corner and the `+` stand. The collapse mark keeps its own inward
 * fold (the same ask reverted it): folded corners are read as "back to the row", and
 * mirroring them onto the new diagonal made the two states read as one shape.
 *
 * The button that draws this lives in the composer card's upper-left corner
 * (components/ChatInput.tsx) and the text's first line steps right of it, so the glyph
 * never sits over a line.
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
          {/* Folded inwards, in the pair the eye already knows: each corner is drawn at
              the glyph's far side and points back at the centre. */}
          <path d="M4 10h6V4" />
          <path d="M20 14h-6v6" />
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
