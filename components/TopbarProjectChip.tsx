"use client";

import { useI18n } from "@/hooks/useI18n";
import { branchOwnsWorktreeFolder } from "@/lib/worktree-folder";
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
 * this folder is one of its checkouts — the branch chip beside it carries the same glyph
 * and names the branch.
 *
 * The glyph is asked of the branch, not of the folder alone. A linked worktree switched
 * to an ordinary branch wears the folder glyph (lib/worktree-folder.ts): the row reads as
 * a statement about the branch the session works on, and that is what the user asked to
 * see when they carried `main` into a worktree's folder.
 */
export function TopbarProjectChip({ name, path, branch = null, isWorktree = false }: {
  name: string;
  path: string;
  /** The branch the session works on. The worktree glyph is asked of the branch, not of
   *  the folder: see lib/worktree-folder.ts. */
  branch?: string | null;
  isWorktree?: boolean;
}) {
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
            the project tree read as the same object; the checkout glyph the branch chip
            uses goes in front of a branch that has a worktree of its own. A linked
            folder switched to an ordinary branch is a folder — the user asked for exactly
            that, and lib/worktree-folder.ts is the rule. */}
        {isWorktree && branchOwnsWorktreeFolder(path, branch) ? <WorktreeIcon size={13} /> : (
          <ProjectFolderIcon size={13} />
        )}
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
