"use client";

import { useI18n } from "@/hooks/useI18n";
import { TopbarTip, TopbarTipRow, useTopbarTip } from "./TopbarTip";

/**
 * The conversation header's project, and the tip that names its folder.
 *
 * The label is a short name in a narrow row, and the path it stands for is long, on a
 * phone almost always longer than the screen. Nothing in the header said where the
 * session works — the branch's tip did, and the project's own label stayed a plain
 * word. So it is a control like the branch chip: hover, focus or a tap, and the app's
 * tip shows `Path` over the full path, wrapped so the whole path reads complete.
 */
export function TopbarProjectChip({ name, path }: { name: string; path: string }) {
  const { t } = useI18n();
  const { tipId, open, pos, tipRef, triggerProps } = useTopbarTip<HTMLButtonElement>();
  return (
    <small className="app-topbar-project app-topbar-project--chip">
      <button
        {...triggerProps}
        className="app-topbar-project-hit"
        aria-label={t("chat.projectTipTitle", { projectRoot: path })}
      >
        {/* The sidebar's project folder (SessionSidebar's row glyph), so the header and
            the project tree read as the same object. */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
        </svg>
        <span>{name}</span>
      </button>
      {open && path ? (
        <TopbarTip tipId={tipId} pos={pos} tipRef={tipRef}>
          <TopbarTipRow label={t("chat.projectTipPathLabel")} value={path} />
        </TopbarTip>
      ) : null}
    </small>
  );
}
