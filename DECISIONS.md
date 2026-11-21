# DECISIONS

- **Tests never spawn OS processes.** `app/api/cwd/pick` and `app/api/notifications/local` are tested through their gates (non-local → 403, empty body → 400, GET capability probe); `osascript`/`tailscale` invocation is verified by source sentinels, not by running the CLI.
- **Tests follow the fork's own style**: pure-function tests plus source-regex sentinels (`components/*.test.mjs`), because the fork's guards are already source-based and upstream CSS/JSX files must stay mergeable.
- **`formatDurationHms` is unpadded** (`0h18m13s`, `0h0m9s`) — matches the user's example and the answer to the "9-second run" question. The clock stays zero-padded `hh:mm:ss`.
- **Local notification is server-side `osascript`** (not Safari Web Push): the user does not use Safari's Add-to-Dock web app, and a plain Safari tab has no system-notification API. Attributed to the process that owns the server; the settings row says so.
- **Tailscale Serve stays fire-and-forget** in `registerNodeInstrumentation()` (Next's `Ready` line gates the browser opener), macOS-only, `PI_WEB_DISABLE_TAILSCALE_SERVE=1` off switch, set in the e2e env.
- **ntfy config lives server-side** (a settings file, like the other `lib/*-settings.ts`), not localStorage, because the topic is a property of the Pi installation and the completion sender is the browser: any device that opens Pi must publish to the same topic.
