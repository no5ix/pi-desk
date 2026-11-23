# Selective backport of four pi-web PRs and the pi 1.6.0 bump

Branch: `chore/selective-pi-web-backport` (from `pi-desk-main` at `41913bcd`).
Source: `https://github.com/agegr/pi-web` (remote `pi-web`, fetched as
`refs/pull/<n>/head`). All items are done; the shas and the verification are in
PROGRESS.md.

| Item | Upstream | Result on this branch |
| --- | --- | --- |
| #1731 `formatCompactCount` 999_500 → `1.0M` | `lib/session-stats-format.ts` + test | `f8bac2c2` — cherry-picked clean (the file is the fork's) |
| #1730 batch the agent family's usage reads | `lib/agent-switcher.ts`, `components/AgentStatusBar.tsx`, `lib/session-stats.ts`, route | `78665202` — the lib half (`MAX_SESSION_STATS_IDS` exported from `lib/session-stats.ts`, route imports it) + the cap tests. The client half is **N/A**: this fork has no agent switcher and no `AgentStatusBar`, so nothing batch-reads usage |
| `3443700` pi 1.6.0 | `package.json`, `package-lock.json` | `197f0d7a` — every `@earendil-works/*` moved `1.5.2` → `1.6.0` with `npm install`, from HEAD's lock so the tauri plugin pins held. `844b2fa1` follows the SDK's data move (Qwen Token Plan endpoint) |
| #1742 steer a background report into the parent's running run | `lib/subagent.ts` (`steerIntoRun`), `lib/subagent-runtime.ts`, `lib/subagent-status.ts`, `lib/subagent-notification.ts`, `lib/subagent-ui.ts`, `components/AgentStatusBar.tsx` | `b72769da` — `steerIntoRun()` + `canSteerAfterTurn()` in the fork's `lib/subagent-runtime.ts`, report kept as the `pi-web:subagent-notification` custom message. `66f67abc` — the 71eb6b84 refusal half, in the fork's `get_subagent_result` |
| #1739 keep the report when a steer arrives as the child finishes | `lib/subagent.ts` / `lib/subagent-runtime.ts` (`runResultText`), `lib/subagent-ui.ts` | `dd5ee7ad` — `runResultText(sessionManager, entryBase)` with pi's `context_edit` projection, at every record site |

## Order (kept)

Upstream chronology: #1731 and #1730 are based on `f97292ee`; pi 1.6.0
(`3443700`) is on main and is an ancestor of #1742's head (`71eb6b84`), so #1742
needs 1.6.0; #1739 (`61695daf` + `3fbbe2f4`) is based on #1742's merge commit.

1. #1731
2. #1730 (the half the fork has)
3. pi 1.6.0 (`3443700`)
4. #1742 (`f1c86e21` + `71eb6b84`)
5. #1739 (`61695daf` + `3fbbe2f4`)

## Rules that bound this port

- Fork docs win where they disagree with the upstream doc;
  `docs/agents/subagents.md` is fork-diverged, so every doc port is hand-adapted.
- The fork's `AgentSessionLike.sendCustomMessage(message, { deliverAs, triggerTurn })`
  is the two-argument form: the steered report stays a `pi-web:subagent-notification`
  custom message so the report card keeps rendering.
- `markSubagentReportRun()` marks the parent run a report *starts*. A steered
  report starts no run, so it must not be marked: the user's own run announces normally.
- `hasUnsettledSubagentRun()` holds a parent's stream/run open while a
  notification is pending; the steered path settles that entry exactly like the
  follow-up path (the `subscribe`-driven `onSettled` test covers it).
- A run's result boundary is an **entry index** (`stored.entryBase`), not a clock
  reading: the fork's own integration test resumes in the same millisecond.
- `package-lock.json` keeps the tauri plugin pins: install from HEAD's lock.
- Verification: `tsc --noEmit`, `npm run lint`, the touched `node --test` files,
  the full `npm test`, `npm run drift`, and (for the SDK bump)
  `npm run desktop:prepare` + `npm run desktop:verify`.
