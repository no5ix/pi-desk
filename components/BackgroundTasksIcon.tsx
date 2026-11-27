"use client";

// The app's glyph for background shell tasks: a list whose first rows are checked.
//
// Three places draw it, at three sizes, and they are the same idea: the header's chip (13.5, in
// the row beside the subagent counts), the card's head (14) and a sidebar row's running mark
// (12, in the running green, where a live run wears its spinner). One glyph keeps those three
// readable as one feature; the counts and the states next to it are the extension's own numbers.

/** The app's Lucide `list-todo`: a list whose first two rows are checked. */
export function BackgroundTasksIcon({ size = 16, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  );
}
