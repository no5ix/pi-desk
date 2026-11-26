"use client";

import { useI18n } from "@/hooks/useI18n";
import { ProjectFolderIcon, WorktreeIcon } from "./GitIcons";
import { TopbarTip, TopbarTipRow, useTopbarTip } from "./TopbarTip";

/**
 * The conversation header's project, and the tip that names its folder.
 *
 * The label is a short name in a narrow row, and the path it stands for is long, on a
 * phone almost always longer than the screen. Nothing in the header said where the
 * session works — the branch's tip did, and the project's own label stayed a plain
 * word. So it is a control like the branch chip: hover, focus or a tap, and the app's
 * tip shows `Path` over the full path, wrapped so the whole path reads complete.
 *
 * A linked worktree is not a new project: the label names the repository it belongs to
 * (`tab-to-find`, not the worktree's folder) and the checkout glyph in front of it says
 * this folder is one of its checkouts — the branch chip beside it carries the branch.
 *
 * The glyph is asked of the folder, and of nothing else: a linked worktree wears the
 * checkout glyph, the main checkout and a plain folder wear the project folder. It used to
 * ask a second question — is this folder the worktree the app made for the branch we are
 * on (`lib/worktree-folder.ts`)? — so that a worktree folder switched to an ordinary
 * branch read as a plain folder. The person working in `auto-toc-worktrees/main-bak3-test-wt`
 * on `main-bak` read that as a lie: the folder is a worktree, and the glyph is where they
 * check which folder a prompt runs in.
 */
export function TopbarProjectChip({ name, path, isWorktree = false }: {
  name: string;
  path: string;
  /** The folder the session works in is a linked worktree checkout. The glyph is asked of
   *  the folder alone: see the note above. */
  isWorktree?: boolean;
}) {
  const { t } = useI18n();
  const { tipId, pop, pos, tipRef, triggerProps } = useTopbarTip<HTMLButtonElement>();
  return (
    <small className="app-topbar-project app-topbar-project--chip">
      <button
        {...triggerProps}
        className="app-topbar-project-hit"
        aria-label={t("chat.projectTipTitle", { projectRoot: path })}
      >
        {/* The sidebar's project folder (SessionSidebar's row glyph), so the header and
            the project tree read as the same object; the checkout glyph goes in front of
            the project's name in a linked worktree, whatever branch that folder carries. */}
        {isWorktree ? <WorktreeIcon size={13} /> : <ProjectFolderIcon size={13} />}
        <span>{name}</span>
      </button>
      {pop.mounted && path ? (
        <TopbarTip tipId={tipId} pos={pos} tipRef={tipRef} closing={pop.closing}>
          <TopbarTipRow label={t("chat.projectTipPathLabel")} value={path} />
        </TopbarTip>
      ) : null}
    </small>
  );
}
