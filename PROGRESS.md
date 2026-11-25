# PROGRESS — the composer's branch picker, its tree, and the adopted user stylesheet

Branch `wt/2wt-branch-picker-header-worktrees`. The task is the seven items in
PLAN.md (six from the user's screenshots of 2026-11-25, plus the user's
`custom-bak.css`); the reasoning is in DECISIONS.md.

**All seven items are implemented, verified, committed as `20729757` and pushed to
`origin/wt/2wt-branch-picker-header-worktrees`.**

## What is on the branch

| # | Item | State |
| --- | --- | --- |
| 1 | Every rule of `~/Desktop/custom-bak.css` adopted into `app/native-theme.css` | done — repo-root `custom.css` untouched (it is the user's own file, served by `/api/custom-css`) |
| 2 | A branch row's worktree button opens the **new-worktree form** | done — `openWorktreeForm` in `components/ComposerBranchMenu.tsx` sets `NEW_WORKTREE_VIEW` with the row's branch as base |
| 3 | The form: no back button, no "Switch worktree" title; the hint names the base branch **and** the destination folder | done — `sidebar.newWorktreeFrom` / `sidebar.newWorktreeInto`, path from `worktreePathForBranch()` |
| 4 | The header's branch chip always wears the **branch** glyph | done — `components/TopbarBranchChip.tsx`; the checkout glyph moved to the project chip |
| 5 | The branch page: no back row, no "Project actions"; the panel is as wide as its longest name | done — `width: max-content` (240px floor, `min(420px, 100vw - 16px)` cap), names break inside a word, tags never ellipsize |
| 6 | A foldable branch tree: current branch, worktree branches, then prefix groups | done — `lib/branch-tree.ts` + the panel; three glyphs in two voices |
| 7 | The "Worktrees…" menu item removed | done in the DOM panel; the native desktop popup keeps its page |

## Implementation state

* **`lib/branch-tree.ts`** (new, pure): `buildBranchRows` (current → worktree/project
  branches → the rest, each row with `holderPath` / `holderIsMain`), `buildBranchTree`
  (a tree of the `/` prefixes, remotes included), `flattenBranchTree` (the rows the panel
  paints, with the fold honoured and every group open while filtering),
  `worktreePathForBranch` (the client mirror of `lib/worktree.ts`'s `sanitizeBranchForDir`).
  `lib/branch-tree.test.mjs`: 7 tests.
* **`components/ProjectContextMenu.tsx`**: the branch page is the tree; the actions step,
  the back rows and the "Worktrees…" item are gone; a removal is confirmed in the row of
  the branch that owns the worktree; the new-worktree page is the form and nothing else,
  and Escape/Cancel close the menu. The native popup answers with the same row order.
* **`components/GitIcons.tsx`**: `ProjectFolderIcon` (the sidebar's folder shape) joined
  `BranchIcon` / `WorktreeIcon`, and `TopbarProjectChip` uses it.
* **`app/native-theme.css`**: the panel-width rules, the tree's indentation, the chevron,
  the mark's two voices, the folder hint's wrap — and a closing section that adopts the
  user stylesheet (composer border and shadow, topbar/panel edge removal, the folder
  window, focus rings, phone tweaks, sidebar/search).
* **i18n**: `sidebar.currentBranchTitle`, `sidebar.mainCheckoutBranchTitle`,
  `sidebar.branchGroupExpand/Collapse/Count`, `sidebar.newWorktreeFrom/Into` in en,
  zh-CN, zh-TW (`lib/i18n/locale-plugins.ts`).
* **Docs**: `docs/agents/fork-ui.md` (the chips' glyphs, the tree, the panel's width) and
  `docs/agents/files-and-access.md` (the form names the folder the server will create).

## Verification

* `node --test components/*.test.mjs lib/*.test.mjs lib/i18n/*.test.mjs scripts/*.test.mjs`
  → **3985 pass, 0 fail**.
* `node_modules/.bin/tsc --noEmit` → clean. `npx eslint app lib components hooks` →
  no new warning (the pre-existing SkillsConfig / project-skills ones remain).
* `node --test scripts/ui-menu-consistency.test.mjs` → 2/2.
* `node e2e/branch-menu-rows.mjs` → 7 rows at 360px (the panel grew to the longest name,
  capped at 420px), the longest name on one line with nothing cut, 2 prefix groups open
  with their arrows, no tag/icon overlap; the control pass (the four rules surgically
  removed) overlaps 5 of 7 rows.
* `node e2e/branch-menu-filter.mjs` → 12 branches as 6 prefix groups, the checkout's
  branch at the head, a fold hides 3 and puts them back, the filter box for the long
  project only (`fix/` → 3, `Settings` → 2, `zzz` → the sentence), Escape closes, the
  short project keeps none.
* `node e2e/topbar-project-row.mjs`, `node e2e/sidebar-menu-placement.mjs` → green.
* `npm run drift` → the 6 files that disagree with `scripts/fork-ownership.json` are
  files this task did not touch (pre-existing on the branch).

## Next

* Commit and push `wt/2wt-branch-picker-header-worktrees`.
* Open question for the user, not a blocker: the adopted stylesheet hides
  `.extension-status-line` and `.sidebar-search-input`, and squares `.agent-session-panel`
  (`components/AgentSessionPanel.test.mjs` was updated to pin that corner as the panel's
  own call). Those are the user's look, adopted on request; say the word and any one of
  them goes back.

## The merge into `feat/branch-picker-header-worktrees`

Both worktree branches are in `feat/branch-picker-header-worktrees`:
`2ce3bcdd` merges `wt/wt-branch-picker-header-worktrees` (the header/composer/Agents pass,
its ink checks, `lib/worktree-folder.ts`), `46518d67` merges this branch. Git merged both
with no textual conflict — the two lines had touched the same files (`app/native-theme.css`,
`components/ProjectContextMenu.tsx`, the header chips, `docs/agents/fork-ui.md`) in
disjoint regions — and only the composer needed a human.

**What the merge met, and what was done** (`f0c4945f`, `8cf4c3ca`):

* The header branch pinned the composer's **ink** (`justify-content: flex-start` on the
  `+`, a top-only textarea margin, `e2e/composer-geometry.mjs` measuring glyph and text
  edges); this branch restyled the same rules by hand (the glyph centered, `margin: 8px 0
  18px 8px`, 13px right padding, 15px in front of Send, the card's border removed for the
  shadow). The newer CSS is kept and the pins moved to what the layout is for:
  the text area's left margin is `calc(var(--composer-send-size) / 2 - 10px)`, so the
  prompt's first character stands on the glyph's left edge on the 36px tier *and* on the
  touch tier's 44px disc (4px off there, measured); the card's radius lost the border term
  the adopted section removes, so the arc and the Send disc share their center again; and
  the two width checks now count the text area's own horizontal margins, so they keep
  catching the overflow they were written for.
* `docs/agents/fork-ui.md` and the stylesheet's own comments say what the rules do now —
  the old wording ("the margin is vertical only", "left-aligning the glyph") described a
  layout that no longer exists, and that is how a hand-edit gets reverted.

**Verification** (all from the merged tip `8cf4c3ca`):

* `node_modules/.bin/tsc --noEmit` clean; `npm run lint` 0 errors (the 5 pre-existing
  warnings); `npm test` **4713 pass, 0 fail**.
* The 23 fixture-based scripts of `npm run test:e2e` are green, including
  `branch-menu-rows`, `branch-menu-filter`, `topbar-project-row`, `composer-outbox`,
  `option-controls`, `chat-appearance`, `composer-ios`.
* `e2e/title-feedback.mjs` and `e2e/run.mjs` spawn their own `next dev` **in the repo
  root**, so they must be run where no dev server holds that `.next`: from the main repo,
  with the app's dev server on 30141 up, the page reloads forever (the document is
  requested 300+ times, the server logs one `Compiled in 3ms` per request, and no app
  code is involved — no `window.location.reload`, no `router.replace` in the app's own
  frames). In a worktree with its own `.next`, both are green: title-feedback PASSes.

**Next**

* Push `feat/branch-picker-header-worktrees` (it tracks `origin/`).
* The two worktrees (`wt-…`, `wt-2wt-…`) still hold their branch checkouts; removing them
  is the user's call, as their branches are now inside the feature branch.
