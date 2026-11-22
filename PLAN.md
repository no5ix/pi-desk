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

---

# Phase C3 — the Add project panel as smooth as Add files (2026-11-22)

- [x] Panel by System Events (activated, key window), never Finder, never a non-key
      osascript window
- [x] Focus handed back on the answer and the cancel; permission-fragile calls guarded
- [x] Opens beside the current project (`folderPanelLocation`), hint validated server-side
- [x] The Add project button shows the panel (spin, disabled, title) in three locales
- [x] Measured on the machine and through the dev server; invariants pinned by tests

---

# Phase C4 — "Add project" is the app's own window (2026-11-22)

- [x] A window titled **Choose folder**, listing folders only (no files), reusing the app's
      folder browser (`DirectoryPicker`) instead of a native panel
- [x] The app's overlay and modal animation on that window, in and out, reduced-motion aware
- [x] One dismissal path so the fade is never cut short; a choice is reported at once
- [x] The path validated through `/api/cwd/validate`; a refusal stays inside the window
- [x] The AppleScript panel, the file-input pick and the by-name resolver removed
- [x] Tests: `components/DirectoryPicker.test.mjs`, `lib/project-directory-pick.test.mjs`,
      `lib/apple-script.test.mjs`; gates: tsc, eslint, full suite (only the known #804 failure)
- [ ] Safari: title, folders only, the pop-in and fade-out, a refused Desktop folder,
      a pick over Tailscale

---
# Phase D — five tasks on the running chat (2026-11-22)
- [x] **1. "Edited files" opens a real diff.** A row opened the file's content. The row now opens
      the file's diff, built from the session's own `write` / `edit` / `apply_patch` records
      (`lib/session-file-diff.ts`, `GET /api/sessions/[id]/file-diff`); the panel names the source
      and swaps to the working tree when both exist
- [x] **2. Project-level skills, like project-level MCP.** Skills › a global skill ›
      **Turn on in this project** writes `<cwd>/.pi/skills/<name>` (a link to the global folder,
      a copy where links are refused); **Remove from this project** deletes it, the global skill
      untouched; the project's own copy shadows the global one by name
- [x] **3. A live "Edited files" card above the composer.** While a turn runs it is the one file
      list, collapsed, counting and listing what the agent has written so far; the reply shows no
      card, and the finished turn shows exactly one
- [x] **4. A long prompt reads without "Expand".** The collapsed prompt is a scroll box;
      **Expand** drops the cap so the whole prompt fits, **Collapse** restores the box
- [x] **5. Collapse rules.** Process details and compaction always start collapsed and never
      auto-expand. A running turn keeps its last 8 blocks as themselves (the compaction card
      counts) and folds the older ones into Process details; when it stops, all of them fold
- [x] **6. Fix: `npm run dev` would not compile the page.** The lookbehind loader is now
      version-agnostic (`lib/gfm-autolink-email-loader.cjs`, #753): every lookbehind regex
      literal in `mdast-util-gfm-autolink-literal` is rewritten, and one surviving is a build
      failure. Needs a dev-server restart
- [ ] Manual Safari/desktop pass: the diff panel's source switch, the live card's count growing,
      prompt scroll + Expand, a running turn's fold line moving as it works,
      Settings › Skills on a trusted and an untrusted project
