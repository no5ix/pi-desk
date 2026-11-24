// Fork-owned: the two git glyphs the app shares between the conversation
// header, the composer's branch chip and the branch menu's per-branch buttons.
//
// `BranchIcon` is the git-branch glyph the sidebar already draws next to a
// session's `worktreeBranch` and the topbar next to a branch name — one shape
// for "a branch", everywhere.
//
// `WorktreeIcon` is the checkout itself: a tracked box with a branch coming off
// it. The app had no worktree glyph of its own (worktrees were only ever named
// in a menu), so the header needs one to tell "this folder is a linked
// worktree" from "this folder is the checkout".

/** The git branch glyph: the shape every branch label in the app carries. */
export function BranchIcon({ size = 12 }: { size?: number }) {
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
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

/**
 * The project's own folder: the sidebar's project row glyph and the header's
 * project glyph, so a branch that lives in the checkout — the project's own
 * folder — wears the same shape as the folder itself.
 */
export function ProjectFolderIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** A git worktree: a checkout (the box) with its own branch. */
export function WorktreeIcon({ size = 12 }: { size?: number }) {
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
    >
      <path d="M4 4h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M15 8h3a2 2 0 0 1 2 2v3" />
      <circle cx="19" cy="18" r="2.5" />
    </svg>
  );
}
