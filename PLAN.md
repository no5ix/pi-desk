# PLAN — phone chat/composer polish + the Git panel

Branch `fix/flat-chat-blocks`. Twelve items from the user's phone screenshots.

## Items

All twelve landed and are measured; each item's numbers are in PROGRESS.md.

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
    the icon (iOS style). Landed.

## Follow-on asks (after the first pass, same branch)

- The sidebar search's label was cut mid-sentence on a phone: the label is now a
  label only ("Search titles…"), the Enter gesture stays in the tooltip.
- The "Branch in new chat" chip under every tool call: hidden under 640px.
- Tool-call cards: the tint moved from an inline wash to a state class, deeper.
- The clock beside a reply's model row: 12px, matching the glyphs beside it.
- A collapsed thinking's `•••` cut a light rectangle into the translucent
  Process-details plate; the cut surface is a token the context sets.
- The image overlay travels its container's pictures (swipe, flick, arrows, ring,
  tap to close).
- Clicking **Expand / Collapse** sometimes sent the page to its bottom: the tapped
  row is anchored, and the toggle tells the scroll viewport before it flips state.

## Order

A. Quick CSS/markup fixes: 4, 5, 6, 8, 9, 12.
B. Composer keyboard: 1, 2, 3 (measure in a real browser at 390px).
C. Image overlay gestures: 7.
D. Terminal `+`: 10.
E. Git panel: 11 (API: branches, commits, commit diff; UI: tree → list → diff).
   Landed and measured — see PROGRESS.md, "Item 11, frozen".

## Verification

- `node_modules/.bin/tsc --noEmit`, `npm run lint`
- `node --test` over `app`, `lib`, `components`, `hooks`, `scripts`
- Live measurement against the dev server on :30141 at 390px (keyboard inset via
  a Playwright/CDP-driven page where possible)
- Commit + push `fix/flat-chat-blocks` after each verified pass.
  Done: `70560841` (phone pass), `681f991e` (Expand/Collapse anchor),
  `a426e9ae` (the Git view). Suite at the tree: 4893 tests, 4892 pass, 1 skipped.

