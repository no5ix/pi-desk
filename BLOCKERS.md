# BLOCKERS

- **`/api/cwd/pick` is local-only.** Opening Pi in Safari through the tailnet hostname
  (`https://macb00kpr0m4.taila0e40f.ts.net`) makes `isLocalRequest()` false → the route
  answers 403 and "Add project" falls back to the typed-path picker. Workaround: use
  `http://localhost:30141` on the Mac itself. Relaxing the gate to "Tailscale login ==
  this Mac's own login" also accepts the user's phone. Awaiting the user's call.
- **No `node_modules` in the worktree by default.** Symlinked to the main checkout
  (gitignored) so `tsc`/`eslint`/`npm test` run. `npm ci` is the clean alternative.
- **`next build` must not run while a dev server holds `.next/dev/lock`** (AGENTS.md),
  and the desktop shell's `__NEXT_PRIVATE_*` env vars break builds — verified env before
  any build.
