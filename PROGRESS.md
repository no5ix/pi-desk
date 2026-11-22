# PROGRESS

## Done
- `74f4e582` — items 1-4 (web Finder pick, topbar branch, Tailscale Serve at startup, local macOS notification). `tsc --noEmit` clean, `eslint` clean. Notification sentence verified against the user's example.

## Verified
- Phase A: 41/41 tests green (`lib/completion-notification`, `lib/tailscale-serve`, `lib/apple-script`, `lib/project-directory-pick`, `app/api/cwd/pick/route`, `app/api/notifications/local/route`, `components/AppShell.topbar-branch`, `components/SafariNotificationSection`, `hooks/useAgentSession.run-timing`). They found real gaps in the *tests'* assumptions, not the code: the header keeps `<small class="app-topbar-project">` (not a bare `<small>{topBarSubtitle}</small>`), the sidebar adopts a picked folder through `activateProject`, and the header's project branch comes from the `useProjectBranch` hook module (`activeProjectBranch`), not from state in AppShell.

## Done (Phase B)
- **ntfy (task 1)**: `lib/ntfy-settings.ts` (in `~/.pi/agent/pi-web/settings.json` under `ntfy`, via lib/artifact-settings.ts), `app/api/notifications/ntfy/route.ts` (GET masks the topic for non-local pages, PUT local-only, POST publishes Title/Priority/Tags), `lib/ntfy-notification.ts`, `components/NtfyNotificationSection.tsx` (Server url default `https://ntfy.sh`, Topic name, switch, **Send Test Notice**), SettingsPanel General row, AppShell completion sends the same sentence to the Mac *and* the topic. i18n ×3 locales. Tests: `lib/ntfy-settings.test.mjs` (8), `app/api/notifications/ntfy/route.test.mjs` (7), `components/NtfyNotificationSection.test.mjs` (5).
- **Duration beside Copy (task 2)**: `ChatWindow` memo `turnDurationByIndex` (uses the previously-unused `getTurnDurationMs`) keyed to the reply that closes a turn; `MessageView` prop `turnDurationMs` + `.message-turn-duration` between the Copy button and the timestamp (memo comparator extended); `formatDurationHms` so the shape is `0h31m10s`; `chat.turnDurationHint` tooltip ×3 locales. Test: `components/MessageView.turn-duration.test.mjs` (5).
- Verified: `tsc --noEmit` clean, `eslint` clean, 23/23 in the ChatWindow/MessageView/ntfy batch.

## Done (Phase C — tasks 3-6)
- **Sidebar fold animation (task 3)**: `lib/sidebar-fold-motion.ts` (`useCollapseExit` keeps a closing fold's rows mounted for one animation length, `SIDEBAR_FOLD_MS` = `--dur-base`); `data-fold="open|closing"` on `.sidebar-project-tree-children`; `@keyframes sidebar-project-fold-open/close` + `@starting-style` (grid rows + opacity) with the `interpolate-size` fallback for Safari < 18.1, content fade on the project branch, and a `prefers-reduced-motion` rule. Focus and the tree's keyboard/roving navigation skip `[data-fold="closing"]` rows. Test: `lib/sidebar-fold-motion.test.mjs`, plus CSS assertions in `components/SessionSidebar.project-fold.test.mjs`.
- **Stale transcript on open (task 4)**: the reads of a session (the forced open read, hydration, reconcile, the SSE settle handler) raced — responses land in any order, and an older response describes an older transcript, so a session opened without its final report and a reload fixed it. `lib/session-load-order.ts` gives every read a ticket and `useAgentSession` applies data only while its ticket is the newest claim (the pagination path already had this rule as `contextLoadIdRef`). Server side unchanged: `?force=1` keeps `evictIfDiskAhead()`. Tests: `lib/session-load-order.test.mjs`, `hooks/useAgentSession.session-load-order.test.mjs`.
- **Compaction card (task 5)**: `CompactionMessageView` opens collapsed; its header (the `compaction` / `branch summary` label and the time) is a real `<button aria-expanded>` with a chevron that opens the summary, the description and the file lists. CSS in `app/native-theme.css` (hover, focus ring, chevron, reduced motion); `chat.expandCompaction` / `chat.collapseCompaction` ×3 locales.
- **Thinking cards in Process details (task 6)**: `components/process-details-context.ts`; `ProcessDetailsGroup` wraps its children in the provider, and a `ThinkingBlock` inside it starts collapsed even with the "expand thinking by default" preference on (the preference keeps ruling a thinking card shown on its own and a live reply, and flipping it in Settings keeps group cards collapsed). A context, so no upstream prop chain moved.
- Test sentinels that had pinned the old shape were updated to the new contract: `hooks/useAgentSession.test.mjs` (agent_end carries the run's clock through `endRunTiming`), `components/NtfyNotificationSection.test.mjs` (the sentence template is fetched as `t: translate`, the key is a template for `formatCompletionSummary`).

## Verified (Phase C)
- `node_modules/.bin/tsc --noEmit` clean; `node_modules/.bin/eslint . --quiet` clean (repo-wide).
- Full suite (`node --experimental-strip-types --test --test-concurrency=4` over app/lib/scripts/components/hooks/relay/relay-shell/public): **4361 tests, 4357 pass, 1 fail, 3 skipped** — the one failure is pre-existing, see BLOCKERS.md.
- `npm test`'s `pretest` (`check:deps`) required a real `npm ci` in this worktree (its `node_modules` was a symlink to the main checkout, newer than this branch's lockfile). After `npm ci`, `scripts/check-installed-deps.test.mjs` and `scripts/preview-runtime.test.mjs` pass.
- `app/api/models/route.test.mjs` failed on this machine only: the fixture pins a temp `PI_CODING_AGENT_DIR`, but the SDK also lists every provider the *environment* has credentials for (an `ANTHROPIC_API_KEY` here adds Anthropic's models). Its vacuity guard now checks the fixture's own provider is present instead of the whole list; the real assertion (the removed worktree answers the repo's list) is unchanged. Passes.
- Dev-server smoke test (`next dev -p 30151`, `PI_WEB_DISABLE_TAILSCALE_SERVE=1`): Ready in 163 ms; `/api/notifications/local` → `{supported:true,local:true}`; POST → `{sent:true}` (a macOS notification appeared); `/api/notifications/ntfy` → the defaults; `/api/worktrees?cwd=` → the project payload with `branch`.
- Tailscale Serve startup, on the real machine: `startTailscaleServeAtStartup()` found no serve config, ran `tailscale serve --bg 30141`, and printed one green-wrapped `tailscale serve status` block naming `https://macb00kpr0m4.taila0e40f.ts.net` with `/ proxy http://127.0.0.1:30141`. That also restored the tailnet listener this machine had lost (see BLOCKERS.md).

## Fixed after the user ran the branch (`npm run dev`)
- **The dev page showed none of the new code, with a hydration mismatch.** A service worker
  registered by a production run on the same origin (`npm start`, the packaged app, port
  30141) answers `/_next/static/**` cache-first, and development chunk URLs are not
  content-hashed — so the browser kept the previous build's bundles under the fresh HTML.
  `components/PwaRegistration.tsx` already skipped registering in development, but skipped
  without removing the worker that was left; it now drops the worker *and* its `pi-web-*`
  caches there, as the desktop branch of the same effect has always done. The worker itself
  is unchanged: production chunks are hashed and cache-first is right.
- `hooks/useProjectBranch.ts` seeded its first render from a module-level cache the server
  never fills; that paints a branch the HTML has not got and React discards the subtree.
  The first render is now `null` and the effect serves the cache, the pattern
  `hooks/useResizablePanel.ts` and `hooks/useI18n.tsx` use.
- Tests: `components/PwaRegistration.test.mjs` (4) and a hydration assertion in
  `components/AppShell.topbar-branch.test.mjs`. Suite: 4366 tests, 4362 pass, 1 pre-existing
  failure, 3 skipped. `tsc --noEmit` and `eslint` clean.

## Next
1. Runtime checks the suite cannot make, in Safari (the user's browser): the Finder panel from **Add project** on `http://localhost:30141`, the header's branch label, the sidebar fold animation, the completion notification sentence, ntfy's **Send Test Notice** on a real topic.
2. Decide the two open questions in BLOCKERS.md (the local gate for Finder picking over the tailnet hostname; the pre-existing Chat-only integration failure).

---

## Phase C2 — the three fixes the user asked for after manual testing (2026-11-22)

### 1 · Add project: Cancel in Finder opened a second window

`handleAddProject` treated every non-path answer as "the native panel is unavailable" and
opened the in-app typed picker. Cancel is an answer — the Finder panel opens, the user
dismisses it, and a "Type or choose a project folder" panel appeared over the chat.

- `lib/project-directory-pick.ts` now answers `{ status: "picked" | "cancelled" | "unavailable", … }`.
  Cancel, and a panel already open (409), are `cancelled`; a non-macOS server, a remote
  page (403), a Finder failure, a missing path and network failures are `unavailable` with
  the reason.
- `components/SessionSidebar.tsx`: `picked` activates, `cancelled` does nothing,
  `unavailable` opens the typed picker. The typed panel is the fallback for a server that
  cannot show a panel, never for a dismissed one.
- `app/api/cwd/pick/route.ts` unchanged (one panel per process, `isLocalRequest()`, macOS only).

### 2 · ntfy: `Send Test Notice` failed, the normal notice arrived

`Cannot convert argument to a ByteString … index 17 … 8212`: a header value is a
ByteString (one byte per character) and the test title is `Pi Agent Desktop — test` —
index 17 is the em dash (U+2014 = 8212). `fetch` threw **before** the request went out, so
the button always failed; a finished task titled with an ASCII session name published
fine, which is why one path worked.

- `lib/ntfy-settings.ts` adds `ntfyHeaderValue()`: UTF-8 bytes carried as latin-1
  characters, which is the encoding ntfy decodes, and trims by characters so a long CJK
  title never splits a byte.
- `buildNtfyRequest` sends `Title: ntfyHeaderValue(title)`. The body was always fine — it
  is the request body, not a header.
- Panel layout (the screenshot's squeezed status column): the status line (`Saved.`, the
  hint, the failure) belongs to the switch's text column and stacks under the title;
  **Save** / **Send Test Notice** moved to `.ntfy-notification-actions` below the fields.
  The fields stack (label + input) in `.ntfy-notification-fields`, so the labels and the
  buttons no longer share one row with the switch.

### 3 · The project fold was not smooth

Root cause: the CSS animated `clip-path`, `opacity` and `transform`, and an `auto` height
through `@starting-style` + `interpolate-size` **only where supported**. A `clip-path`
change paints; it does not change the layout height, so the rows below never moved during
the animation — they jumped when React unmounted the rows, whose timing was a 250 ms
`setTimeout` in the component. `interpolate-size` is opt-in and newer than the Safari this
macOS targets (26.3), so the transition often simply did not exist.

- `lib/sidebar-fold-motion.ts` rewritten: `applySidebarFold(element, {closed, animateOpen,
  onSettled})` measures `offsetHeight`/`scrollHeight`, writes a pixel start in the first
  commit and the end on the next frame, transitions `height`, `opacity` and
  `padding-bottom` (`--dur-fold: 240ms`, `--ease-fold: cubic-bezier(0.32, 0.72, 0, 1)`),
  and releases the closing rows on `transitionend` (`SIDEBAR_FOLD_SETTLE_MS = 360ms` covers
  a transition that never reports, e.g. a hidden tab). Opening starts at 0 and clears the
  inline height at the end, so the layout owns it again.
- The animation state lives on the element (`data-fold-applied`), not in React state, and a
  `WeakMap` detaches the previous `transitionend` listener: rapid clicks replace the
  transition from the height reached, the element is never unmounted mid-flight, and a
  re-render never restarts the animation.
- `useProjectFold(collapsedProjects)` (one hook for the project loop, so the hook count
  stays) returns `closing`, `opening`, `settle`. **`opening` is computed during render** —
  the element's `ref` runs before any effect, and the first browser run showed the opening
  fold never played while the collapse did: an effect-computed "just opened" arrived after
  the ref had already classified the mount as a page load.
- `components/SessionSidebar.tsx`: rows stay mounted while a group shrinks
  (`!isCollapsed || projectFold.closing.has(root)`), the `ref` drives the animation,
  `focusSidebarTreeRow` skips `[data-fold="closing"]` rows, and the Chats fold keeps its
  conditional render (that list is a store subscription and can change mid-animation).
- `app/native-theme.css`: keyframes, `@starting-style` and the `interpolate-size`
  `@supports` path are gone; both directions transition height/opacity/padding,
  `[data-fold="closing"] { pointer-events: none }`, reduced motion `transition: none`.

### Verification

- `node_modules/.bin/tsc --noEmit`: clean. `node_modules/.bin/eslint . --quiet`: clean.
- Full suite: 4376 tests, 4372 pass, 1 fail (`rpc-manager-chat-only` #804, pre-existing at
  the base), 3 skipped.
- `node e2e/sidebar-fold.mjs` (new, added to `npm run test:e2e` and `e2e/README.md`) drives
  the real module over the real CSS in headless Chromium and samples the group below on
  every frame:
  - collapse: `388.0px over 14/42 frames, first movement at frame 1, largest frame 104.3px`
  - expand: `384.7px over 14/42 frames, first movement at frame 1, largest frame 105.0px`
  - rows unmount only when the height arrives; the height returns to the layout on opening;
    rapid clicking ends in the last requested state with no leftover inline height.
- Environment: the worktree needed `npx playwright install chromium` (Playwright 1.63 →
  chromium-headless-shell v1243) before any `e2e/*.mjs` runs.

### Files (Phase C2)

`lib/project-directory-pick.ts`, `lib/project-directory-pick.test.mjs`,
`components/SessionSidebar.tsx`, `app/api/cwd/pick/route.test.mjs`,
`lib/ntfy-settings.ts`, `lib/ntfy-settings.test.mjs`,
`app/api/notifications/ntfy/route.test.mjs`, `components/NtfyNotificationSection.tsx`,
`components/NtfyNotificationSection.test.mjs`, `app/native-theme.css`,
`lib/sidebar-fold-motion.ts`, `lib/sidebar-fold-motion.test.mjs`,
`e2e/sidebar-fold.mjs`, `e2e/sidebar-fold.fixture.jsx`, `e2e/README.md`, `package.json`,
`docs/agents/sessions.md`.

---

## Phase C3 — the Add project panel, made to behave like the composer's Add files (2026-11-22)

The user's reference is the composer's **Add files** (pic 1: the `+` button, tooltip "Add
files"; pic 2: the panel it opens, "Choose Files to Upload" with Cancel / Upload). That
panel is a plain `<input type="file">`, so macOS shows it as Safari's own: it is there
immediately, it is the **key** window, and focus comes back by itself. A folder pick cannot
be that control: `showDirectoryPicker()` is not in Safari (not through 27.x) and a directory
`<input type="file" webkitdirectory>` reports names and relative paths, never the absolute
path Pi needs as a cwd. So the panel stays native, and the job was to give it the same
behaviour.

### What the panel does now (`folderPanelScript` in `lib/apple-script.ts`)

Each step below was measured on this Mac, not assumed:

- **Not Finder.** `tell application "Finder" to choose folder` wakes Finder, bounces it in
  the Dock, and puts the desktop forward; the page keeps the menu bar only after the user
  clicks back. Finder is out.
- **Not osascript alone either.** A panel issued by osascript is owned by a
  background-only process, so it is **not the key window**: the panel appeared, the
  frontmost app stayed `Code`, and a Return sent to the front app never reached it (the
  panel ran to its timeout). Measured: `front while the panel is up: Code`.
- **System Events, activated.** The panel command runs inside
  `tell application "System Events" … activate … choose folder of (defaultLocation) with
  prompt …`. System Events has no Dock icon, and activating it gives the panel a key
  window: `front while the panel is up: System Events`, Return accepted it after 1914 ms,
  stdout `/Users/lynx/Documents/`, exit 0.
- **Focus goes back.** The app that was frontmost when the click happened is captured and
  made frontmost again on both exits (the choice and the cancel) — `restoreFront`, measured
  as `front after: Code`.
- **Permission-fragile calls are guarded.** `name of first application process whose
  frontmost is true` and `set frontmost of application process …` are the two calls that
  need Accessibility for the process running osascript; both sit in `try` blocks, so a
  machine that has not granted it still gets a working panel, just without the focus
  hand-back.
- **Syntax trap.** `choose folder with prompt "…" of (defaultLocation)` compiles as the
  possession operator applied to the prompt string —
  `Can’t get "Choose a project folder" of (defaultLocation). Access not allowed. (-1723)`.
  The location has to come **before** the prompt. The unit test pins the order.

### Where it opens, and what the page shows

- `folderPanelLocation(cwd)` (same file): the panel opens in the folder that **holds** the
  current project, so a sibling project is one click away. `components/SessionSidebar.tsx`
  passes `selectedCwd || homeDir`; the server accepts the hint only if it resolves to a real
  directory, and it never reaches the answer, which is always the panel's own path. A bad
  hint leaves `path to home folder` in the script.
- The Add project button carries the panel's progress: `is-busy` spins the icon
  (`spin 0.8s`, no spin under reduced motion), the button is `disabled` + `aria-busy`, and
  the title becomes "Choose the folder in the panel macOS opened" (`sidebar.pickInFinder`,
  three locales). One panel per click (`projectPickBusy`, plus the route's 409).
- Cancel still ends the flow with nothing (Phase C2), and 409 ("a panel is already open") is
  treated the same way.

### Verification

- Through the running dev server, with the panel accepted / dismissed by key code:
  - accept → `{"cwd":"/Users/lynx/Documents"}`
  - Escape → `{"cancelled":true}`
- `lib/apple-script.test.mjs` (8): no Finder, the panel inside the activated System Events
  tell, the location-before-prompt order, `restoreFront` on both exits with `-128`
  re-raised, every permission-dependent call inside a `try`, the prompt as an escaped
  literal, `folderPanelLocation` against a real temp tree, and the home-folder fallback.
- `app/api/cwd/pick/route.test.mjs`, `lib/project-directory-pick.test.mjs` (8): the panel
  script is built with the location hint, the answer is the panel's path, and the sidebar
  passes the hint, shows the busy state, and opens nothing on a cancel.
- `tsc --noEmit` clean · `eslint . --quiet` clean · full suite 4383 tests, 4381 pass, the
  one pre-existing #804 failure, 1 skipped.
- The temporary scripts that opened the real panel (`scripts/pick-panel-smoke.mjs`,
  `scripts/pick-panel-accept.mjs`) were removed after measuring: they open UI, so they are
  not CI-safe. The measurements are recorded above and the invariants are pinned by tests.

### Files (Phase C3)

`lib/apple-script.ts`, `lib/apple-script.test.mjs`, `app/api/cwd/pick/route.ts`,
`app/api/cwd/pick/route.test.mjs`, `lib/project-directory-pick.ts`,
`lib/project-directory-pick.test.mjs`, `components/SessionSidebar.tsx`,
`app/native-theme.css`, `lib/i18n/locale-plugins.ts`.

## Phase C4 — "Add project" is the app's own window (2026-11-22)

Manual test in Safari, with a screenshot of the panel: the web path from Phase C3 (the composer's
**Add files** control in its folder form, `<input type="file" webkitdirectory>`) opens macOS's
**file** chooser — titled "Choose Files to Upload", files selectable, an **Upload** button, and a
page cannot retitle it. The request: the window must be titled **Choose folder**, folders only, and
it must reuse the app's window code — its overlay and its pop-out / disappear animation.

- The window is `components/DirectoryPicker.tsx`, the folder browser the project picker's browse
  already uses: a portal, a full-screen backdrop, a panel with a title row, a path field, **folders
  only** (drives, then the subdirectories of the folder in view), New directory, Cancel, and
  "Select this folder". It answers with a real path, so no lookup by name is needed.
- `DirectoryPicker` gained an additive `title` prop (header + `aria-label`); the sidebar passes
  `sidebar.chooseFolderTitle` ("Choose folder" / 选择文件夹 / 選擇資料夾). The project picker passes no
  title, so its own heading is untouched.
- It arrives and leaves with the app's shared modal animation, added in `app/native-theme.css`:
  `.directory-picker-backdrop` / `.directory-picker-panel` get `native-backdrop-in` /
  `native-modal-in` (the settings dialog's keyframes) and the blurred scrim; `.is-closing` gets the
  new `native-backdrop-out` / `native-modal-out`, and `pointer-events: none` while fading. Reduced
  motion: no animation.
- `DirectoryPicker` got one dismissal path, `requestClose()`: it sets `closing`, marks both classes,
  and calls the parent after `DIRECTORY_PICKER_CLOSE_MS` (180). Backdrop click, Escape, × and Cancel
  all go through it, so the window never vanishes between two paints. Choosing a folder is reported
  at once — a fade after a choice only delays the project appearing in the tree.
- The chosen path is a **candidate**: `lib/project-directory-pick.ts` (`chooseProjectDirectory`)
  posts it to `/api/cwd/validate`, the route that probes permissions (TCC denies Desktop, Documents,
  Downloads) and grants file access — the same step the desktop and typed pickers use. A refusal
  stays inside the window (its `error` prop) so the user goes up a level and chooses again.
- Deleted with the native panel: `app/api/cwd/pick/**`, `pickProjectDirectoryFromServer`,
  `folderPanelScript` / `folderPanelLocation` / `appleScriptCancelled`, the one-panel-per-click lock,
  and the `sidebar.pickInFinder` label. `lib/apple-script.ts` is the notification bridge only. The
  whole webkitdirectory + resolver-by-name experiment is out of the tree (its resolver is in git
  history, and the reason is in the docs).
- Side effect worth having: because the window is a page window over `/api/cwd/browse`, folder
  picking now works from Safari over Tailscale, where the native route answered 403.
- Verification: `tsc --noEmit` clean · `eslint . --quiet` clean · full suite **4378 tests, 4376
  pass, 1 fail (the pre-existing #804 chat-only case), 1 skipped** · `scripts/fork-ownership.test.mjs`
  12/12. New/rewritten tests: `components/DirectoryPicker.test.mjs` (5: folders only, the title,
  every dismissal path, the shared animation and the `DIRECTORY_PICKER_CLOSE_MS` ↔ `--dur-base`
  pairing, select-is-immediate), `lib/project-directory-pick.test.mjs` (7: validate-first, refusal
  as a message, no-fetch cases, and the sidebar wiring), `lib/apple-script.test.mjs` (2: escaping
  and "no panel builder comes back").
- Docs: the "Adding a project folder" section of `docs/agents/files-and-access.md` is rewritten for
  the window (with the two web paths that were measured and rejected), and
  `docs/agents/sessions.md` gained an "Add project" bullet in the sidebar section.

### Files (Phase C4)

`components/DirectoryPicker.tsx`, `components/DirectoryPicker.test.mjs`,
`components/SessionSidebar.tsx`, `lib/project-directory-pick.ts`,
`lib/project-directory-pick.test.mjs`, `lib/apple-script.ts`, `lib/apple-script.test.mjs`,
`lib/i18n/locale-plugins.ts`, `app/native-theme.css`, `docs/agents/files-and-access.md`,
`docs/agents/sessions.md`; deleted: `app/api/cwd/pick/route.ts`, `app/api/cwd/pick/route.test.mjs`.

## Done (Phase D — the five tasks)
- **1. The session's own diff (task 1).** `lib/session-file-diff.ts` rebuilds a unified patch for
  one file out of the session's recorded calls: an `edit`'s `details.patch`, a `write`'s content
  as an added file, pi's numbered `details.diff` as hunks, an `edit` with no details from its
  `oldText`/`newText` (context trimmed around the change), an `apply_patch` through the same
  parser the tool card uses; hunks stack under one file header, counts come from the hunks, and an
  enormous write is capped with a `diff truncated` notice. `GET /api/sessions/[id]/file-diff`
  (live wrapper first, then the file; the path must be absolute and inside an allowed root).
  `FileViewer` takes `diffSessionId`, shows that patch in the diff view with a sticky
  `.file-diff-source-note` ("Changes this session made (N edits)"), and offers
  **Working-tree changes** / **Changes in this session** when both records exist. `file-tab-state`
  and `TabBar` carry `diffSessionId`; `AppShell.handleOpenSessionFileDiff` opens the tab with
  `modeHint: "diff"`. `TurnWrittenFiles` hands the writing session's id to the opener.
- **2. Project skills (task 2).** `lib/project-skills.ts`: a name, never a path, is resolved from
  the skills this project loads, and the target is fixed to `<cwd>/.pi/skills/<name>`
  (`isSafeSkillName`, no traversal, a link — a junction on Windows — with a copy fallback, and
  removal only of a top-level entry there). `POST /api/skills/project`
  `{ cwd, name, action: "add" | "remove" }` behind the file-access allow-list. Skills › the detail
  pane gains a **This project** row: **Turn on in this project**, **Remove from this project**, or
  **Show the project's skill** when the project carries its own copy; the list reloads and lands on
  the project's copy; the button is refused while the project's resources are not loaded (the
  trust notice above already says why). i18n ×3.
- **3. The live card (task 3).** `ChatWindow` memo `liveWrittenFiles` (the running turn's
  `extractTurnWrittenFiles` over its messages plus the streaming entry), rendered in
  `.chat-live-files` above the composer, folded by default; the reply's own card is suppressed
  while the turn runs, so a running turn shows one card and a finished turn shows one. The card is
  inside the measured composer overlay, so the scroll spacer grows with it.
- **4. Prompt scroll and Expand (task 4).** `CollapsibleUserText`'s collapsed box is
  `overflowY: "auto"` at the same cap (was a clipped fade), the fade only marks a box that is not
  scrolled to its end, and **Expand** reports up (`onExpandedChange` → the bubble's
  `maxHeight: expanded || promptExpanded ? "none" : USER_BUBBLE_MAX_HEIGHT`) so the whole prompt
  fits; **Collapse** puts the box back.
- **5. Collapse rules (task 5).** `ProcessDetailsGroup` is `defaultExpanded={false}` in every call
  site (a stopped task, a stopped session, a running turn). `LIVE_PROCESS_TAIL_BLOCKS = 8`:
  `foldCount = liveTail ? max(0, processIndexes.length - 8) : processIndexes.length`, so a running
  turn's older work folds and its newest 8 blocks (a compaction card counts) stay themselves, with
  their own refs for the turn rail and search; when the turn stops, `liveTail` goes false and all
  of them fold. The compaction card was already collapsed-by-default and auto-expands nowhere.
- Tests added: `lib/session-file-diff.test.mjs` (10), `app/api/sessions/*/file-diff/route.test.mjs`
  (3), `lib/project-skills.test.mjs` (6), `app/api/skills/project/route.test.mjs` (4),
  `components/MessageView.prompt-expand.test.mjs` (4), `components/TurnWrittenFiles.open-diff.test.mjs`
  (3), `components/SkillsConfig.project-skills.test.mjs` (5).
  Sentinels that pinned the old shape were retargeted: `components/ChatWindow.process-details.test.mjs`
  (process details never open themselves, the live tail folds, the running turn has one card),
  `components/FileViewer.test.mjs` (the lightweight-row harness passes `hasDiff`),
  `components/restored-wiring.test.mjs` (#419's cap is lifted by `promptExpanded`).
## Verified (Phase D)
- `node_modules/.bin/tsc --noEmit` clean; `eslint` clean on every touched file.
- `components/**/*.test.mjs`: **984/984**. Whole repo (app + lib + components + hooks + relay +
  relay-shell + public + scripts): **4415 tests, 4409 pass, 3 fail, 3 skipped**, all three
  failures environment-only (see BLOCKERS.md).
## Files (Phase D)
`lib/session-file-diff.ts`, `lib/session-file-diff.test.mjs`,
`app/api/sessions/[id]/file-diff/route.ts`, `app/api/sessions/[id]/file-diff/route.test.mjs`,
`lib/project-skills.ts`, `lib/project-skills.test.mjs`, `app/api/skills/project/route.ts`,
`app/api/skills/project/route.test.mjs`, `components/FileViewer.tsx`, `components/TabBar.tsx`,
`components/file-tab-state.ts`, `components/AppShell.tsx`, `components/MessageView.tsx`,
`components/ChatWindow.tsx`, `components/TurnWrittenFiles.tsx`, `components/SkillsConfig.tsx`,
`lib/git-types.ts`, `lib/i18n/locale-plugins.ts`, `lib/i18n/messages/{en,zh-CN,zh-TW}.ts`,
`app/native-theme.css`; tests retargeted: `components/ChatWindow.process-details.test.mjs`,
`components/FileViewer.test.mjs`, `components/restored-wiring.test.mjs`.
### Fixed after the user ran `npm run dev` (Phase D): the page would not compile
`npm run dev` started, then every page load died with
`mdast-util-gfm-autolink-email-loader … no longer contains the email regex` (a loader throw
inside Turbopack), so the page was blank. This machine resolves `mdast-util-gfm-autolink-literal`
**2.1.2** while the lockfile pins 2.0.1, and 2.1.x moved the Safari #753 problem around instead
of away: four regex literals (the URL regex and the `xmpp:` / `mailto:` / bare email regexes)
each start with a lookbehind, which Safari parses only from 16.4.
`lib/gfm-autolink-email-loader.cjs` is now version-agnostic: it scans the module's regex
literals (division, comments, strings and templates skipped), rewrites every one carrying a
lookbehind into a runtime construction whose fallbacks are the same pattern with the lookbehind
groups stripped (nesting- and class-aware, flags kept), and throws if a lookbehind literal
survives. Verified on the installed 2.1.2 and the pinned 2.0.1: no lookbehind literal left,
`node --check` on the rewritten module, and a modern browser gets the identical upstream regex.
`lib/gfm-autolink-email-loader.test.mjs` rewritten for the contract (9 tests: the installed
package, the 2.0.1 shape, four 2.1.x shapes, the old-Safari fallbacks, an email matched through
a fallback, the stripper, the literal scanner, a template case). A dev-server **restart** is
required: the loader runs at build time.
A 1924-link scan of `.pnpm` against the parents' semver ranges found one mismatch
(`eslint-module-utils` → `debug@3.2.7`); the rest of the tree is self-consistent, so the open
environment item stays "installed tree is newer than the lockfile" (`npm ci`).

### Project-level Skills, reworked to the user's four rules (Phase E)
The first cut linked the global skill's folder into `<cwd>/.pi/skills/<name>`. Real use showed that a
link makes the two entries **one file**, so the panel hid the global row, and flipping the project's
switch rewrote the global skill's `disable-model-invocation` — which turned the skill back on in every
other project. Reworked:

1. **Turning a skill on in a project leaves the global skill alone.** `installProjectSkill(cwd, name,
   state)` writes a real **copy** at `<cwd>/.pi/skills/<name>/` (SKILL.md and the skill's own files)
   and sets the switch the project asked for; a project flip touches only that copy. Proven byte-level
   in `lib/project-skills.test.mjs` ("flipping the project's switch never moves the global skill's
   switch").
2. **A project skill shows its absolute path.** `SkillDetail` renders `shortenPath(skill.filePath)`
   for every scope, so the row reads `~/Documents/github/pi-desk/.pi/skills/<name>/SKILL.md`.
3. **A global skill's state is global.** With no shared file, the global row's switch writes the
   global file and is seen the same in every project; the project row's switch writes the project copy.
4. **The button mirrors the state.** `ProjectSkillControl { state, hasCopy, winner,
   selectedIsProjectCopy }` drives the **This project** row: an enabled skill offers **Turn off in
   this project**, a disabled one **Turn on in this project**, and **Remove from this project** appears
   only once the project carries a copy. `POST /api/skills/project` takes `action: "on" | "off" |
   "remove"` (`add`/`delete` still accepted); turning a globally-on skill off in one project gives that
   project a copy switched off, because writing the global file would switch it off everywhere.

**One name, two files.** pi's loader keeps the first entry per name, so the global and the project
file never both reach the list and one switch would be invisible. `lib/skill-shadowing.ts`
(`addShadowedSkills`) puts the hidden twin back — read with pi's own `loadSkillsFromDir`, deduped by
real path so a link stays one row — and marks the pair with `skillCollision: { winner }`; the panel
says which file the project's sessions run. An untrusted project's folder is neither loaded nor put
back. `lib/skill-roots.ts` holds the shared folder rules so the listing and the writer agree.
`/api/skills/content` accepts the new rows for free: its allow-list is the service's own list.

Verification: `tsc --noEmit` clean; `eslint --quiet` clean on the touched files; `lib` suite 2841 tests
1 fail (the known `#804` environment case), `app`+`components` 1289 tests 0 fail, `scripts`+`hooks`
262 tests 0 fail. New/updated tests: `lib/project-skills.test.mjs` (8), `lib/skill-shadowing.test.mjs`
(5), `app/api/skills/project/route.test.mjs` (5), `components/SkillsConfig.project-skills.test.mjs` (8,
including the label text in all three locales). Docs: `docs/agents/settings-ui.md`, `AGENTS.md` map.

**Legacy links are migrated.** The user's projects already carry the link the first cut made, and a
link is one file behind two rows: the global row stays hidden and a project flip moves the global
skill. `addShadowedSkills` now detects a project entry whose real path is a user skill, lists the
global file beside it and marks the pair `skillCollision.linkedToGlobal`; the row's note says the file
is shared and that turning it on or off in this project makes it the project's own copy.
`installProjectSkill` then drops the link (its target stays) and writes the copy —
`lib/project-skills.test.mjs` "a project skill left as a link becomes the project's own copy on the
next switch", `lib/skill-shadowing.test.mjs` the pair. `isLinkedSkillEntry()` covers symlinks and
Windows junctions.
