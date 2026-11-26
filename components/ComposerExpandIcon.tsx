"use client";

/**
 * The composer's corner: expand a long prompt into a tall editor, collapse it back.
 *
 * Two glyphs, one component: corners that open outward say "there is more room this
 * way", corners that fold inward say "back to the row", and the button turns the mark
 * through its centre between the two states.
 *
 * The expand mark runs the **bottom-left to top-right** diagonal (左下斜向右上) — the
 * asked-for pair, because the mark lives in the card's upper-RIGHT corner and a corner
 * glyph reads along the diagonal that starts at the corner it sits in.
 * The collapse mark is the same inward fold mirrored onto that diagonal: folded corners are
 * read as "back to the row", and the pair keeps the mark turning around its centre.
 *
 * The button that draws this lives in the composer card's upper-right corner
 * (components/ChatInput.tsx) and the text's first line stops short of it, so the glyph
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
              the glyph's far side and points back at the centre — on this diagonal the
              top-right and the bottom-left. */}
          <path d="M20 10h-6V4" />
          <path d="M4 14h6v6" />
        </>
      ) : (
        <>
          {/* Open outwards: the room the editor can take — a corner at the top-right
              and one at the bottom-left, so the mark runs 左下斜向右上. */}
          <path d="M14 4h6v6" />
          <path d="M10 20H4v-6" />
        </>
      )}
    </svg>
  );
}
