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

## 2026-11-25 — a divider the pointer crosses is not highlighted

The user's screenshots: sliding the cursor over the line between the sidebar (or the
right panel) and the conversation made that line light up, and the tooltip
"Resize sidebar: Drag to resize. Double-click or press Enter to reset." proved the
pointer was over the resize handle.

### Root cause

Upstream's `app/globals.css` (byte-identical, fork CSS may not live there) tints
`.panel-resize-handle::after` on `:hover`, `:focus-visible` **and** `.is-resizing`.
That element is a 12px invisible hit target straddling the pane boundary
(`margin: 0 -6px; flex: 0 0 12px`) — the visible line is the panels' own hairline, so
the hover tint painted a second, brighter line on top of a separator already there.
The fork had already thinned it to 1px and softened the tint, but kept the hover.

### What changed

- `app/native-theme.css` — `.panel-resize-handle:hover::after { background: transparent; }`
  in the fork base layer; `:focus-visible` and `.is-resizing` keep the tint (the
  separator is tabbable, the arrows resize it, and a drag needs feedback). The
  right panel's `!important` pair above 960px drops `:hover` from its tinted
  selector; its transparent selector becomes `:not(:focus-visible):not(.is-resizing)`
  so it never beats the tint.
- Tests: `e2e/divider-hover.mjs` (+ fixture, in `npm run test:e2e`) measures the
  shell's markup in Chromium in both themes — rest and hover are the same
  `rgba(0, 0, 0, 0)` on all three dividers, the line stays 1px, Tab and
  `.is-resizing` still tint, and a control pass injects upstream's declaration
  verbatim (alpha 0.74) so the hover assertion is not blind.
  `app/native-theme-hover.test.mjs` pins the declarations and the old
  `:not(:hover)` pair's absence.
- Docs: `docs/agents/fork-ui.md` (in the hover-state section) and
  `docs/native-theme.md`'s override list.

### Verification

`tsc --noEmit` clean; eslint clean on the changed files; `npm test` 4810/4811 pass
(1 skipped, 0 fail) including the upstream-CSS byte-identity check;
`node e2e/divider-hover.mjs` passes in light and dark. Measured on the live dev page
at 1280px: `::after` is `rgba(0, 0, 0, 0)` / 1px at rest and under the pointer.
`npm run test:e2e` as a whole was not run (it needs a production build;
`next build` from this shell hits the `__NEXT_PRIVATE_*` trap) — the new test was run
directly, as its siblings are.

### The drag lights the line too (same day)

The hover fix was not the whole story: dragging the same divider highlighted it, and
after the pointer was released the line stayed lit until the user clicked elsewhere.

- Root cause, measured live: `useResizablePanel.onPointerDown` called
  `target.focus({ preventScroll: true })`. Its `preventDefault()` cancels the
  compatibility `mousedown`, so that call was the *only* thing focusing the separator
  during a drag — and Chromium grants `:focus-visible` to a programmatically focused
  `div[role=separator][tabindex=0]`, so the fork's focus tint fired for a mouse gesture.
  Mid-drag the live page measured `color(srgb .155 .155 .162 / 0.192)` = the
  `:focus-visible` value, and it outlived the release.
- `hooks/useResizablePanel.ts` — the `focus()` call is gone (pointer capture needs no
  focus). A keyboard user Tabs to the separator, which is the one state with a cue; a
  dragged divider no longer swallows the arrow keys or Enter afterwards.
- `app/native-theme.css` — `.is-resizing` joins `:hover` at `background: transparent`;
  the right panel's pair above 960px is now `:not(:focus-visible)` transparent /
  `:focus-visible` tinted.
- Tests: `e2e/divider-hover.mjs` mounts the real hook (`[data-resize-handle="live-sidebar"]`)
  and drives a real mouse drag — the pane moves ~90px, `is-resizing` is set, the `::after`
  is `rgba(0, 0, 0, 0)` mid-drag and after release, `document.activeElement` never lands on
  the separator, Tab still tints. Control passes: upstream's declaration (alpha 0.74) and
  re-adding the hook's `focus()` both fail the assertion. `hooks/useResizablePanel.test.mjs`
  pins that pointer-down captures without focusing; `app/native-theme-hover.test.mjs` pins
  the declarations and forbids the old `:is(:focus-visible, .is-resizing)` pair.
- Verified: live app at 1280px — rest / hover / mid-drag / after release all
  `rgba(0, 0, 0, 0)` with the sidebar 260 → 350; `npm test` 4811/4812 (0 fail);
  `tsc --noEmit` and eslint clean; the e2e passes in light and dark.

## 2026-11-25 — the chat's blocks go flat, headings are tinted, a footer stops naming the model

Three asks from the user's screenshots of a conversation: every block and small button
in a reply wore a hairline; the assistant's footer printed `ukisai/Swift-…:IQ3_S(Splash)`
beside the clock; and h1…h6 all rendered in one ink.

- `app/native-theme.css` (fork CSS only, `globals.css`/`settings.css` untouched) added a
  "The conversation: one surface, no hairlines" layer: `.process-details-trigger`,
  `.tool-call-card`, `.thinking-card`, `.compaction-card`, `.custom-message-card`,
  `.markdown-code-block` and its header/fold seam lose their outlines, and every borderless
  small control (Copy, No wrap, Wrap, the report's Copy/Details, the subagent's Open,
  the footer's Copy, the user's action row, a cancelled badge, the truncation's Compact)
  gets a fill instead — `--bg-subtle` at rest, `--bg-selected` pressed, an accent mix while
  active. Fills carry the affordance the outlines used to. The trigger and the report's
  buttons carried `border: none, background: transparent` inline, so their CSS needed
  `!important`; a card's tinted background is left to the component, which picks it per
  tool state (running / waiting / error).
- The six heading levels get their own token (`--heading-1`…`--heading-6`) in both themes,
  applied to the rendered Markdown and to an artifact's own document.
- `components/MessageView.tsx`: the footer's model text is gone — the line keeps the clock,
  the streaming dot, and routing. `getModelDisplayName` and the `modelNames` prop are gone
  from the component and from `components/ChatWindow.tsx`'s call site; a reply's model is
  still in the header's model picker and in Process details.
- New classes on the fork's own nodes (`.tool-call-card`, `.thinking-card`,
  `.custom-message-card`, `.tool-result-body`, `.tool-call-open`, `.message-copy-action`)
  so the CSS names the block instead of reaching through inline styles.
- Tests: `components/MessageView.test.mjs` (a reply's line keeps its clock and prints no
  provider or model), `components/MessageView.subagent-report.test.mjs` (the report's buttons
  name the class the CSS fills), `app/native-theme-chat-flat.test.mjs` (the flat rules, the
  fills in every state, the six heading inks, and the rule that an upstream border is named
  `0` in `native-theme.css` — dropping the declaration leaves `globals.css` drawing it, which
  is how the code fence's header kept its underside line through the flat pass; the live app
  measured `1px` there before it was named).
- Verified against the running app with real sessions: `h2` = `rgb(162,28,175)`,
  `h3` = `rgb(21,128,61)`; the fence, its header, its chips, the process card and a reply's
  Copy are all `0px/0px/0px/0px` with a fill; the line reads `01:14 AM`.
  `npm test` 0 failures, `tsc --noEmit` clean, eslint 0 errors.

## 2026-11-25 — the phone's model picker stops wearing the composer strip's width

On a phone the model picker opened ~82px wide: every model name (`provider/model`, a
50-character identifier) was cut to a fragment and the list scrolled sideways.

- Root cause: the composer's narrow-screen control row is the strip the More button
  opens — `position: absolute; width: max-content`, `backdrop-filter: blur(10px)`, and
  `translate`/`scale` transitions. `backdrop-filter` and a non-`none` `scale` make an
  element the containing block for a `position: fixed` descendant, so the picker's phone
  rule (`left: 8; right: 8`, written for the viewport) measured the *strip*: a 100px box.
  Measured in a real browser at 390px: `position: fixed`, panel 82px inside a 100px strip.
- `components/ModelSelector.tsx` gains `composerAnchored`: the composer's chip opens a
  `position: absolute` panel hung above itself, placed by the shared
  `composerPanelAnchoring()` with a real width (`COMPOSER_MODEL_MENU_WIDTH`, 420).
  `components/ChatInput.tsx` passes it; a settings field keeps the old fixed box.
- Measured after: 390px viewport → panel 16…374 (358 = the page minus two 16px gutters),
  rows 340px, its bottom 700 against the strip's top 704 — it hangs above the strip that
  opened it. 1440px desktop → 420px wide at the composer's left edge.
- Tests: `lib/composer-panel-placement.test.mjs` (the picker takes the box's whole width
  on a phone and keeps its own width on a desktop; every composer menu goes through the
  helper, now four of them) and `components/ModelSelector.test.mjs` (the composer passes
  `composerAnchored`; the absolute branch precedes the fixed one; a phone gets the page).

## 2026-11-25 — the phone's Session stats card scrolls one way and reads top to bottom

A 390px screenshot of the Session stats card: a horizontal scrollbar under it, the
`Session File` path cut at the screen edge, and the tail of
`splash/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF:…` off to the right.

- Cause, measured in the running app: a grid track cannot shrink below its content's
  min-content. The card's stacked column was `1fr` (= `minmax(auto, 1fr)`), a cost row's
  label is a whole model id, and that label was `whiteSpace: "nowrap"`. The track grew to
  the id, the card grew past the phone, and `overflow-y: auto` turned the other axis into
  the scrollbar the user saw.
- `components/AppShell.tsx`: the stacked track is `minmax(0, 1fr)`; on a phone a field row
  and a cost row stack vertically (label on its own line, the value under it, wrapping),
  while the compact token/message columns stay tight; a non-compact label breaks
  (`overflowWrap: anywhere`, `wordBreak: break-word`).
- `app/native-theme.css`: `.session-stats-body` names `overflow-x: hidden` — the card
  scrolls vertically only.
- Verified live: 390px → `scrollWidth === clientWidth` (368/368), `overflow-x: hidden`,
  the card's right edge at 379 of 390, `Session File`/`ID`/`Active Time` values start on
  the line below their labels, no element is wider than its box. 1280px → the three
  columns (545/150/230) are unchanged, label and value share a row.
- Test: `components/AppShell.session-stats-phone.test.mjs`.

---

## 2026-11-26 — the phone pass: 12 items (`fix/flat-chat-blocks`)

`PLAN.md` holds the 12 items. Two commits are in: `e09f3eb7` (items 1-6, 8, 9, 12)
and `4a241d3e` (item 10). Items 7 and 11 are below.

### Done and verified
1. **Composer under the keyboard (1, 2, 3).** The fork's
   `html[data-keyboard-open] .chat-composer-controls { display: none !important }` hid
   the row's only flex filler, so a keyboard left `+` and Send and slid Send across the
   emptied row. Rule deleted. `e2e/composer-ios.mjs` (WebKit 390px) now compares the
   keyboard state to the resting one, control by control: the strip, the side-chat
   bubble and Send keep the same `x`, `y`, `w`; a control pass (the strip's fill and
   Send's auto margin both taken away) moves Send off the corner, so the geometry is
   bought, not given. `hooks/useViewportHeight.ts` gained `settleKeyboardViewportHeight`
   (the smallest reading wins while iOS's ~250ms slide is running: no travel past its
   place and back) and the travel is transitioned on `.app-shell` while the keyboard is
   open. The caret: `lib/composer-caret.ts` + `hooks/useComposerCaret.ts` focus and set
   the caret inside the finger's pointerdown (the card and the text area) and set the
   selection to itself after the lift lands — WebKit paints the caret where the field
   stood before the lift, and a tap on an already-`activeElement` field is no focus event.
2. **Appearance (4, 5, 6, 8, 9, 12).** `app/native-theme-phone-pass.test.mjs` and
   `e2e/thinking-preview.mjs` pin: the disc's missing border and two-layer shadow, the
   `--code-surface` token (`--bg-panel`; the old 8% mix measured 1 point per channel),
   the report as a panel at the thinking card's type, the thinking glyph on the
   conversation's ink edge (the card's own 10px inset) and its cut line ending with the
   three marks painted over the end, the sidebar's 12px seam, the phone's Settings
   separator starting at the label's letter. `e2e/code-background.mjs` now demands the
   fence stand off the page by ≥6 per channel.
3. **Terminal `+` (10).** Reproduced at 390px: `handleOpenTerminal` adopted the tab the
   cwd already had, so `tabs: ["pi-desk"]` before and after the tap. The strip's button
   passes `{ newTab: true }`; live after the fix `tabs: ["pi-desk", "pi-desk 2"]`, the
   button 36×36 on touch, its anchor grown with it. Two shells in a folder are numbered.
   `components/AppShell.terminal-plus.test.mjs`.
4. **The image overlay (7).** `components/ImagePreview.tsx` travels the pictures of its
   container (`[data-image-gallery]`, `.markdown-body`, `.message-assistant`,
   `.message-user`, read from the DOM at open, so the conversation decides the order):
   a finger's swipe (40px, horizontal-dominant), a trackpad's flick (60px of summed
   horizontal wheel delta, one page per burst, a 260ms rest after), the arrow keys, a
   ring in both directions, a count (`2 / 11`), 44px direction plates on touch only, a
   tap on the picture closes, and the neighbour is prefetched. The probe found a real
   bug: a swipe ends in a click of its own, and the mark that says "that click was a
   swipe" outlived it, so the *next* tap was swallowed — the mark is now cleared as soon
   as the click is answered. `e2e/image-swipe.mjs` covers the phone shape and the
   desktop shape on Chromium **and** WebKit; it is in the `test:e2e` chain.

### Verification so far
- `node_modules/.bin/tsc --noEmit` clean; `npm run lint` clean; `npm test` 4845 tests,
  0 failures at `4a241d3e`.
- `node e2e/composer-ios.mjs`, `node e2e/thinking-preview.mjs`,
  `node e2e/image-swipe.mjs` pass.

### In flight
- **Item 11 (the right panel's Git view)** is being built in a background subagent
  session (`01a214c8-1ee4-77bf-8e24-a32f5cf0d0f7`): a Git button beside
  `.file-tree-toggle`, branch tree → commits → diff, reusing `app/api/git/*`,
  `lib/branch-tree.ts`, `lib/git-changes.ts` and the existing diff view. It is editing
  `components/AppShell.tsx`, `app/native-theme.css`, `package.json`,
  `components/ModelSelector.tsx`, `components/path-ui.tsx` and adding
  `hooks/usePopTransition.ts`. **Its suite is not green yet**
  (`hooks/usePopTransition.test.mjs`: "SessionAutomationMenu holds its popup for the
  exit"). Do not commit those files until it reports; do not duplicate its work.

### Next actions
1. Land item 7's files (`components/ImagePreview.tsx`, `components/MessageView.tsx`,
   `components/ChatInput.tsx`, `e2e/image-swipe.*`, `package.json`, the CSS section) once
   the panel agent's tree settles; commit and push.
2. Review the Git-panel agent's diff as a whole, run the suites and the live measurement,
   then commit item 11 and push.
3. `npm run test:e2e` in full needs an isolated production build
   (`PI_WEB_DESKTOP_BUILD=1 …next build --webpack`) — never a plain `next build`.

### Live sweep, both themes, WebKit at 390px (the phone's engine)
Measured on the dev server with real sessions (`test-results/scratch/live-sweep2.mjs`,
`live-sweep-dark.mjs`; `test-results/` is gitignored):

| Item | Light | Dark |
|---|---|---|
| 6 — a code fence and its `pre` against the page | `#f0f0f1` on `#ffffff` → **15** per channel | `rgb(25,25,26)` on `rgb(36,36,36)` → **11** |
| 5 — a subagent report against the page | **15** | **11** |
| 5 — the report's type vs the thinking card's | `11px / 400 / 16.5px`, the same mono family | the same |
| 4 — the scroll-to-latest disc | `border-top-width: 0px`, `box-shadow: rgba(0,0,0,.45) 0 3px 10px, rgba(0,0,0,.35) 0 1px 2px` | the same |
| 8 — the thinking card's own inset | `padding-left: 0px` | the same |
| 9 — the search box's bottom to the `Chats` header's top | **16px** (12 + 4), not 8 | the same |
| 12 — a phone Settings row | `border-bottom: 0`, `::after` at `left: 52px` = `labelX: 52`, the icon ends at 38, the **last row's `::after` is `none`** | the same, on `rgba(255,255,255,.09)` |

No page errors in any run. The two checks that cannot be made from a desktop browser —
the iPhone keyboard's caret (item 2) and its travel (item 3) — are carried by
`lib/composer-caret.ts` + `hooks/useComposerCaret.ts` and
`settleKeyboardViewportHeight`, with unit tests and the WebKit row-geometry e2e.

### Blocker, and what is gated on it
The panel agent's in-progress edit left the shared dev server unable to compile
(`components/TopbarTip.tsx:119` — `Error: Expression expected`), so **every page of
`http://127.0.0.1:30141` is blank** while it works. Steering sent (it must land that file
compiling, keep `tsc`/lint/`npm test` clean, and report any popup-plumbing reach beyond
the Git view). Gated on it:
- item 1's live check on a real **running** session (`test-results/scratch/probe-composer-live.mjs`,
  written and ready: it compares each composer control's box with
  `html[data-keyboard-open]` on and off — the side-chat bubble, the control strip, the
  `More` button, `+`, Send — the WebKit fixture e2e already covers the same invariant);
- item 11's live measurement at 390px and 1280px, which is part of its acceptance.

Item 7's files (`components/ImagePreview.tsx`, `components/MessageView.tsx`,
`components/ChatInput.tsx`'s `data-image-gallery`, the CSS section, `e2e/image-swipe.*`,
`package.json`) are verified and **sit uncommitted in the shared tree** on purpose: the
agent is editing the same files, so a commit now would carry its unfinished work.

### Item 8, measured in a real conversation (not a fixture)
The live app puts a collapsed thought inside the turn's **Process details** plate, and
the row above it is the model/time row (`.message-assistant-model-time`), whose glyph is
the "clock icon above" the user meant. `test-results/scratch/probe-thinking-align2.mjs`
(WebKit 390px, session `01a21274-…`, the process group opened as a finger opens it,
58 thinking cards):

- `glyphX 24 == clockGlyphX 24 == modelRowX 24 == proseX 24` — the lightbulb stands
  exactly under the clock, and on the prose's edge (the card's own 10px inset used to
  push it to 34).
- a cut thought: `data-clipped="true"`, `scrollWidth/clientWidth 1632/312`, the three
  marks over the cut; a short one: `data-clipped=null`, `88/88`, no marks.

The plate is translucent (`.process-details-content` = `color-mix(in srgb, var(--surface)
34%, transparent)`), so the marks' `background: var(--bg)` cut a light rectangle into it.
The surface is now a token the context sets — `.thinking-card { --thinking-cut-surface:
var(--bg) }` and `.process-details-content .thinking-card { …: color-mix(in srgb,
var(--surface) 34%, var(--bg)) }` (the plate flattened). Pinned by
`app/native-theme-phone-pass.test.mjs` (8/8) and measured by `e2e/thinking-preview.mjs`,
whose fixture now draws a thought **inside** the plate and asserts the marks are opaque,
equal to the plate's flattened colour, and not the page's.

### Suite state while the panel agent works
`node --test app/native-theme-phone-pass.test.mjs` 8/8; `e2e/thinking-preview.mjs`,
`e2e/image-swipe.mjs`, `e2e/composer-ios.mjs` pass. `npm test` has **one** failure, and
it is the agent's own new file: `hooks/usePopTransition.test.mjs` →
"SessionAutomationMenu holds its popup for the exit". `tsc --noEmit` is clean again.

## The composer's project menu, covered by the header (dbc100f4)

**Report.** On a phone in Safari, opening the composer's project chip drew the list *behind*
the app header: the filter box, the current project and the first rows were cut in half and
unreachable (`fix/flat-chat-blocks`, iPhone 15 Pro width).

**Cause.** The menu hangs above the chip and was capped by nothing but its own
`min(60vh, 420px)`. On a phone `60vh` reads the **layout** viewport (the whole page, 956px),
while the app sizes its shell to the **visual** viewport the browser's bars shrink — so the
cap was taller than the space above the chip. The panel grew up through the chat window's
clipping box (`.chat-window` is `overflow: hidden`, and its box starts under the header) and
behind the topbar, which is a sibling of the chat column at `z-index: var(--z-chrome)` and is
drawn over it. The composer's slash/@ menus already carried this rule (#63); this menu never
applied it.

**Fix.** `components/ComposerProjectChip.tsx` now takes the composer's whole placement rule:
an explicit width inside the box the page can show (`composerPanelAnchoring`,
`PROJECT_MENU_WIDTH`), and a height capped by `getUpwardMenuMaxHeight` to the space between
the chip and the boundary above it — the clipper's top and the topbar's bottom — with the list
scrolling internally and a 120px floor. The vertical half of the rule
(`getVisibleTopBoundary`, `getTopbarBoundary`, `getUpwardMenuMaxHeight`) moved to
`lib/composer-panel-placement.ts`, next to the horizontal half, so the composer has **one**
topbar walk and one clip walk; `ChatInput` imports them and re-exports the two its callers
read. The panel's layer is the composer popovers' (`zIndex: 100`), not `500`: a panel capped
to the column never needs to paint over the chrome.

**Verification.**
- `e2e/project-chip-menu.mjs` (new, run with `node e2e/project-chip-menu.mjs`) mounts the real
  chip in the app's chrome with the phone's viewport split reproduced (a 440x956 page, a
  480px shell) and asks every row whether it is painted below the header and inside the
  window: the panel starts at 58px against the 48px header, 12 rows painted, and the scroll
  reaches the last project; on 1280x800 it starts at 334px inside the column. The `?broken=1`
  pass serves the pre-fix panel and measures it at 17px — under the header, one row covered —
  so the check keeps its teeth. Screenshots: `test-results/project-chip-menu/*.png`.
- `components/ComposerProjectChip.test.mjs` (new) and
  `lib/composer-panel-placement.test.mjs` pin the wiring, the cap's numbers, the topbar's
  overlap/above rules, the clip walk, and that no component reimplements the walks.
- Verified in a detached worktree at the commit: `tsc --noEmit` clean,
  `components/ComposerProjectChip.test.mjs lib/composer-panel-placement.test.mjs
  components/ChatInput.test.mjs scripts/ui-menu-consistency.test.mjs
  components/fork-extractions.test.mjs` → 137/137, and the e2e above.

**Left alone.** The panel/pop-transition work in the tree (`hooks/usePopTransition.ts`,
`components/ComposerProjectChip.tsx`'s `pop`, `AppShell`, `ImagePreview`, `ModelSelector`,
`path-ui`, `native-theme.css`, `package.json`, the `lib/git-*` and `app/api/git/*` files) is
another agent's uncommitted work: it stayed unstaged, and the commit is this fix only. The
chip keeps `usePopTransition` in the working tree, so
`hooks/usePopTransition.test.mjs` stays satisfied by that agent's pass.
`e2e/project-chip-menu.mjs` is not in `package.json`'s `test:e2e` chain: that one long line
carries the other agent's uncommitted `image-swipe` entry, so wiring it is theirs to commit.

## 2026-11-26 — the second phone pass (4 items from the screenshots)

1. **The sidebar's search box is a label.** `lib/i18n/locale-plugins.ts` — all three
   packs: `"Search titles…"` / `搜索标题…` / `搜尋標題…`, the `· Enter for full text`
   clause dropped (in a 272px box it was cut to `…full te`, which reads as damage). The
   Enter gesture keeps its discoverability where it already had it: the input's
   `title={t("sidebar.searchAllHint")}`. Pinned in
   `components/SessionSidebar.session-search.test.mjs` (all three packs carry no `·` and
   no "Enter" in the label, and the tooltip key stays) and in
   `app/native-theme-phone-pass.test.mjs`.
2. **"Branch in new chat" is gone from the phone.** `components/MessageView.tsx` names
   the chip `message-branch-action`; `app/native-theme.css` hides it at
   `(max-width: 640px)`. It needs `display: none !important` — the chip is drawn with an
   inline `display: flex`, and the first version lost to it (the probe measured
   `branchVisible: 8` on the phone and caught that). Live: phone `branchCount 8 /
   branchVisible 0`, desktop `branchVisible 8` — the chip stays where a cursor can aim,
   and the same action is in the composer's branch chip and the sidebar's Fork.
3. **A tool call's band is deeper.** The card's inline 4%/5%/6% wash (1–9 points off the
   page) is a class — `tool-call-card` + `is-error` / `is-aborted` — painted in
   `app/native-theme.css` at `rgba(34,197,94,.085)` / `rgba(248,113,113,.1)` /
   `rgba(148,163,184,.11)`: over `#fff` the normal state lands ~21 points off the page
   where the old tint was ~9. Live: `rgba(34, 197, 94, 0.086)` on the running app.
4. **The clock beside a reply's model is the app's 12px glyph** (`<ClockIcon size={12} />`,
   was 10 — a dot at a phone's distance; the footer's duration keeps its 11). Live: the
   glyph box is `12×12`.

### Test alignment this pass (the changes moved pinned markup)
`components/MessageView.test.mjs` (the rendered tool call now asserts
`class="tool-call-card"` / `"tool-call-card is-error"`, not the inline wash),
`components/sidebar-and-message-updates.test.mjs` (the aborted state: the class in the
markup **and** the slate rule in the stylesheet),
`components/MessageView.subagent-report.test.mjs` (the 12px clock, with the reason),
`components/MessageView.turn-duration.test.mjs` (the branch chip's name, and the phone
rule that hides it), `components/SessionSidebar.session-search.test.mjs` (the label).
`components/ImagePreview.tsx`'s Escape handler was reshaped to the guard the a11y test
pins (`event.key !== "Escape"` first), keeping the arrows and the `stopPropagation`.

### Suite state
`tsc --noEmit` clean; `npm run lint` clean; `npm test` 4881 tests, **4877 pass, 3 fail**.
Two of the three were mine-by-inheritance (`components/AppShell.chat-workspace.test.mjs`
pinned `handleOpenTerminal` and `onNewTerminal` as they were *before* item 10 — the chat
guards are still asserted, now against the shape with `{ newTab: true }`) and are green.
The last one, `components/side-chat.test.mjs` → "side chats open in right-panel tabs
that leave the global Esc to the main chat", is the **panel agent's**: its `<GitPanel>`
turned the side-tab branch into a chained ternary
(`{gitPanelOpen && visibleProjectCwd ? … : activeSideTab ? …`), so the pinned
`{activeSideTab ? (<div className="session-chat-panel" …` no longer matches. The markup
itself is intact at `components/AppShell.tsx:3734`. Its lane, its alignment.

### Uncommitted in the shared tree (deliberate)
Item 7 (the image overlay) and this pass's CSS all touch `app/native-theme.css`,
`components/ChatInput.tsx`, `components/AppShell.tsx` and `package.json`, which the panel
agent is editing. `git status` also carries its in-flight work, so nothing of mine is
committable without taking its unfinished files along. Land in two commits when it
reports: the phone pass (items 7 + these 4) and item 11.

### Item 11, frozen: the right panel's Git view (branch tree → commits → diff)

Landed, and measured. The Git button is a sibling of the file list's toggle in
`div.right-panel-tab-strip` (`components/AppShell.tsx`), guarded by
`visibleProjectCwd && !isChatWorkspaceActive`; both toggles are `order: -1`, so the panel's
two view toggles lead the row. One state flag (`gitPanelOpen`) opens `components/GitPanel.tsx`
in the panel's content area; the side-chat tab and the panel's empty state step aside with it
inside one guarded branch, so `components/side-chat.test.mjs`'s pinned
`{activeSideTab ? (<div className="session-chat-panel" …` markup is untouched (it was broken
for a minute by a chained ternary — that shape is why the branch is a fragment, not a chain).
The project's shells stay mounted, `hidden` and not-active.

Three levels, no second anything: the branch rows are the composer menu's rows
(`fetchProjectBranchMenu` / `buildBranchRows` / `buildBranchTree` / `flattenBranchTree` /
`filterBranchRows` / `currentCheckout`, same glyphs, same `remote` tag), the patch is painted
by the file viewer's exported `DiffView`, one file's section is cut by `patchForFile`
(`lib/patch.ts`), and a file row opens through the shell's `handleOpenFile`. The commits and
the commit's patch come from `app/api/git/commits` and `app/api/git/commit-diff`, over the one
git runner (`runGit`, exported from `lib/git-changes.ts`) by `lib/git-log.ts`. No timer reads
git; the two reload buttons are the only other entry.

Measured: `node e2e/git-panel.mjs` (fixture, 390 touch and 1280) — button 36×36 at x=51 with
the file list's toggle 36×36 at x=11 (28×28 at 1280), 8-branch tree with a foldable `chore/`
group, filter box, 2 commits, a merge's first-parent note, a two-file diff, a file row
narrowing the patch, `__opened = ["/repo/app/native-theme.css", "native-theme.css"]`, and
`scrollWidth 390 <= 390` at every level. `node e2e/git-panel-live.mjs` (the shared dev server,
390 WebKit touch + 1280 Chromium): `.app-shell` 390×844 and `.chat-composer` 342×114 on
screen, the button fully on screen and hit-testable, 48 real branch rows, current branch
`fix/flat-chat-blocks`, 40 real commits (`601b5ff4 …`), a 1-file 59-line diff, no sideways
page scroll at either width.

Reverted on the way to the freeze (they were not this brief): every popup-plumbing edit —
`components/ProjectPicker.tsx` back to `HEAD` (it was a syntax error at :429 and the shared
server was serving blank pages), and my `usePopTransition` calls in
`components/ProjectViewMenu.tsx`, `components/ChatsSectionMenu.tsx` and
`components/ProjectContextMenu.tsx` removed, keeping the `closing` / `popClass` lines that
belong to the phone pass. `hooks/usePopTransition.test.mjs` is green with the tree as it
stands.

## Clicking Expand / Collapse sent the page to its bottom

Reported after the phone pass. Reproduced live (`test-results/scratch/probe-expand-toggle.mjs`,
390px WebKit, sessions `01a214c7…` / `01a214c8…`): a row that grows does it under the finger.
The tapped bubble's row kept `scrollTop` while its own height went 284 → 1351, so the control
at the bubble's bottom travelled from y=275 to y=1342 — off the viewport; a reader who was near
the tail was then answered by the stream's tail-follow (`useAgentSession`'s
`isNearBottom` → `scrollToBottom("auto")`), and the conversation snapped to its end. The
"sometimes" is the tail-follow: it only fires for a reader the scroll listener believes is
at the tail.

**The fix** (`components/ChatWindow.tsx`, `handleContentToggle`): the tapped row is anchored
with the mechanism the older-pages prepend already owns (`scrollAnchorRef` +
`applyScrollAnchor` + the shared 1500 ms window), and every Expand/Collapse announces itself
before it flips its own state — a long prompt, a slash command, a compaction note, a subagent
report. An off-screen control is left alone, so the app never moves the page by itself. The
row is put back at 200 ms and 450 ms because a bubble whose cap is lifted keeps settling.

Measured after: `rowTop 46 → 46 → 46` through open and close on the long prompt, no
`distanceToTail` ever reaching the tail from mid-scroll, no page jump on the compaction card.
A collapse near the top of a short scroll can still shift by the amount the clamp allows —
that is the browser's arithmetic, not the app's.

**A first attempt was rejected, not left in**: fetching the control to the nearest edge
(`scrollIntoView`) fought the anchor over `scrollTop` (rows measured −1110 px, +835 px) and is
exactly how a reader ends up at the tail. The test asserts `scrollIntoView` stays out of the
handler.

Pinned by `components/ChatWindow.content-toggle.test.mjs`. Four `MessageView` pins that read
the toggles' markup now expect the announcement (same meaning, new shape).

## Commits of this pass (pushed to `fix/flat-chat-blocks`)

- `70560841` fix: the phone pass — the image overlay travels, the chat's blocks read deeper
- `681f991e` fix: Expand/Collapse keeps the tapped row in place, so the chat stops jumping
- `a426e9ae` feat: the right panel's Git view — branch tree, commits, one commit's diff

Verification at the tree: `tsc --noEmit` clean; `npm run lint` clean (9 pre-existing
warnings); `npm test` 4893 tests, 4892 pass, 1 skipped, 0 fail; `e2e/git-panel.mjs`,
`e2e/git-panel-live.mjs` (the live repo at 390 touch and 1280), `e2e/image-swipe.mjs`,
`e2e/thinking-preview.mjs`, `e2e/composer-ios.mjs` all green.

**Left in the working tree, not this task**: the composer-menu pop-transition lane
(`components/AppCombobox.tsx`, the chips, the menu components, `ComposerReasoningRows.tsx`,
`ComposerToolPresetRows.tsx`, `lib/composer-option-data.ts`, `lib/composer-textarea-height.ts`)
and `e2e/tmp-labels.mjs`, `e2e/tmp-pop-check.mjs`. `components/AppShell.tsx` carries that
lane's `usePopTransition` wiring and `hooks/usePopTransition.ts` is committed with it, because
AppShell imports it — the staged tree was checked to resolve every `@/` import.

## WIP: the phone composer becomes one row, with a `+` that carries the controls

**Ask (three items).** (1) An empty composer is ONE row like ChatGPT's phone composer
(`+`, the text, Send); every other control is collected behind the `+`, whose menu lists
them, breathes red while the session compacts, and carries a "stop compacting" row.
(2) On a new session, the project and branch chips move to a strip **below** the composer
card. (3) Typing past one line grows the card smoothly, and deleting back to one line
shrinks it smoothly.

**Read before writing** (`modern-web-guidance`): `interpolate-size` / `calc-size` are
Chrome/Edge-only (Safari and WKWebView jump), so the smooth growth is a px→px height
transition driven from JS: measure with the `height: auto` step and undo it in the same
task, write the target on the next frame. `field-sizing: content` is the same story, and
the grid mirror is the heavy fallback: not needed.

**Groundwork done (uncommitted).**
- `lib/composer-textarea-height.ts` (new): `measureComposerTextarea` (measures and leaves
  the previous height painted, so no frame is ever painted at `auto`),
  `growComposerTextarea` (writes the target on the next frame: px→px, animatable),
  `COMPOSER_TEXTAREA_MAX_HEIGHT = 200`, and a reduced-motion path that writes at once.
  All 13 auto-grow sites in `components/ChatInput.tsx` now call it.
- `lib/composer-option-data.ts` (new): `TOOL_PRESETS`, `TOOL_PRESET_MAP`,
  `TOOL_PRESET_DESC_KEYS`, `THINKING_LEVELS`, `THINKING_LEVEL_DESC_KEYS`,
  `visibleThinkingLevels` — moved out of ChatInput, which is to import them.
- `components/ComposerReasoningRows.tsx`, `components/ComposerToolPresetRows.tsx` (new):
  the level rows and the preset rows, with the host's `onPick` (the desktop closes, the `+`
  menu returns to its hub) and a `footer` slot for the chat-only block.
- `components/SessionAutomationMenu.tsx`: the panel body is now the exported
  `SessionAutomationRows` (compact row + the automation switches); the panel keeps
  placement and passes `onClose`.
- `components/ModelSelector.tsx`: the list body is the local `ModelListBody` and the
  exported `ModelSelectorList` (filter box, provider groups, default star) for a host that
  owns its panel. One list, one filter, one star.
- `components/ComposerPlusMenu.tsx` (new): the `+` trigger, the hub rows (Stop compacting
  while compacting, Attach, Model, Reasoning, Tools, Session automation — each carrying the
  value it is at), the pages (the lists above), `composerPanelAnchoring` +
  `getUpwardMenuMaxHeight`/`getVisibleTopBoundary` for the panel,
  `data-compacting` for the breathing glyph. `COMPOSER_PLUS_MENU_WIDTH` still has to be
  added to `lib/composer-panel-placement.ts`.
- `components/ComposerContextChips.tsx` (new, LIKELY DROPPED): `fork-extractions.test.mjs`
  requires `<ComposerProjectChip` and `<SessionAutomationMenu` to stay in ChatInput.tsx, so
  the chips are mounted directly by ChatInput in both places, not through a wrapper.

**The rest, in order.** ChatInput: `data-inline` on the editor (+ the tier-aware
`flexDirection`/textarea `flex`), the phone's `+` (keeps `composer-attach-button` so the
existing CSS/fixture needles survive) in place of the attach button, the phone's More button
/ strip / strip-close / narrow grid gone, the chips mounted in the strip under the card, the
`+` menu's props built from the state ChatInput already has, `plusMenuOpen`/`plusMenuRef`
into the one outside-click handler and `useMenuNavigation`. Then
`COMPOSER_PLUS_MENU_WIDTH`; the CSS (one row, the strip under the card, the breathing
glyph, the height transition, reduced motion, delete the dead
`.composer-controls-strip[data-strip-open]`/`.composer-controls-close` rules); i18n
`chat.composerPlus`, `chat.composerPlusModel` in all three `FORK_MESSAGE_PATCHES` blocks
(`lib/i18n/registry.test.mjs` demands key parity); then the tests:
`ChatInput.composer-row.test.mjs` (rewritten: it pins the More button, the strip,
`textareaAt < rowAt`, the textarea margins — keep a line with `data-keyboard-open` +
`chat-composer-controls`, which `app/native-theme-phone-pass.test.mjs:107` reads),
`MobilePwaLayout.test.mjs` (the textarea `flex` needle), `CostRouting.wiring.test.mjs`
(both routed-hint placements), `composer-ios.mjs` (fixture needles + the fixture),
`option-controls.mjs` (it clicks 更多控件 on a phone), `e2e/composer-geometry.mjs`
(tier-aware `textAboveRow`, the `+` selector, and a settle that waits out the height
transition before the arc and height assertions), plus a new
`components/ComposerPlusMenu.test.mjs`, `lib/composer-textarea-height.test.mjs` and
`e2e/composer-plus.mjs`.

**Not touched.** The concurrent agent's uncommitted work (the `usePopTransition` pop path,
`AppShell`, `ImagePreview`, `path-ui`, `native-theme.css`'s pop/`is-closing` rules, the
`lib/git-*` files). `hooks/usePopTransition.ts` is untracked, so nothing new imports it:
`ComposerPlusMenu` mounts its panel on `open` only.

## 2026-11-26 — the collapsed thinking's cut marks are reverted (`fix/flat-chat-blocks`)

**The ask.** The user's screenshot of a collapsed thinking: the lightbulb, one line of
reasoning, and the line ending mid-word (`…So tr`) with no mark naming the cut. Today's
thinking work (e09f3eb7, 70560841) is reverted; the rest of those two commits stays.

**What the day had built, and what went back**
- `components/MessageView.tsx` — `THINKING_MORE_MARKER = "•••"`, the `useIsTextClipped`
  ResizeObserver hook, `previewHasMore` / `previewRef` / `previewClipped`, and the
  `className="thinking-card"` / `className="thinking-preview"` + `data-clipped` markup.
  Gone. The card is the pre-today node again: a plain `div` with its inline styles and a
  preview `span` with `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.
  `MessageView.tsx` is byte-identical to `e09f3eb7^` in the whole `ThinkingBlock` region;
  the `RefObject` import that only the hook used is gone.
- `app/native-theme.css` — the `.message-assistant .thinking-card { padding-left: 0 }`
  alignment rule, the `--thinking-cut-surface` token (page and Process-details plate),
  `.thinking-preview { text-overflow: clip }`, the `::after { content: "•••" }` plate over
  the cut, and `.thinking-preview-dots`. All removed.
- `app/native-theme-phone-pass.test.mjs` — the "three marks" test is replaced by
  "a turn's Process details group stands on a translucent plate", which keeps the plate
  assertion (that rule predates today, from `bece22e5`) and drops the thinking ones.
- `e2e/thinking-preview.mjs` and `e2e/thinking-preview.fixture.jsx` (both created today)
  are deleted, and their `test:e2e` entry is out of `package.json`.
- Untouched: the expansion rule (`expandedByRule`, the newest-block handover, the
  preference switch), `getThinkingPreview` (240 chars, first line — predates today), the
  Process-details plate, the tool-call band, the image overlay, `onContentToggle`.

**Why revert rather than tune.** The marks only appear while the box clips the line, and
the clip is measured against the span's own box; in a real conversation (the screenshot)
the line ends inside the box, the measured clip is false, and the reader gets a hard cut
mid-word with nothing after it. The old `text-overflow: ellipsis` never lies: the browser
paints the ellipsis exactly where it cuts.

**Verification**
- `node_modules/.bin/tsc --noEmit` clean; `npm run lint` 0 errors.
- `node --test` over `components/MessageView*.test.mjs` + `app/native-theme-phone-pass.test.mjs`
  + `app/native-theme-chat-flat.test.mjs`: 76 pass / 1 fail — the one failure is
  "the scroll-to-latest disc has no edge and a shadow that lifts it", which fails
  identically at `HEAD` (verified in a detached worktree): pre-existing, not this change.
- `node e2e/thinking-latest.mjs` fails at its handover assertion (`1:01,2:0` where
  `1:00,2:1` is expected) **identically at `HEAD`** — a pre-existing failure on this
  branch, recorded here so it is not mistaken for the revert.

## 2026-11-26 — the thinking card gets its own wash (`fix/flat-chat-blocks`)

**The ask.** "give the thinking card a background color: #00a8ff21" — the reverted
thinking block still painted `background: var(--bg)` inline, so it was the page and read
as prose, exactly the complaint that put the chat's blocks on fills in the first place.

**What changed**
- `components/MessageView.tsx` — the `ThinkingBlock` card is `className="thinking-card"`
  and the inline `background: "var(--bg)"` is gone, so the stylesheet owns the fill (the
  `.tool-call-card` pattern: class on the node, depth in CSS, no `!important` needed).
  The inline `fontSize`/`lineHeight` stay — the report's type is measured against them.
- `app/native-theme.css` — `.thinking-card { background: #00a8ff21; }` beside the tool
  call's band. A literal, not a palette token: the app ships a dozen palettes and the
  card is meant to read the same in all, and the `21` alpha (13 %) sits on top of what
  the card stands on — the light page, the dark page, a turn's Process-details plate.
- `app/native-theme-phone-pass.test.mjs` — a new test pins the fill, the class on the
  node, and the absence of the inline page colour (which is what lets the rule win).

**Verification**
- `node --test` over `app/native-theme-phone-pass.test.mjs` + `app/native-theme-chat-flat.test.mjs`
  + `components/MessageView.compaction-and-thinking.test.mjs` + `components/MessageView.latest-thinking.test.mjs`:
  22 pass / 1 fail — the one failure is the known pre-existing scroll-to-latest disc
  assertion, byte-for-byte the failure at `HEAD`.
- `node_modules/.bin/tsc --noEmit` clean; `npm run lint` 0 errors (15 warnings, pre-existing).
- Rendered the real component in Chromium (`e2e/thinking-latest.fixture.jsx` in the
  harness's own bundle-and-serve loop): computed `rgba(0, 168, 255, 0.13)` on the card in
  both themes (page `rgb(240, 240, 241)` light, `rgb(25, 25, 26)` dark), screenshots read
  as a blue band in each; the card's box (radius 8px, 6px/10px padding) is unchanged.
  The throwaway probe script lived in gitignored `test-results/` and is deleted.

## 2026-11-26 — the extension status strip reads in the Session stats card

The user's pic1: a bordered strip under the composer carrying one green `LSP`,
and the request was to move that strip into the header's **Session stats** card
(pic2, the More menu's last row).

**What changed**
- `components/ExtensionStatusLine.tsx` — `visibleExtensionStatuses()` (key order,
  ANSI-blank statuses dropped) and `ExtensionStatusList` (one row per status,
  ANSI colors kept, full text in the tooltip). The old `ExtensionStatusLine`
  (one 17px folded line) and `formatExtensionStatusLine` are gone.
- `components/ChatWindow.tsx` — the composer's `.extension-status-shelf` keeps
  only the extension widgets; the statuses are lifted to the shell with
  `onExtensionStatusesChange` and cleared on unmount, so a session switch never
  shows the session that was left.
- `components/AppShell.tsx` — an **Extensions** section under the stats card's
  head, plus `sessionPanelHasContent` (stats, context, or statuses) so the More
  menu's row opens for a session that has only a status to report.
- `app/native-theme.css` — `.session-stats-extensions`, `.session-stats-section-title`,
  `.session-stats-status-list/-row` (the card's mono caption, rows that wrap; the
  17px clip is not reused).
- `lib/i18n/locale-plugins.ts` — `session.extensions` in en / zh-CN / zh-TW.
- `components/ExtensionStatusLine.test.mjs` — the rows, the key order, the blank
  filter, and the wiring: hook → ChatWindow lift → AppShell card, and the strip
  pinned to the widgets only.
- Docs: `docs/agents/sessions.md` (the status-bar section), `docs/agents/fork-ui.md`
  (the stats card), `docs/agents/client-platform.md` (the keyboard rule's class).

**Decision** — the widgets stay under the composer: an interactive control that
expands a panel cannot live in a header card that closes on the next click.
See DECISIONS.md.

**Verification**
- `node --test components/ExtensionStatusLine.test.mjs`: 5 pass.
- `node_modules/.bin/tsc --noEmit` clean; eslint clean on the four changed sources.
- Full unit suite (`node --test`, 4891 tests): 4880 pass / 10 fail, and every
  failure is in a file this task did not touch (the composer/`ChatInput` rows,
  the pop-transition hook, the sidebar, the upstream CSS baseline) — the tree
  carries another agent's in-flight edits beside mine.
- Live in Chromium against the dev server, on a session whose strip said
  `LSP ts/txt`: the strip is gone (`.extension-status-shelf` absent), the card
  shows one green row `LSP ts/txt` with the plain tooltip, and the card's
  `scrollWidth` equals its `clientWidth` at 1440px and 390px.
