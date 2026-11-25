"use client";

import { useI18n } from "@/hooks/useI18n";
import type { ComposerDeviceCopy, ComposerDeviceKind } from "@/lib/composer-copy-store";
import { deviceCopyNames } from "@/lib/device-identity";

// Fork-owned: the other devices' composer copies, docked above this composer.
//
// One row per device that is editing the same composer elsewhere, wearing the
// outbox's surface: the device's glyph, its copy's name (`mac-content-copy`),
// and the content. There is no edit and no delete button — a row is another
// device's draft, and no device edits or deletes another's. The row is one
// action: it prepends the copy, attachments included, into this composer, and
// the row stays, so the same copy can be picked up again.

const ICONS: Record<ComposerDeviceKind, string> = {
  desktop: "M2 5h20v12H2zM9 21h6M12 17v4",
  phone: "M8 2h8v20H8zM11 19h2",
  tablet: "M5 3h14v18H5zM11 18h2",
  other: "M3 5h13v10H3zM19 10h3v11h-3z",
};

export function DeviceCopyGlyph({ kind, size = 16 }: { kind: ComposerDeviceKind; size?: number }) {
  const path = ICONS[kind] ?? ICONS.other;
  return (
    <svg className="composer-copy-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
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
        const text = copy.value.trim() || t("chat.queuedImages", { count: copy.images.length });
        const notes: string[] = [];
        if (copy.files.length > 0) notes.push(t("chat.deviceCopyFiles", { count: copy.files.length }));
        const dropped = copy.droppedImages + copy.droppedFiles;
        if (dropped > 0) notes.push(t("chat.deviceCopyDropped", { count: dropped }));
        return (
          <div className="composer-outbox-row composer-copy-row" role="listitem" key={`${copy.deviceId}:${copy.updatedAt}`}>
            <span className="composer-outbox-mark"><DeviceCopyGlyph kind={copy.kind} /></span>
            <button
              className="composer-outbox-preview composer-copy-use"
              type="button"
              title={`${name} · ${copy.value || text}`}
              aria-label={`${t("chat.deviceCopyUse")}: ${name}`}
              onClick={() => onUse(copy)}
            >
              <span className="composer-copy-name">{name}</span>
              <span className="composer-copy-text">{text}</span>
              {notes.length > 0 && <span className="composer-outbox-image-count"> · {notes.join(" · ")}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
