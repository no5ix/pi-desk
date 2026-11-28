# PROGRESS — startup lease noise, breathing task glyphs, composer fold, context chips, live branch

Branch `fix/bg-task-lease-log-breathing-composer-chips`, from
`test-merge/test-merge-pi-desk-main` (`8a9fcd8d`).

## Done and verified

**1 — the startup lease line is quiet.** `lib/background-tasks/host-client.ts`:
`ensureLease()` asks whether this client has *ever* seen a `ready` frame
(`readyActivationId !== null`) before it prints. The bridge is attached with the session
wrapper — before the extension's activation announces itself — and the interface answers
`subscribe` with `UNAVAILABLE` (`no initialized session context yet`) until that activation's
first `session_start`, and with nothing (`TIMEOUT`) when the package is not installed. Those
are the server's startup order, the `ready` frame retries, and `npm start` no longer opens
with a red-looking line per conversation. After a `ready` the interface demonstrably works, so
a miss warns — **once per code** (`warnedLeaseCodes`, cleared by a successful lease, so a code
that returns after the interface worked is news again).
Pinned by `lib/background-tasks/host-client.test.mjs` ("a lease miss before the interface
announces itself is startup order, and prints nothing": silent at startup, one line after a
`ready`, a repeat of the same code is silent, a code after a success warns again). 19/19 pass.

**2 — the running task glyph breathes, in the header and in the session row.**
The header chip animated `subagents-breathe`, a keyframe name the sheet never defined — an
animation naming missing keyframes is no animation, so the chip sat green and **still** while
three tasks ran. Both the chip's head and the sidebar row's `.session-item-bg-tasks` mark now
use the app's one running-head motion, `agent-run-pulse 1.6s var(--ease-native) infinite`
(the subagents' glyph and the sidebar's running rows), with `prefers-reduced-motion` off.
Pinned by `components/BackgroundTasksPanel.test.mjs` (the keyframes exist, the dead name is
gone, the row's mark breathes, idle breathes not, reduced motion is silent). Verified in a
real browser: the row mark and the running chip compute `animationName: agent-run-pulse`,
1.6s, green; an idle chip computes `none`, muted ink.

**3 — the composer's fold is one motion, and lands with its padding.** Measured in a real
browser (a rAF sampler over the fold): the card animated **45 → 96px and landed at 101.8px**.
Two causes, both in the fold:
- the target height was read while the text's `margin-bottom` was mid-transition
  (0 → 6px, the stacked shape's band above the control row), so the measured box was 6px
  shorter than the content; at the transition's end the hand-written height was released and
  the card jumped 6px taller. Fixed twice over, deliberately: the text's margins left the
  `[data-inline]` transition list (the stacked insets are padding, so the swap moves the
  ink half a pixel — there was never motion worth animating), **and** the target is measured
  under `.chat-composer.is-measuring` (`transition: none` for the card's subtree), so the
  number the animation runs to *is* the resting height;
- with the box smaller than its content, the content's resting alignment (top) put the `+` and
  Send **48px below the card's bottom edge**, clipped by the card's own `overflow: hidden`,
  for the whole 240ms — the discs pressed against the card's lower border with too thin a
  band, then dropping into place. `ChatInput` now marks the animation
  (`card.dataset.folding`, cleared on `transitionend` and on an unmount mid-fold) and
  `.chat-composer[data-folding]` pins the content to the card's **bottom** edge, with the
  editor at `flex: 0 0 auto` so the card clips rather than squashing the field.
Re-measured: the card's bottom-to-Send band is **8px at every frame** of the fold and of the
collapse, and the release leaves the height alone (102 → 101.8, subpixel). Desktop and phone
(iPhone 13) checked with screenshots. Pinned by
`components/ChatInput.composer-expand.test.mjs` (the measure class wraps the read, both CSS
rules, the `data-folding` lifecycle in the effect, and the margin no longer transitioned).

**4 — the project and branch chips have room.** `.composer-context-row`: `gap` 4 → **8px**
(two plates 4px apart read as one control) and the left inset steps 6px out of the composer's
ink column (`calc(var(--composer-ink-inset) + 6px)`), so the pair is not jammed into the card's
left edge. Measured: 21.4px inset / 8px gap at a pointer, 29px / 8px on a finger's tier, no
horizontal overflow at 390px. Pinned by `components/ChatInput.composer-row.test.mjs`.

**5 — the header's branch is the checkout's live name.** `components/AppShell.tsx`: the header
asks the branch endpoint for **the conversation's own folder** (`selectedSession.cwd`, chats
excluded) instead of passing `null` for a selected session, so the hook's 3s poll drives the
chip; the row's recorded branch (`SessionInfo.branch`, off the server's 60-second project
cache) is only the seed shown while the first read is in flight.
`hooks/useProjectBranch(cwd, seed)`: the seed is a label, read from a ref, and deliberately
**not** an effect dependency. The first cut put it in the deps, and a live run showed why that
is wrong: the session list refreshes on its own cadence and hands a seed naming the branch
from *before* the switch, which restarts the effect, reloads the server's **cached** project
endpoint, and puts the old name back on the header between polls — measured at ~8s to settle,
flapping. With the ref, a live probe in a throwaway worktree (session opened in the app, the
worktree's branch switched under the open conversation) moved once, at **3.27s**, and never
moved back. Pinned by `components/AppShell.topbar-branch.test.mjs` (the cwd rule, the seed
shape, the `[cwd]` deps, the poll, the hydration rule).

## Failed attempts and causes

- Seeding the hook through the effect's dependency list: the stale cached name re-arrives with
  every session-list refresh (see 5). Rejected; the seed is a ref.
- Measuring the fold with `card.scrollHeight`: not needed. `.is-measuring` (transitions off
  for the measure frame) makes the honest `offsetHeight` the truth, and keeps the arithmetic in
  one place.

## Verification

- `node_modules/.bin/tsc --noEmit`: clean.
- `npm run lint` (eslint + branding): **0 errors**, 15 pre-existing warnings in files this task
  did not touch; branding 2/2.
- Touched suites: `lib/background-tasks/host-client.test.mjs` 19/19,
  `components/AppShell.topbar-branch.test.mjs`, `components/BackgroundTasksPanel.test.mjs`,
  `components/ChatInput.composer-expand.test.mjs`,
  `components/ChatInput.composer-row.test.mjs` — **no new failures** against the base commit.
- Browser measurement (Playwright, dev server on 30141): the fold's per-frame band, the
  breathing computed styles, the chips' geometry at 1280px and 390px, and the live branch
  switch. Probe sessions and the probe worktree were deleted afterwards.
- Full suite on the branch: **5298 tests, 5254 pass, 43 fail**. The 43 are pre-existing:
  27 in the four composer / topbar / background-task suites above (name-for-name identical to
  `8a9fcd8d`), `lib/transcript-notices.test.mjs` (fails in the base suite log too),
  `scripts/check-installed-deps.test.mjs` (this worktree's `node_modules` lags the lockfile —
  the documented worktree condition; fails in a clean checkout of the base commit as well), and
  `scripts/upstream-css-baseline.test.mjs` (the baseline's `app/globals.css` hash is stale on
  this branch: `app/globals.css` is unmodified in git and byte-identical to the base commit's
  copy, and the test fails there too when run — the base suite's glob run skipped it).

## Known state of the base commit (not this task)

**The composer's e2e specs are broken on the base commit.** `node e2e/composer-expand.mjs`,
`e2e/composer-ios.mjs` and `e2e/option-controls.mjs` fail on `8a9fcd8d` and on this branch with
the same assertion — *"the composer ships `flexDirection: compact ? "column" : "row"`,; the
fixture must mirror it"* — because `e2e/composer-expand.fixture.jsx` mirrors an older
`ChatInput` (the reasoning / tools / side-chat row, a `data-inline` hardcoded). So the fold
measured in this task is pinned by `components/ChatInput.composer-expand.test.mjs` and by the
browser measurement above, not by those specs. `e2e/turn-files-animation.mjs` passes on both.
(Once, run alongside two full suites at once, it failed on load; run on its own it passes —
the suites and the specs both spawn browsers.)

`test-merge/test-merge-pi-desk-main` (`8a9fcd8d`) fails 27 tests in the four composer /
topbar / background-task suites this task touched — e.g.
`ChatInput.composer-row.test.mjs` asserts `{!compact && !isNarrow && <div className="chat-composer-controls"`,
and `ChatInput.tsx` has no `chat-composer-controls` element at all;
`ChatInput.composer-expand.test.mjs` asserts a `box-shadow → height` transition pair that a
comment sits between. Base and branch fail the **same 27** (diffed name-for-name): none of it
is this task's, and none of it is fixed by it.
