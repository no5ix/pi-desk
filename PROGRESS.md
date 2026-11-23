# PROGRESS — selective pi-web backport (branch `chore/selective-pi-web-backport`)

Branch from `pi-desk-main` at `41913bcd`. Source: `agegr/pi-web` (remote
`pi-web`, fetched as `refs/pull/{1730,1731,1739,1742}/head` and `3443700`).
The item table with results is PLAN.md; the reasoning is DECISIONS.md.
The previous task's log (notification reliability) is in git history
(`git log -- PROGRESS.md`).

**All five items are committed on the branch.**

| sha | what |
| --- | --- |
| `f8bac2c2` | #1731 `fix(stats)`: a count just under a million shows as `1.0M`, not `1000k` |
| `78665202` | #1730 `fix(agents)`: `MAX_SESSION_STATS_IDS` lives in `lib/session-stats.ts` where a caller can batch by it |
| `197f0d7a` | `chore(deps)`: pi `1.5.2` → `1.6.0` (every `@earendil-works/*`, pinned exact) |
| `b72769da` | #1742 `feat(subagents)`: a background report is steered into the parent's running run |
| `dd5ee7ad` | #1739 `fix(subagents)`: the report survives a steer that arrives as the child finishes it |
| `66f67abc` | #1742 `fix(subagents)`: `get_subagent_result` names the parent's own id as a wrong poll |
| `844b2fa1` | `test(models)`: pi 1.6.0 moved `qwen-token-plan-cn` to `token-plan.maas.qianwenaiapi.com` |

## Implementation state

* **#1731** — cherry-pick `c919f735`, clean; the fork's `lib/session-stats-format.ts`.
* **#1730** — the fork has no agent switcher, no `AgentStatusBar`, no
  `lib/agent-switcher.ts`: upstream's `fetchAgentUsage()` batching has no caller
  here. Ported the half the fork can use: the cap is exported from
  `lib/session-stats.ts`, `app/api/sessions/stats/route.ts` imports it, and the
  route test asserts the exported number and the refusal sentence.
* **pi 1.6.0** — `npm install` from HEAD's lock; `check:deps`,
  `lib/pi-packages.test.mjs`, `tsc`, `npm run desktop:prepare` (webpack build +
  payload credential scan: 0 findings, the sharp libvips allowlist entry) and
  `npm run desktop:verify` (Code mode sandbox self-test `{"state":"available"}`,
  Bedrock import, bundled terminal `PI_PACKAGED_TERMINAL_OK`) all pass.
  One fork test pinned 1.5.2's provider data (`844b2fa1`).
* **#1742** — `steerIntoRun()` queues the report as a
  `pi-web:subagent-notification` custom message at the parent's `turn_end`
  (`deliverAs: "steer"`), so the parent's next model call in the run it is
  already in takes it; `canSteerAfterTurn()` refuses (and falls back to the old
  follow-up wake) after an error/aborted turn, after Stop, while chat-typed input
  is queued (`one-at-a-time`), and for a parent that is itself a subagent which
  has used its turns. Delivery is confirmed by pi's `message_end` for that report
  (`settledSubagentNotification`), not by the promise of the send. `lib/pi-types.ts`
  gained `agent.signal` and `agent.hasQueuedMessages()`.
* **#1739** — `runResultText(sessionManager, from)` reads the child's entries from
  `stored.entryBase` (an entry index), joins every assistant text that ended a
  turn with no tool call, and projects `context_edit` (omit / rewrite, latest
  wins) the way pi projects them for the model. Start, resume, success and catch
  record it; the fork's resume-catch path records partial output for the first
  time. No boundary, or a window with no answer, falls back to
  `getLastAssistantText()`; a direct turn in a child's own chat keeps
  `getLastAssistantText()`.

## Verification

* `node_modules/.bin/tsc --noEmit` — clean.
* `npm run lint` (`eslint .` + branding) — clean.
* Full `npm test` — 4608 tests, 4607 pass, 0 fail, on the final tree.
  (An earlier run showed exactly 2 failures, the builtin-match test that pinned
  pi 1.5.2's Qwen Token Plan endpoint; `844b2fa1` follows the SDK's data.)
* Touched suites, all green: `lib/subagent*.test.mjs` (244, incl. the real-SDK
  integration suite), `lib/subagent-extension.test.mjs`,
  `components/MessageView.subagent-report.test.mjs`,
  `app/api/sessions/stats-route.test.mjs`, `lib/session-stats-format.test.mjs`,
  `lib/pi-packages.test.mjs`, `components/fork-extractions.test.mjs`.
* `npm run drift` — 6 files disagree with `scripts/fork-ownership.json`
  (`FileExplorer`, `MarkdownBody`, `web-push`, `request-security`,
  `PwaRegistration`, `directory-browser`). Verified pre-existing: the same 6
  disagree on `pi-desk-main`. No file this branch touched is among them
  (`lib/subagent-runtime.ts` is recorded `high` and stays `high`). Left alone:
  the registry update belongs to a sync, not to this backport.

## Next

Nothing outstanding for these five items. If the branch is merged, the follow-up
this work exposed (BLOCKERS.md): the fork's `AgentStatusBar`-shaped live report
surface does not exist, so a steered report shows up only as the custom message
the parent's turn renders.
