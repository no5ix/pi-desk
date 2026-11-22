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
