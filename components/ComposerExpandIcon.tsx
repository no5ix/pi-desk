"use client";

/**
 * The composer's corner: expand a long prompt into a tall editor, collapse it back.
 *
 * Two glyphs, one component, because the two states are the same mark turned around:
 * corners that open outward say "there is more room this way", corners that fold
 * inward say "back to the row". The button that draws it lives in the composer
 * card's top-right corner (components/ChatInput.tsx), where it is out of the
 * text's way and under the thumb that has just finished typing.
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
          {/* Folded inwards: the corner that was the card's is drawn at the glyph's
              far side and points back at the centre. */}
          <path d="M4 10h6V4" />
          <path d="M20 14h-6v6" />
        </>
      ) : (
        <>
          {/* Open outwards: the room the editor can take. */}
          <path d="M14 4h6v6" />
          <path d="M10 20H4v-6" />
        </>
      )}
    </svg>
  );
}
