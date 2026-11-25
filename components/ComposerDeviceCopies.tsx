"use client";

import { useI18n } from "@/hooks/useI18n";
import type { ComposerBrowser, ComposerDeviceCopy, ComposerDeviceKind } from "@/lib/composer-copy-store";
import { browserDisplayName, deviceCopyNames } from "@/lib/device-identity";

// Fork-owned: the other devices' composer copies, docked above this composer.
//
// One row per device that is editing the same composer elsewhere, wearing the
// outbox's surface. The mark is a **pair**: the device (a MacBook's screen, an
// iPhone's body) and then the browser that typed the copy (Safari's compass,
// Chrome's wheel, …). The device alone cannot say which browser holds the draft,
// the browser alone cannot say which machine does — a MacBook's Safari and an
// iPhone's Safari are two rows, and one compass made them twins. Nothing is
// printed: the device's own name (`mac-content-copy`) is the row's tooltip and
// its accessible name (`mac-content-copy · Safari`), because a slug in the row is
// scan noise where two marks are read at a glance.
//
// There is no edit and no delete button — a row is another device's draft, and no
// device edits or deletes another's. The row is one action: it prepends the copy,
// attachments included, into this composer, and the row stays, so the same copy
// can be picked up again.

/**
 * Strokes on a 24 grid, one `<path>` per stroke, in the app's outline style
 * (stroke 2, round caps). The browser map has no `other`: a browser this app has
 * no mark for — and a copy written before the browser was recorded — draws no
 * browser mark at all, because the device's own glyph is already in front of it
 * and a guessed brand is a lie about the user's machine.
 */
const BROWSER_GLYPHS: Partial<Record<ComposerBrowser, string[]>> = {
  safari: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M8 16l2 -6l6 -2l-2 6l-6 2",
  ],
  chrome: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0",
    "M12 9h8.4",
    "M14.6 13.5l-4.2 7.3",
    "M9.4 13.5l-4.2 -7.3",
  ],
  edge: [
    "M20.98 11.37a9 9 0 1 0 -1.59 5.77",
    "M20.98 11.37c.21 3 -5.03 2.41 -6.91 1.49c1.39 -1.6 .4 -4.04 -2.27 -3.85c-1.75 .12 -2.93 1.16 -2.79 3.2c.28 3.99 4.44 6.2 10.36 4.79",
    "M3.02 12.63c-.28 -4.04 8.72 -7.23 11.25 -2.69",
    "M12.63 20.98c-2.99 .21 -5.16 -4.73 -3.57 -9.75",
  ],
  firefox: [
    "M4.03 7.82a9 9 0 1 0 12.82 -3.4c-1.64 -1.02 -3.06 -1.02 -4.85 -1.02h-1.65",
    "M4.91 9.49c-1.76 -1.57 -.8 -5.38 .11 -6.17c.09 .9 .59 1.21 1.11 1.69c.88 -.28 1.31 -.28 1.87 0c.82 -.91 1.69 -2.35 2.63 -2.09c-1.08 1.74 -.07 3.73 1.37 4.17c-.17 .98 -1.48 1.91 -2.76 2.69c-1.3 .94 -.72 1.85 0 2.23c.95 .51 3.61 -1 4.55 .35c-1.7 .1 -1.54 3.11 -3.98 2.73c2.52 .96 4.35 .46 5.46 -.34c1.96 -1.52 2.88 -3.54 2.88 -5.56c0 -1.4 .19 -2.7 -1.26 -4.75",
  ],
  opera: [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M9 12a3 5 0 1 0 6 0a3 5 0 1 0 -6 0",
  ],
};

const DEVICE_GLYPHS: Record<ComposerDeviceKind, string[]> = {
  desktop: [
    "M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10",
    "M7 20h10",
    "M9 16v4",
    "M15 16v4",
  ],
  // A phone is a rounded body with a speaker and a home dot, not the thin slab
  // this row used to draw: at 16px the body has to survive as a shape.
  phone: [
    "M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14",
    "M11 4h2",
    "M12 17v.01",
  ],
  tablet: [
    "M5 4a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1v-16",
    "M11 17a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
  ],
  other: ["M3 5h13v10H3zM19 10h3v11h-3z"],
};

const GLYPH_SIZE = 15;

function CopyGlyph({ strokes, size }: { strokes: string[]; size: number }) {
  return (
    <svg className="composer-copy-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {strokes.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

/** The machine: a screen, a phone, a tablet. Always drawn, first in the pair. */
export function DeviceCopyGlyph({ kind, size = GLYPH_SIZE }: { kind: ComposerDeviceKind; size?: number }) {
  return <CopyGlyph strokes={DEVICE_GLYPHS[kind] ?? DEVICE_GLYPHS.other} size={size} />;
}

/** The browser that typed the copy, second in the pair. Draws nothing for a
 *  browser with no mark: the device glyph already carries the row. */
export function BrowserCopyGlyph({ browser, size = GLYPH_SIZE }: { browser?: ComposerBrowser | null; size?: number }) {
  const strokes = browser && browser !== "other" ? BROWSER_GLYPHS[browser] : null;
  if (!strokes) return null;
  return <CopyGlyph strokes={strokes} size={size} />;
}

export function ComposerDeviceCopies({ copies, onUse }: {
  copies: ComposerDeviceCopy[];
  onUse: (copy: ComposerDeviceCopy) => void;
}) {
  const { t } = useI18n();
  if (!copies.length) return null;
  const names = deviceCopyNames(copies);
  return (
    <div className="composer-outbox composer-device-copies" role="list" aria-label={t("chat.deviceCopies")}>
      {copies.map((copy, index) => {
        const name = names[index] ?? `${copy.label}-content-copy`;
        // A brand name is a brand name in every locale, so this needs no key.
        const browser = browserDisplayName(copy.browser);
        const text = copy.value.trim() || t("chat.queuedImages", { count: copy.images.length });
        const notes: string[] = [];
        if (copy.files.length > 0) notes.push(t("chat.deviceCopyFiles", { count: copy.files.length }));
        const dropped = copy.droppedImages + copy.droppedFiles;
        if (dropped > 0) notes.push(t("chat.deviceCopyDropped", { count: dropped }));
        return (
          <div className="composer-outbox-row composer-copy-row" role="listitem" key={`${copy.deviceId}:${copy.updatedAt}`}>
            <span className="composer-outbox-mark">
              <DeviceCopyGlyph kind={copy.kind} />
              <BrowserCopyGlyph browser={copy.browser} />
            </span>
            <button
              className="composer-outbox-preview composer-copy-use"
              type="button"
              title={`${name} · ${browser} · ${copy.value || text}`}
              aria-label={`${t("chat.deviceCopyUse")}: ${name} · ${browser}`}
              onClick={() => onUse(copy)}
            >
              <span className="composer-copy-text">{text}</span>
              {notes.length > 0 && <span className="composer-outbox-image-count"> · {notes.join(" · ")}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
