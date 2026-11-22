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

---

## Environment notes found in Phase C2

- The worktree's Playwright had no browser download. `npx playwright install chromium`
  (Playwright 1.63 → chromium-headless-shell v1243) is needed before `e2e/*.mjs` runs.
  Recorded so a fresh worktree does not read an e2e failure as a code failure.

## Fixed in Phase C2 (kept for the record)

- **`Send Test Notice` failed with a ByteString error** — the ntfy `Title` header carried
  the em dash of `Pi Agent Desktop — test`; header values are one byte per character, so
  `fetch` threw before the request. `ntfyHeaderValue()` sends the UTF-8 bytes ntfy decodes.
- **Cancel in the Finder panel opened the in-app typed picker** — the pick result now
  distinguishes `picked` / `cancelled` / `unavailable`.
- **The project fold jumped** — it animated `clip-path`/`opacity` and an `auto` height
  behind `@supports (interpolate-size)`; a paint change does not move the layout. The fold
  is a measured height transition now (`node e2e/sidebar-fold.mjs` measures it).

## Superseded in Phase C4 (kept for the record)

- **Safari over Tailscale could not pick a folder** (the native route answered 403 to a relay
  mark, so the remote page fell back to the typed picker). Moot: the folder window is a page
  window over `/api/cwd/browse`, so it works from the phone and the tailnet hostname.
- **The focus hand-back needed the Accessibility permission** for the process running `osascript`
  (without it the panel worked and the focus stayed away). Moot with the panel gone.
- `/api/cwd/browse` lists directory names and is upstream: it is gated by the web password and
  the cross-site rules (`isApiRequestAllowed`, `proxy.ts`), not by `isLocalRequest()`, because it
  is part of the web UI (the project picker's browse used it before this phase). If the folder
  window is ever made a privileged surface, that is the gate to add — the route is the only one
  that names paths without a project.

## Environment (Phase D, 2026-11-22) — not caused by the code
- `scripts/check-installed-deps.test.mjs` ("this checkout's node_modules matches its lockfile")
  fails: this worktree's `node_modules` is a pnpm tree (its `.pnpm` store, with 773 broken
  symlinks into a deleted worktree repaired by hand). `npm ci` is the fix, per AGENTS.md; the
  three bin links left broken are `.bin/tauri`, `.bin/pi-ai`, `.bin/pi`.
- `scripts/preview-runtime.test.mjs` ("the classic scripts set the globals the import map
  re-exports") fails with *manifest exports for react are stale*: the bundle in
  `public/preview-runtime/` predates the React this machine resolved (`ViewTransition` is new).
  `npm run preview-runtime` regenerates it; untouched here — it is outside the five tasks and
  rewrites a checked-in bundle.
- `lib/rpc-manager-chat-only.integration.test.mjs` (#804, "Chat only names a model only an
  extension provides") fails with "Missing expected rejection" on this machine, and
  `lib/rpc-manager.ts` is untouched in this phase. Known from earlier phases: it passes on a tree
  whose `node_modules` matches the lockfile.

## Resolved in Phase D: the dev server refused to compile (`npm run dev`)
`Error: mdast-util-gfm-autolink-literal no longer contains the email regex that
lib/gfm-autolink-email-loader.cjs rewrites` on every page load, blank page. Cause: this
machine's tree resolves `mdast-util-gfm-autolink-literal` **2.1.2** (the lockfile pins 2.0.1;
`remark-gfm` asks `^2.0.0`, and the `.pnpm` store here holds only 2.1.2). 2.1.x replaced the
one email lookbehind with **four** (the URL regex, `xmpp:`, `mailto:`, bare email), so the
loader — written for 2.0.1's exact text — threw. The old Safari fix (#753) was also
insufficient for 2.1.x: the URL regex's lookbehind would have broken iOS 16.2 by itself.
Fix: the loader now rewrites every lookbehind regex literal it finds (runtime construction,
with lookbehind-free fallbacks) and throws if one survives. Verified against the installed
2.1.2 and the pinned 2.0.1: no lookbehind literal left, valid ESM, and the modern browser gets
the identical upstream regex (`lib/gfm-autolink-email-loader.test.mjs`, 9 tests). A **restart of
`npm run dev`** is needed: the loader runs at build time.
A scan of this tree's 1924 nested `.pnpm` links against their parents' ranges found one
mismatch (`eslint-module-utils` → `debug@3.2.7`), so the tree is otherwise self-consistent;
its remaining difference from the lockfile is version drift from a newer install, which
`npm ci` aligns.
