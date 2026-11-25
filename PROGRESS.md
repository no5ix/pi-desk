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
