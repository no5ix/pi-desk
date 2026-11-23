"use client";

/**
 * The app's clock glyph, shared by every place a duration is shown: the
 * conversation header's live time, a finished turn's length beside Copy, and a
 * message's own time beside its model. It inherits the row's colour, so each
 * caller styles it with its label.
 */
export function ClockIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "0 0 auto" }}
    >
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}
