# PROGRESS — the composer keeps one copy per device, not one shared draft

Branch `feat/branch-picker-header-worktrees`. The ask (pic1 = the outbox row):
the cross-device composer **mirror** is replaced by per-device **copies** no
other device can edit or delete, shown on every other device as a read-only row
that prepends its content into the composer.

**Implemented. Unit suites: `4601 pass / 1 fail` over `app`, `lib`, `components`,
`hooks` (the one failure is `lib/model-catalog-refresh.integration.test.mjs`
"a refreshed catalog reaches the model list the way the pi CLI's did" — it passes
alone; it is a network/concurrency flake, untouched by this change), `scripts`
`122 pass / 0 fail`, `tsc --noEmit` clean, `npm run lint` 0 errors.**

## What changed

**Removed (step 0)** — the shared-draft mirror and its guards:
`lib/composer-sync.ts`, `lib/composer-draft-store.ts`,
`app/api/composer-draft/{route.ts,route.test.mjs}`, `lib/composer-sync.test.mjs`,
`components/ChatInput.composer-sync.test.mjs`; in `components/ChatInput.tsx` the
mirror effect, the remote-apply effect, `draftSignature`, `BLANK_DRAFT_SIGNATURE`,
`composerSyncStampRef`, `syncedSignatureRef`.

**Added**
- `lib/composer-copy-store.ts` — one record per `(composer identity, device id)`
  on `globalThis.__piComposerCopies`. `composerCopyKey` keeps the old shared-key
  rule (`new:<id>:<cwd>` → `cwd:<folder>`; Windows drive letters included). A
  write token is minted per device and required on every write/delete (403
  otherwise). An empty composer removes the device's copy. Size caps drop and
  *count* what they refuse (`droppedImages`/`droppedFiles`); a snapshot past the
  total cap is refused, never stored trimmed. 24h TTL, 40 composers, 8 copies.
- `app/api/composer-copies/route.ts` — `GET` (other devices' copies, the caller's
  own excluded), `PUT` (mints/uses the token), `DELETE` (token in
  `x-composer-copy-token`). 400 / 403 / 413.
- `lib/device-identity.ts` — this browser's stable device id, its slug
  (`mac`/`iphone`/`ipad`/`windows`/`linux`/`chromebook`/`android-phone`/…), and
  its tokens, in `pi-web:device-copy-identity`. iPadOS 13+ (desktop UA,
  `maxTouchPoints > 0`) reads as a tablet, not a Mac. `deviceCopyNames` →
  `mac-content-copy`, `iphone-content-copy`, `ipad-content-copy`; a second Mac of
  the same label carries its id.
- `lib/composer-copies.ts` — push on a 700ms debounce, poll every 4s while the
  tab is visible (+ on `visibilitychange`); an empty composer is a DELETE; a 403
  or 413 stops this device's pushes for the tab's life, the rows keep reading.
- `components/ComposerDeviceCopies.tsx` — the row, in the outbox's surface
  (`.composer-outbox composer-device-copies`): device glyph, copy name, content,
  attachment notes; **no edit, no delete**; click = prepend, row stays.
- CSS in `app/native-theme.css` (`.composer-copy-*`, the dock seam
  `.composer-device-copies + .composer-outbox`, and the glyph staying visible
  below 480px where the outbox hides its queue mark).
- i18n: `chat.deviceCopies`, `chat.deviceCopyUse`, `chat.deviceCopyFiles`,
  `chat.deviceCopyDropped` in en / zh-CN / zh-TW (`lib/i18n/locale-plugins.ts`).
- `components/ChatInput.tsx` — `applyDeviceCopy` (prepends the copy's text before
  what is typed here and joins its attachments, through the existing
  `mergeRestoredSubmissionDraft` rule, then focuses the textarea); the rows dock
  above the composer, over the outbox; sending clears only this device's copy.

**Tests** `lib/composer-copy-store.test.mjs` (10), `app/api/composer-copies/route.test.mjs` (6),
`lib/composer-copies.test.mjs` (6), `components/ComposerDeviceCopies.test.mjs` (5),
`components/ChatInput.device-copies.test.mjs` (5) — the last pins the removed
mirror files **absent**.

**Docs** `docs/agents/fork-ui.md` ("Composer drafts: one copy per device"),
`docs/agents/fork-files-security.md` ("Composer copies on the server"),
`AGENTS.md` (file map + the fork-ui index phrase),
`scripts/fork-ownership.json` (ChatInput drift re-measured 1952/1506, a dated
`decisionLog` entry).

## Verification
- `node_modules/.bin/tsc --noEmit` clean.
- Unit suites as above; `scripts` suite clean (`fork-ownership`, drift
  thresholds, css baseline, ui-menu consistency included).
- `node scripts/measure-fork-drift.mjs` exits 1 on **six pre-existing** threshold
  crossings this task did not touch (`FileExplorer.tsx`, `MarkdownBody.tsx`,
  `web-push.ts`, `request-security.ts`, `PwaRegistration.tsx`,
  `directory-browser.ts` — all committed, none staged here). See BLOCKERS.md.
- `node e2e/composer-outbox.mjs` (the surface the rows borrow): green at 1280,
  390 and 320 in light and dark, with the composer geometry check.
- **`node e2e/composer-device-copies.mjs` (new): green at 1280 and 390, light and
  dark** — two read-only rows (mac, then iPhone) named `mac-content-copy` /
  `iphone-content-copy`, a computer path and a phone path in the marks, one button
  per row and no action column, the dropped-attachment note in the row, the dock
  joined to the composer card, the glyph drawn at 390 where the outbox hides its
  queue mark, a click that prepends the copy *and its image* before the local text
  while both rows stay, and the store's write token coming back on the next push.

## Shipped
- `705702d3 feat: the composer keeps one copy per device, not one shared draft`,
  pushed to `origin/feat/branch-picker-header-worktrees` (31 files). Only this
  task's files are in it: `app/native-theme.css` is committed with just the
  `.composer-copy-*` hunk, so the user's uncommitted rules in that file stayed
  uncommitted, as did the sidebar/menu work in the tree.
- `e2e/composer-device-copies.mjs` joined `npm run test:e2e` after
  `e2e/composer-outbox.mjs`.
- Screenshots of both rows at desktop and phone widths, light and dark:
  `test-results/composer-device-copies/`.

## Next
- Nothing outstanding for the ask.
