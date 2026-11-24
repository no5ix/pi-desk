"use client";

import { useI18n } from "@/hooks/useI18n";
import { BranchIcon, WorktreeIcon } from "./GitIcons";
import { TopbarTip, TopbarTipRow, useTopbarTip } from "./TopbarTip";

/**
 * The conversation header's branch, and the tip that explains it.
 *
 * The branch name is the shortest thing in the header and the only one the user cannot
 * read anywhere else, so it is the label worth touching. It used to carry a native
 * `title`: Safari showed the raw i18n key (the key was missing), and on a phone a
 * native tooltip never opens, so the full name was unreachable exactly where the name
 * is cut in half. This is a real control: hover or focus on desktop, tap on a phone,
 * and the app's tip shows the whole name — wrapped, never ellipsized, because the tip
 * is the only place the complete name exists. The folder is not repeated here: the
 * project label in front of it carries it, as its own tip.
 */
export function TopbarBranchChip({
  branch,
  projectRoot,
  isWorktree,
}: {
  branch: string;
  projectRoot: string;
  isWorktree: boolean;
}) {
  const { t } = useI18n();
  const { tipId, open, pos, tipRef, triggerProps } = useTopbarTip<HTMLButtonElement>();
  return (
    <span className="app-topbar-branch app-topbar-branch--chip">
      <button
        {...triggerProps}
        className="app-topbar-branch-hit"
        aria-label={t(isWorktree ? "chat.gitWorktreeBranchTitle" : "chat.gitBranchTitle", {
          gitBranch: branch,
          projectRoot,
        })}
      >
        {/* The sidebar's branch glyph in a checkout, the worktree glyph in a linked
            worktree: the same branch name can mean both folders, and the header has to
            say which one this session works in. */}
        {isWorktree ? <WorktreeIcon /> : <BranchIcon />}
        <span>{branch}</span>
      </button>
      {open ? (
        <TopbarTip tipId={tipId} pos={pos} tipRef={tipRef}>
          <TopbarTipRow
            label={t(isWorktree ? "chat.branchTipWorktreeLabel" : "chat.branchTipBranchLabel")}
            value={branch}
          />
        </TopbarTip>
      ) : null}
    </span>
  );
}
