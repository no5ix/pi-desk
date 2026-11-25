# Composer drafts: one copy per device, never a shared surface

Branch: `feat/branch-picker-header-worktrees`. User request (pic1 = the
`ComposerOutbox` row): the cross-device composer **mirror** is replaced by
per-device **copies** that no other device can edit or delete.

## The ask, as acceptance criteria

| # | Ask | Where |
|---|-----|-------|
| 0 | Remove the existing sync (`lib/composer-sync.ts`, `lib/composer-draft-store.ts`, `app/api/composer-draft/**`, its 3 tests, the ChatInput mirror effects, the two doc sections) | done in phase A/B |
| 1 | Every device saves **its own** copy; no device can edit/delete another's content; any device can *use* another's | `lib/composer-copy-store.ts` (per-`(composer, device)` record + write token) |
| 2-4 | Copy names `mac-content-copy` / `iphone-content-copy` / `ipad-content-copy` | `lib/device-identity.ts` (`<label>-content-copy`) |
| 5.1 | On the phone: one row above the composer, outbox-row UI, **computer icon**, no edit/delete buttons; clicking prepends the copy (text + attachments) into the composer and the row stays | `components/ComposerDeviceCopies.tsx`, `ChatInput.useDeviceCopy` |
| 5.2 | On the iPad: two rows, mac first, iPhone second with a **phone icon**; same click behaviour | kind order desktop → phone → tablet |

## Design decisions (see DECISIONS.md for the reasoning)

- **Key** = the shared composer identity (`session:<id>`, `cwd:<folder>` from
  `new:<id>:<cwd>`, `parked-new:<cwd>`), exactly the old `composerSyncKey` rule,
  kept and tested (Windows drive letters included). Device ids are segments of
  the record, never of the key, so a client cannot address another device's copy.
- **Ownership token**: minted server-side on a device's first write, returned to
  that device, required on every later write/delete; a foreign token is 403.
- **Nothing is ever applied automatically.** The old failure class (a remote copy
  repainting the composer, clock races, blank copies wiping prompts, 413
  un-mirroring) is gone with the mechanism, not guarded against.
- Attachments that exceed the caps are stored as what fits **and reported**
  (`droppedImages`/`droppedFiles`) — a read-only copy may be partial, a silently
  trimmed one that repaints is what used to destroy work.

## Phases

- **A** Checkpoints (this file, PROGRESS, DECISIONS). ✅
- **B** Server: `lib/composer-copy-store.ts` + `app/api/composer-copies/route.ts`
  + `node --test` for both.
- **C** Client: `lib/device-identity.ts`, `lib/composer-copies.ts` + tests.
- **D** UI: `components/ComposerDeviceCopies.tsx`, CSS in
  `app/native-theme.css`, i18n keys in `lib/i18n/locale-plugins.ts` (en/zh-CN/zh-TW).
- **E** `components/ChatInput.tsx`: drop the mirror, push own copy, watch copies,
  render the rows, `useDeviceCopy` prepends (text + attachments) with the
  existing prepend/merge rule.
- **F** Delete the removed files/tests; refresh `scripts/measure-fork-drift.mjs`
  numbers in `scripts/fork-ownership.json` + a dated `decisionLog` entry.
- **G** Docs: rewrite the fork-ui.md section, the fork-files-security.md section,
  the AGENTS.md file map and the fork-ui index phrase.
- **H** Verify: `tsc --noEmit`, `npm run lint`, `node --test lib components hooks app`,
  `components/fork-extractions.test.mjs`, `scripts/fork-ownership.test.mjs`,
  `components/test-imports.test.mjs`, `node e2e/composer-outbox.mjs`
  (isolated `PI_WEB_DESKTOP_BUILD=1` build; the desktop shell's `__NEXT_PRIVATE_*`
  env must be cleared).
- **I** Commit the touched files, `git push -u origin feat/branch-picker-header-worktrees`.
