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
