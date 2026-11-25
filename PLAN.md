# PLAN — phone chat/composer polish + the Git panel

Branch `fix/flat-chat-blocks`. Twelve items from the user's phone screenshots.

## Items

1. Composer on an active session, keyboard open: the side-chat button stays in its
   place and the button next to `+` (the controls/menu row) stays visible.
2. Composer on a NEW session, keyboard open: the caret must be in the textarea.
3. The composer's lift with the keyboard must be smooth — no overshoot-then-settle.
4. The "go to the bottom" button: no border, a stronger shadow.
5. Subagent report: the body's font size/weight = the thinking block's; the content
   area gets a background that differs from the page.
6. Code blocks: a background that differs from the page.
7. The image overlay: swipe left/right (touch + trackpad) moves between images,
   tapping the image closes it.
8. The thinking row: its icon lines up with the clock icon above; a collapsed
   multi-line thinking ends its first line with `•••`, not `…`.
9. The sidebar: more room between the search box and the `Chats` header.
10. The terminal panel's `+` button does nothing (phone) — fix.
11. The right panel's header gains a Git button: a branch tree (local + remote,
    foldable) → a commit list for the branch → a commit diff page, reusing the
    existing diff renderer and the existing branch tree.
12. The settings rows: the separators start at the label's first letter, not under
    the icon (iOS style).

## Order

A. Quick CSS/markup fixes: 4, 5, 6, 8, 9, 12.
B. Composer keyboard: 1, 2, 3 (measure in a real browser at 390px).
C. Image overlay gestures: 7.
D. Terminal `+`: 10.
E. Git panel: 11 (API: branches, commits, commit diff; UI: tree → list → diff).

## Verification

- `node_modules/.bin/tsc --noEmit`, `npm run lint`
- `node --test` over `app`, `lib`, `components`, `hooks`, `scripts`
- Live measurement against the dev server on :30141 at 390px (keyboard inset via
  a Playwright/CDP-driven page where possible)
- Commit + push `fix/flat-chat-blocks` after each verified pass.
