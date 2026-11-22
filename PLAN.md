# PLAN — feat/pi-desk-branch-tailscale-safari

## Phase A — verify the 4 committed features (74f4e582)
1. Add project → native Finder (`app/api/cwd/pick`, `lib/apple-script.ts`, `lib/project-directory-pick.ts`, `SessionSidebar.handleAddProject`)
2. Topbar branch chip (`AppShell`, `app/api/worktrees/route.ts`, `hooks/useProjectBranch.ts`)
3. Tailscale Serve at startup (`lib/tailscale-serve.ts`, `instrumentation-node.ts`)
4. Local macOS completion notification (`app/api/notifications/local`, `lib/completion-notification.ts`, `SafariNotificationSection`, `AgentEndInfo` timing)

Tests to add (repo style: `node --experimental-strip-types --test`, `*.test.mjs`, pure functions + source sentinels; never spawn osascript/tailscale in tests):
- `lib/tailscale-serve.test.mjs`, `lib/completion-notification.test.mjs`, `lib/apple-script.test.mjs`
- `app/api/cwd/pick/route.test.mjs` (gate only), `app/api/notifications/local/route.test.mjs` (GET + 403 + 400)
- `lib/project-directory-pick.test.mjs` (mocked fetch)
- `components/AppShell.topbar-branch.test.mjs`, `components/SessionSidebar.add-project.test.mjs`, `components/SafariNotificationSection.test.mjs`

## Phase B — 6 new tasks
1. ntfy notification (Settings › General): server url (default `https://ntfy.sh`), topic, switch, **Send Test Notice**; on finish publish title = session name, body = the same sentence.
2. Turn duration next to the **Copy** button in the message footer: `Copy 0h31m10s      Nov 21 11:46PM`, both existing controls keep their place.
3. Animate sidebar project expand/collapse.
4. Fix: opening a session sometimes shows a stale transcript (missing final report); a refresh shows it.
5. Compaction card: collapsed by default, header click expands.
6. Process details: thinking cards collapsed by default.

## Phase C
Run `npm test` (+ i18n registry parity, fork-extractions, ui-menu-consistency where relevant), `tsc --noEmit`, `eslint`, review `git diff`, commit.

---

# Phase C2 — the manual-test fixes (2026-11-22)

- [x] 1 · Add project: Cancel in Finder must not open the in-app picker
- [x] 2 · ntfy: `Send Test Notice` (ByteString header, em dash) + the panel layout
- [x] 3 · Project fold: a real 200–300 ms height animation, siblings moving from frame one
- [x] Tests: `lib/project-directory-pick.test.mjs`, `lib/ntfy-settings.test.mjs`,
      `app/api/notifications/ntfy/route.test.mjs`, `components/NtfyNotificationSection.test.mjs`,
      `lib/sidebar-fold-motion.test.mjs`, `e2e/sidebar-fold.mjs`
