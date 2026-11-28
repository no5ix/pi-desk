# PLAN — startup lease noise, breathing task glyphs, composer fold, context chips, live branch

Branch `fix/bg-task-lease-log-breathing-composer-chips`, from
`test-merge/test-merge-pi-desk-main` (`8a9fcd8d`).

The ask, in the user's words (with screenshots):

1. `npm start` opens with `[pi-web] background-task lease not taken (UNAVAILABLE): …no
   initialized session context yet…`. That is the startup order, not a failure.
2. Pic 1 (a sidebar session row): the background-task glyph on the session title **and** on
   the conversation header should breathe while tasks run.
3. Pic 2 → 4: pressing Enter in the composer must fold to the stacked card smoothly. Today
   it lands in pic 3 (the control row sits with a small bottom band), and 0.3 s later in
   pic 4 (the real resting card) — it reads as lag/jitter.
4. Pic 5: the project picker moves right a little; the branch picker is too close to it.
5. A session on a worktree where the **agent** switches branches: the header's branch chip
   kept the old branch. It must check the current branch every 3 seconds.

## Phases

1. **The lease log** (`lib/background-tasks/host-client.ts`) — a lease miss before the
   interface ever announced a `ready` frame is startup order and logs nothing; after a
   `ready`, a miss warns once per code until a lease succeeds. Pinned by
   `host-client.test.mjs`. **Done.**
2. **Breathing task glyphs** (`app/native-theme.css`) — the header chip's head breathes
   through the *missing* `@keyframes subagents-breathe` (the animation never ran); point it
   at the app's one running-head motion `agent-run-pulse` and give the sidebar row's
   `.session-item-bg-tasks` mark the same, with reduced motion. **Done.**
3. **The composer fold** (`components/ChatInput.tsx` + `app/native-theme.css`) — measured in
   a browser: the card animated 45 → 96px and landed at 101.8px (the target was read while the
   text's bottom margin was mid-transition), and the control row sat 48px below the card's
   bottom edge, clipped, for the whole 240ms. Target measured with transitions off for one
   frame (`.is-measuring`), margins out of the text's transition, and the content pinned to the
   card's bottom edge while folding (`[data-folding]`). **Done.**
4. **The context row** (`app/native-theme.css`) — `gap` 4 → 8px, and the pair steps 6px out of
   the ink column. **Done.**
5. **The live branch** (`components/AppShell.tsx` + `hooks/useProjectBranch.ts`) — the header
   polls the branch of the conversation's own folder every 3s; the session row's cached name is
   only a seed, read through a ref so a session-list refresh cannot push the old name back.
   **Done.**
6. Verify: `node_modules/.bin/tsc --noEmit`, `npm run lint`, the touched node suites
   (diffed name-for-name against the base commit, which already fails 27 of them), the full
   suite on the branch and on the base commit, and the geometry / breathing / live-branch
   measurements in a real browser. Commit, push. See `PROGRESS.md`.
