# BLOCKERS

- **`/api/cwd/pick` is local-only.** Opening Pi in Safari through the tailnet hostname
  (`https://macb00kpr0m4.taila0e40f.ts.net`) makes `isLocalRequest()` false → the route
  answers 403 and "Add project" falls back to the typed-path picker. Workaround: use
  `http://localhost:30141` on the Mac itself. Relaxing the gate to "Tailscale login ==
  this Mac's own login" also accepts the user's phone. Awaiting the user's call.
- **`node_modules` in the worktree** was a symlink to the main checkout, so `npm test`'s
  `pretest` (`scripts/check-installed-deps.mjs`) refused to run and two tests failed on
  package drift. Resolved: the symlink is gone and `npm ci` installed from this branch's
  lockfile (`check:deps` passes).
- **Pre-existing failure, not from this work:** `lib/rpc-manager-chat-only.integration.test.mjs`
  ("Chat only names a model only an extension provides instead of a bare not found (#804)").
  It fails identically at the branch base `57992fd0`, at `540b928c`, and in this worktree after
  `npm ci`. Shape: in the fixture (`toolNames: []`, temp `PI_CODING_AGENT_DIR`, an extension that
  registers `extprov`), `set_model extprov/ext-model` rejects with the #804 sentence, and the
  following `prompt` **resolves** where the test expects the same rejection. The prompt refusal
  at `lib/rpc-manager.ts:1497` needs `chatOnlyExtensionModel`, recorded at
  `startRpcSession` (`lib/rpc-manager.ts:3990`) — which comes out undefined for this fixture,
  while `set_model` (`:1768`) reaches the same model through `findDeferredModel` on the
  session's own runtime. A prompt-side fallback to `findDeferredModel` was tried and reverted:
  it did not make the test pass, and a behaviour change in an untouched subsystem is not this
  task's to land. Needs a decision from the owner of the chat-only model policy.
- **The machine's Tailscale Serve config was empty** when the startup path was verified
  (`tailscale serve status` → "No serve config"), so the tailnet URL was not serving 30141.
  Running `startTailscaleServeAtStartup()` — the feature under test — restored it
  (`/ proxy http://127.0.0.1:30141`). Nothing else in this work touches Tailscale state; the
  e2e env keeps `PI_WEB_DISABLE_TAILSCALE_SERVE=1`.
- **`next build` must not run while a dev server holds `.next/dev/lock`** (AGENTS.md),
  and the desktop shell's `__NEXT_PRIVATE_*` env vars break builds — verified env before
  any build.
