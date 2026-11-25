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
  (`.composer-outbox composer-device-copies`): the browser's mark (Safari /
  Chrome / Edge / Firefox / Opera, the device glyph for `other`), content,
  attachment notes; the `mac-content-copy` slug is in the `title` and the
  `aria-label`, not in the row; **no edit, no delete**; click = prepend, row stays.
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

---

# PROGRESS — the composer's menus stop opening under the sidebar, and a pin is ink

Branch `feat/branch-picker-header-worktrees`. The ask: (1) a pinned session's title
goes back to the row's own ink and the **unpinned** titles (plain, side chat, and a
subagent run under an unpinned parent) step back a quarter tone; (2) three panels
photographed cut off — the Reasoning menu, the Config menu ("n defaultTools") and the
session-automation menu — "blocked by left side bar".

**Item 2 is implemented, measured and committed. Item 1 is implemented and measured,
and is deliberately left in the working tree: it rides on the tree's uncommitted
`components/SessionSidebar.tsx` (the `is-pinned` class on the title, the tooltip, the
glyph removal), so a commit without that file is red — `SessionSidebar.test.mjs`
asserts the class and that no `session-item-pin` is left.**

## What changed (item 2)

- `lib/composer-panel-placement.ts` (new, pure + a thin DOM collector):
  `composerPanelBounds` intersects the visual viewport with every ancestor that clips
  horizontally, `placeComposerPanel` puts a menu of a given width inside that box
  (desktop from the button's right edge, phone from its left, never wider than the box),
  `composerPanelAnchoring` returns the `left`/`width` to set, or null so a server render
  keeps the plain `right: 0` / `left: 0`.
- Wired into all three menus: the Reasoning and Config menus
  (`components/ChatInput.tsx`, in HEAD from the composer-copies commit) and
  `components/SessionAutomationMenu.tsx`.
- The two causes, both measured: an `absolute` box with `right: 0` and only a `minWidth`
  is shrink-to-fit against its containing block — the button's 32px wrapper — so it
  collapsed and `overflow: hidden` cut its rows; and a menu clamped to the *window*
  (`Math.max(16, …)`) lands inside the sidebar, whose column clips the menu
  (`.app-main-column { overflow: hidden }`) and paints above it (sidebar z-index 200,
  the menus' 100). The z-indexes are untouched: a menu clamped to the column cannot
  reach the sidebar.
- `lib/composer-panel-placement.test.mjs` (new) pins the collapse, the sidebar as the
  limit, the narrow-column cap, the phone's gutters, the clip intersection, the wiring of
  all three menus, and the server fallback.
- Docs: the new section in `docs/agents/fork-ui.md`, the file-map entry and a hard rule
  in `AGENTS.md`.

## Verification

- Geometry measured in a real browser against the running dev server, with the sidebar
  dragged to 480px, at 1000 / 900 / 430px: every panel's box satisfies
  `left >= sidebar.right` and every row's box sits inside the panel
  (`scrollWidth === clientWidth`, content overflow 0px). Reasoning 320px, Config 304px,
  automation 300px; screenshots `/tmp/menu-*.png`.
- The ink rule (item 1) was read in the same screenshots: the two pinned rows are the
  darkest text in the sidebar, the unpinned ones a quarter tone back, light theme.

## Next
- Item 1 commits with the tree's sidebar work (its CSS, its test, `docs/agents/sessions.md`).


---

# PROGRESS — a finished run announces itself when its first prompt carried an image

Branch `feat/branch-picker-header-worktrees`. The ask: "when there's 4 task
running, and the `Fix Agents Panel Subagent Highlight, Text, Alignment` session
just finished while other's still running, it should also pop out the
notifications, but it didn't, I didn't receive any".

## Root cause (measured, not guessed)

Replaying that session's own file through the announcer answered
`{ skipped: "unnamed" }` — a run with no title announces nothing on any channel.
The session was unnamed when its run ended (auto-naming named it 16 s later), so
its title had to come from its first prompt. That prompt carried two screenshots,
so its JSONL line is **496 KB starting at byte 102 268**, and
`readPromptTitle` opened a fixed **256 KB** window of the file: the window cut the
line in half, half a line is not JSON, and the reader answered `null`.
Every session that *opens* with an image was therefore silent on the phone push,
on ntfy and in Notification Center when its task finished. `node ./tmp-diag.mjs`
(the throwaway replay) went `skipped: "unnamed"` before the fix and announced all
three channels after it.

## What changed

- `lib/session-prompt-title.ts` — `readPromptTitle` reads lines from the start of
  the file with a **16 MB read budget** (a cap on the read, never a window that
  truncates the line being read) and closes the stream at the first prompt. A line
  over 256 KB is stepped over when its shape says it is not a user prompt, so a
  4 MB base64 tool result ahead of the prompt costs a substring check, not a parse.
  New `promptTitleFromEntries(entries)`: the same title, from a live session's own
  in-memory entries. Cap/one-lining moved into shared helpers so both readers speak
  the sidebar's rule.
- `lib/rpc-manager.ts` — `getRpcSessionNotificationTitle(session)`: the session's
  name (trimmed), else its first prompt from its own entries, never throwing. Both
  announce callbacks (`onAgentRunComplete`, `onAttentionNeeded`) use it, so a live
  run's title needs no session-path scan, no file, and no window.
- Docs: the title rule in `docs/agents/fork-files-security.md` (the notification
  bullet).

## Verification

- `node --test lib/session-prompt-title.test.mjs` — 9 pass, incl. the regression
  (a 800 KB first-prompt line titles its run), a prompt behind a 4 MB tool result,
  the bounded read, and the entries reader.
- `lib/rpc-manager-shutdown.test.mjs` 46 pass (new: name wins, blank name falls
  through, entries title a nameless session, a session that throws mid-shutdown
  titles nothing). `lib/task-completion-server.test.mjs`, `lib/rpc-manager.test.mjs`,
  `lib/subagent-runtime.test.mjs`, `lib/subagent-report-runs.test.mjs`,
  `lib/notification-tags.test.mjs`, `lib/web-push.test.mjs`,
  `lib/subagent-parent-completion.integration.test.mjs`,
  `components/fork-extractions.test.mjs` — 172 + 19 pass, 0 fail.
- `tsc --noEmit` clean; `eslint` on the four changed files clean.
- The announcer replay over the real session file now returns
  `title: "fix: 1. in the pic1, when i open a subagent session page, …"` and
  `The task lasted 0h42m22s, started at 19:57:19, and ended at 20:39:41.` on push,
  ntfy and the local channel.

## Next

Nothing outstanding for this fix. A phone push needs a subscription to be tested
end to end; the local macOS row is the channel the report is about, and it is the
same `announceRunEnd` call.

## 2026-08-14 — the copy rows wear the browser's mark

The ask (screenshot): the rows printed `mac-content-copy` / `iphone-content-copy`
and a thin phone glyph. Both are now a mark: the row for a copy typed in Safari on
a MacBook shows Safari's compass, and the slug is gone from the row's text.

- `lib/device-identity.ts` — `detectBrowser()` (Chromium forks before Safari:
  every Blink UA ends with `Safari/537.36`, and a headless Chromium says
  `HeadlessChrome/`, so no `\b` before `Chrome/`), `browserDisplayName()`,
  `browser` on the identity.
- `lib/composer-copy-store.ts` / `app/api/composer-copies/route.ts` /
  `lib/composer-copies.ts` — `browser` is part of the copy: sanitised to a fixed
  set (`browserFor`, `other` for anything else), capped at `MAX_BROWSER_CHARS`,
  sent on every write.
- `components/ComposerDeviceCopies.tsx` — `BROWSER_GLYPHS` (safari, chrome, edge,
  firefox, opera; strokes on a 24 grid, stroke 2) + `DEVICE_GLYPHS`
  (redrawn desktop / phone / tablet / other — the phone is a rounded body with a
  speaker and a home dot, not the thin slab). No `other` browser entry: the device
  glyph is the fallback, never a guessed brand. The `.composer-copy-name` span is
  gone; `title` / `aria-label` carry `mac-content-copy · Safari`.
- `app/native-theme.css` — `.composer-copy-name` deleted, `.composer-copy-glyph`
  added, the row centers.
- Tests: 8 in `components/ComposerDeviceCopies.test.mjs` (browser marks, fallback,
  UA table incl. headless Chromium, no printed slug), store/route/client carry the
  browser, `e2e/composer-device-copies.mjs` asserts the Safari and Chrome strokes,
  the absent slug and the tooltip. `tsc --noEmit` clean, eslint clean on the
  changed files, `node e2e/composer-device-copies.mjs` passes at 1280/390 in both
  themes; the marks were eyeballed at 14/16/20px in both themes.
- `npm run drift` still reports the 6 pre-existing manifest disagreements
  (`FileExplorer.tsx`, `MarkdownBody.tsx`, `web-push.ts`, `request-security.ts`,
  `PwaRegistration.tsx`, `directory-browser.ts`) — untouched by this change.

### The mark is a pair, not one glyph (same day)

The browser-only mark from deeb38f5 made a MacBook's Safari row and an iPhone's
Safari row identical (screenshot: two compasses). The mark is now
`<DeviceCopyGlyph kind> <BrowserCopyGlyph browser>`:

- `components/ComposerDeviceCopies.tsx` — `CopyGlyph` renderer, `DeviceCopyGlyph`
  (always, 15px, first) and `BrowserCopyGlyph` (15px, second, `null` for
  `other`/missing: no brand is drawn, never a guessed one). The `browser`
  fallback-to-device logic is gone — the device glyph is already in the pair.
- `app/native-theme.css` — `.composer-copy-row .composer-outbox-mark` is an
  inline-flex with `gap: 3px`; the glyph flexes, and the ≤480px comment names the
  pair (the component test slices CSS from it).
- Tests: the component test pins the pair and the `null` browser glyph; the e2e
  asserts `[[desktop, safari], [phone, chrome]]` per row's glyph strokes, 2 marks
  per row, and a mark box ≥ 28px. Verified: 8 component tests, the e2e at
  1280/390 in both themes, `tsc --noEmit`, eslint on the component; the pair was
  read in both screenshots (row 1 monitor+compass, row 2 phone+Chrome wheel).
