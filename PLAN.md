# Branch picker: tree, icons, worktree form; the custom.css rules adopted

Branch: `wt/2wt-branch-picker-header-worktrees`. Six fixes from the user's
screenshots (`pic1`…`pic7`, 2026-11-25) plus the user stylesheet.

| # | Ask | Where |
| --- | --- | --- |
| 1 | Apply every rule in `~/Desktop/custom-bak.css` to the project's own CSS | `app/native-theme.css` (fork CSS lives only there; `custom.css` is a per-user file served by `/api/custom-css`) |
| 2 | A branch row's worktree button opens the **new-worktree form**, not a plain branch list | `components/ComposerBranchMenu.tsx` (`openWorktreeForm`), asserted in the panel's tests |
| 3 | The new-worktree page: no back button, no "Switch worktree" heading; the hint names the base branch **and** the folder the worktree will land in | `components/ProjectContextMenu.tsx` (`view === "new-worktree"`), `lib/worktree-folder.ts` (the folder rule), `sidebar.newWorktreeFrom` / `sidebar.newWorktreeInto` |
| 4 | The header's branch glyph is the **branch** glyph, not the worktree glyph | `components/TopbarBranchChip.tsx` |
| 5 | The branch page: no back button / "Project actions"; the panel is as wide as its longest branch name, nothing cut off | `components/ProjectContextMenu.tsx`, `.sidebar-project-context-menu--wide` in `app/native-theme.css` |
| 6 | The branch list: current branch on top with a blue project glyph, worktree branches next with a blue worktree glyph, everything else in a foldable prefix tree (pic7) | `lib/branch-tree.ts` (new, pure), `components/ProjectContextMenu.tsx`, CSS |
| 7 | No "Worktrees…" item in the branch page | `components/ProjectContextMenu.tsx`; the DOM worktree rows keep a remove button so a checkout is still removable |

## Order

1. `lib/branch-tree.ts` + `lib/branch-tree.test.mjs` (pure row order, tree, flatten).
2. `components/ProjectContextMenu.tsx`: branch page (tree, glyphs, width, no
   back, no Worktrees item, inline worktree removal), worktrees page (no back),
   new-worktree page (no back/heading, folder in the hint, cancel closes).
3. `components/GitIcons.tsx`: the project folder glyph shared with the header.
4. `components/TopbarBranchChip.tsx`: always `BranchIcon`.
5. i18n: en / zh-CN / zh-TW keys, same placeholders.
6. CSS: the tree's rows + the width rule + the adopted custom.css rules.
7. Tests: `components/ProjectContextMenu.test.mjs`,
   `components/ComposerBranchMenu.test.mjs`,
   `components/AppShell.topbar-branch.test.mjs`, `e2e/branch-menu-rows*`,
   `e2e/branch-menu-filter*`.
8. Docs: `docs/agents/fork-ui.md`, `docs/agents/sessions.md`,
   `docs/agents/files-and-security.md`, `docs/native-theme.md`.
9. Verify: unit tests, `tsc --noEmit`, `npm run lint`,
   `node e2e/branch-menu-rows.mjs`, `node e2e/branch-menu-filter.mjs`,
   `node --test scripts/ui-menu-consistency.test.mjs`, `npm run drift`.
10. Commit and `git push -u origin wt/2wt-branch-picker-header-worktrees`.

## Notes / decisions

- `custom.css` (repo root) is a copy of the user's `<agentDir>/desktop/custom.css`;
  the rules are **copied** into `app/native-theme.css`, and the repo's
  `custom.css` is left alone (it is the user's own file, not app source).
- Removing the "Worktrees…" item does not remove the feature: the branch page
  shows a worktree glyph on every branch a worktree holds, and that row carries
  the remove button the worktree page had. The right-click native popup keeps
  its "Worktrees…" entry.
