# Agent workflow and repository operating rules

These rules apply to Pi and other coding agents working in this fork. `AGENTS.md` is the short entry point; this document holds the repeatable workflow.

## Autonomous task execution

Treat the user's request as an assignment to finish, not an invitation to stop after analysis. Make ordinary implementation decisions independently. Do not ask for approval on routine choices, and do not stop because context is low or one subtask is blocked. Checkpoint, compact, resume, and complete independent work while recording the blocker precisely.

For any multi-step task, establish:
- The requested outcome and explicit exclusions.
- The exact base branch/ref and starting commit SHA.
- Acceptance criteria that can be demonstrated.
- Relevant files, tests, runtime behavior, and dependencies.
- A verification plan and a clear definition of done.

Keep `PLAN.md`, `PROGRESS.md`, `DECISIONS.md`, and `BLOCKERS.md` specific to the current branch/task. Do not duplicate unrelated task plans from another branch. Preserve history, but mark inherited, stale, or superseded notes as such. Update progress at meaningful milestones and record evidence, not optimistic status labels.

## Implementation is not verification

Track implementation and verification separately. A feature can be implemented but not verified. Mark an acceptance criterion complete only after the relevant test or direct runtime check passes.

Use this sequence:
1. Inspect current behavior and relevant tests before editing.
2. Establish a baseline when practical, using the base commit or CI evidence.
3. Implement the smallest coherent change.
4. Add or update regression tests for the behavior and edge cases.
5. Run focused tests, then the broadest relevant test/type/lint/build/E2E checks available.
6. Compare failures against the baseline. Do not attribute an existing failure to the new branch, and do not hide a new regression as a baseline failure.
7. Review the full diff and repeat relevant checks after fixes.
8. Record commands, exact outcomes, and any unverified criteria.

A test that could not run is not a passing test. If the environment blocks one check, try an alternative and state the remaining uncertainty. Never delete or weaken an assertion merely to obtain a green run.

## Blocked work must not stop execution

When a command, tool, dependency, test, or implementation path fails:
- Capture the exact error and the step that failed.
- Try a different safe method or implementation.
- Complete all work that does not depend on the blocker.
- Keep the unresolved item in `BLOCKERS.md`, including what was attempted and what would unblock it.
- Ask the user only when an actual product decision, credential, permission, or other external action is indispensable.

A blocked verification step does not prevent documentation, independent implementation, code review, or other tests from being completed.

## Subagent selection

Use the built-in profiles for distinct roles:
- `explore`: read-only repository inspection and evidence gathering.
- `plan`: read-only architecture and implementation planning.
- `general-purpose`: focused implementation or investigation.
- `background-task`: long-running shell work that should continue independently while the parent agent proceeds.

The `background-task` profile is intentionally constrained: it uses the parent model, medium thinking, at most 15 turns, no inherited parent context, no skills/extensions, and only `read`, `bash`, `grep`, `find`, and `ls`. It cannot edit or write project files. Use it for build/test/benchmark/watch processes and other shell jobs, not for implementation. The host may keep a process alive after the parent turn finishes, but prompt wording does not guarantee survival across a server crash, application quit, or machine restart; verify the actual task status and exit code.

Delegate bounded work with clear inputs, outputs, acceptance criteria, and file ownership. Avoid multiple agents editing the same files concurrently. The parent remains responsible for integrating results, running verification, reviewing the diff, and reporting completion.

## Pi SDK and extension compatibility

Do not upgrade Pi packages merely because a newer version exists. Inspect the upstream GitHub commits, release notes, changelog, and relevant source changes; identify the concrete bug or capability the upgrade addresses. Check every installed `@earendil-works/*` package and the SDK's directly related packages as a compatible set.

This repository pins Pi packages exactly. Preserve the exact-version policy and existing `overrides` that bind `pi-background-tasks` to this app's Pi packages. Verify the installed tree with `npm run check:deps`, run the focused integration tests for AgentSession lifecycle, compaction, streaming/events, background tasks, abort behavior, and extension APIs, then run the full test suite. Treat the Pi CLI/TUI behavior and public SDK contracts as the compatibility reference; do not invent fork-only extension API options to paper over UI differences.

At the current base commit, the Pi package family is pinned to 1.6.1. This is a baseline fact, not a permanent target: future upgrades must be justified by inspected changes and tests, not by this document's version number.

## Worktree-aware development

Each linked Git worktree is a separate checkout and may run its own development server. `npm run dev` and `npm run web` resolve a deterministic port from the worktree path and move to another candidate if that port is already occupied. The main checkout retains 30141 when available.

Port precedence:
1. CLI `--port` / `-p`.
2. `PI_WEB_PORT` (recommended explicit override).
3. `PORT` (compatibility fallback).
4. Automatic worktree-aware allocation.

Use the port printed by the launcher. Do not assume every worktree uses 30141. E2E harnesses may intentionally request an ephemeral port because they start an isolated server and should not contend with a developer's long-running server.

## Fork maintenance and upstream intake

This repository is a fork of `agegr/pi-web`, with fork-specific product decisions, file moves, security boundaries, and UI. Do not routinely merge or rebase upstream. The user selects the PRs/commits to backport, or explicitly requests a review of candidates.

For each selected change:
- Inspect the entire PR/commit and its dependencies, not only its title.
- Backport only the selected behavior and the minimum required dependencies.
- Preserve fork-specific behavior and rejected upstream product decisions.
- Check `scripts/fork-ownership.json`, `components/fork-extractions.test.mjs`, the relevant `docs/agents/fork-*.md`, and the existing merge history before touching fork-owned areas.
- Run the relevant fork-specific tests and review the complete diff after the backport.
- Record the source PR/commit, adopted scope, declined scope, and compatibility decisions.

A clean merge or passing upstream CI is not proof of a correct fork integration. Never delete a fork regression assertion just to make a merge pass.

## Commit, push, and final report

Commit only verified, task-owned changes. Never stage unrelated files or force-push a branch you did not create. Push the requested branch and verify its remote head.

The final report must distinguish verified results, implemented-but-unverified work, baseline failures, and unresolved blockers. For every commit, include the complete subject, full SHA, timestamp with timezone, and every changed file, reading those values from Git. State explicitly if anything remains uncommitted or was not pushed.
