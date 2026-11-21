# PROGRESS

## Done
- `74f4e582` — items 1-4 (web Finder pick, topbar branch, Tailscale Serve at startup, local macOS notification). `tsc --noEmit` clean, `eslint` clean. Notification sentence verified against the user's example.

## Verified
- Phase A: 41/41 tests green (`lib/completion-notification`, `lib/tailscale-serve`, `lib/apple-script`, `lib/project-directory-pick`, `app/api/cwd/pick/route`, `app/api/notifications/local/route`, `components/AppShell.topbar-branch`, `components/SafariNotificationSection`, `hooks/useAgentSession.run-timing`). They found real gaps in the *tests'* assumptions, not the code: the header keeps `<small class="app-topbar-project">` (not a bare `<small>{topBarSubtitle}</small>`), the sidebar adopts a picked folder through `activateProject`, and the header's project branch comes from the `useProjectBranch` hook module (`activeProjectBranch`), not from state in AppShell.

## In progress
- Phase B: ntfy (new task 1).

## Next
1. ntfy: `lib/ntfy-settings.ts` (server file under `~/.pi/agent/pi-web/ntfy.json`), `app/api/notifications/ntfy/route.ts` (GET/PUT config + POST publish + test), `components/NtfyNotificationSection.tsx`, i18n keys, AppShell completion send.
2. New task 2: duration beside the Copy button (`getTurnDurationMs` in lib/turn-duration.ts is currently dead code — reuse it).
3. New tasks 3-6: sidebar fold animation, stale session open, compaction card collapse, thinking collapse.
4. Full `npm test`, `tsc`, `eslint`, diff review, commit.
