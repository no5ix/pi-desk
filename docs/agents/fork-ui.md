# Layout, settings and client behavior — fork notes

## Terminal appearance

`LazyTerminalPanel` caches the imported component and renders it synchronously after
idle preloading. Do not wrap it in `next/dynamic`: a separate React.lazy instance
still suspends on first mount and can add a 300ms fallback throttle even with cached
chunks. Preloading must only load code, never start a PTY. Terminal height follows
its workspace container, not the viewport.

TerminalPanel reads workbench surface, text, selection and semantic ANSI colors through
`lib/terminal-theme.ts`; its surrounding styles live in `app/native-theme.css`.
Root theme/background changes update xterm options in place, preserving the PTY,
scrollback and input. Minimum contrast is 4.5; light mode does not retain dark-only ANSI colors.
Run `node e2e/terminal-theme.mjs` for light/dark and narrow-layout regression checks.

## Streaming Markdown

`MarkdownBody` coalesces preprocessing snapshots at 48–96ms, then passes the
existing Pi components and remark/rehype safety pipeline to `StreamingMarkdown`.
The headless `@lobehub/streamdown` engine owns stable block caching, processor
reuse and paced word fades (`realtime`); no Lobe UI theme is imported. Completion,
stop and replacement flush authoritative text. A replaced stream starts a new
queue, and finished/user/history messages use the ordinary static renderer.

Reference links/footnotes, YAML frontmatter, raw HTML and display math keep one
syntax tree (`needsWholeMarkdownDocument`); conservative matches inside fences
also take that path. Reduced-motion users receive the unanimated renderer, with
no reveal backlog. Pi's existing code highlighting and delayed Mermaid/HTML
previews remain in charge; this change does not add streaming code highlighting.

Run `node e2e/streaming-markdown.mjs` for real-browser incremental replay, old vs
new parse-volume measurement, desktop/mobile light/dark snapshots, replacement,
stop, reduced motion, file links, document-wide syntax and HTML sanitization.
The fixture uses local generated content and never contacts a model. Results
and screenshots go to the ignored `test-results/streaming-markdown/` directory.

Fork-owned notes moved out of `AGENTS.md` to keep it short. The upstream doc on the same topic (`docs/agents/*.md` without the `fork-` prefix) may describe the same area in other words; where they disagree, these notes describe this fork. Hard rules that must survive a merge are also listed in `AGENTS.md` under **Hard rules**.

## Image dimension hints in user messages

The SDK appends `[Image: original … displayed at …]` coordinate notes to persisted
image prompts after resizing. `lib/user-image-display.ts` projects a strict trailing
note block (including MIME conversion hints) out of `UserMessageView` display/copy
and new edit drafts, only with attached images (no more distinct hint groups than images).
Exact repeated suffix groups from older edits count once; distinct excess groups
and notes inside unfinished Markdown fences remain untouched.
Edit drafts preserve attachments and do not mutate stored messages or existing model
input. The scanner and live-runtime first-message previews use the same projection;
index format 3 invalidates stale derived previews, never user-assigned names.
Embedded/quoted notes and text-only messages stay visible. Exact manually appended
SDK-shaped suffixes are indistinguishable without upstream metadata.
Tests: `node --test lib/user-image-display.test.mjs components/MessageView.test.mjs lib/session-list-scanner.test.mjs`;
`PLAYWRIGHT_CHANNEL=chrome node e2e/user-image-display.mjs` exercises in-place
optimistic/delivered/history updates, real ChatInput text/attachment admission,
cancel, edit drafts and resend without a model call.
This is a MessageView integration replay, not a full authenticated SSE round trip.

## Composer input history (↑)

`lib/composer-history.ts` builds the ↑ menu from the transcript. Each entry keeps
the prompt text **and** its images, so selecting an earlier image question
restores the attachments instead of dropping them. It reuses the same image-note
projection as the message bubble, so an SDK resize note never returns as typed
text, and image-only prompts appear (labelled by image count). Selection follows
the same admission rule as history editing: a non-empty draft or pending
attachment is left untouched. Chat file chips come back through
`splitMessageForComposer`. Tests: `node --test lib/composer-history.test.mjs`.

## Composer clearing and history-edit admission

`ChatInput.replaceMessage()` returns whether it actually restored history. A
nonempty draft, attached files/images or pending image processing refuses the
replacement; `useAgentSession` sets edit state only on success. Refusal produces
one coalesced 3-second warning (including during exit animation); unrelated
notices keep their 5-second default and hover/focus pause behavior.

The explicit clear button calls the existing draft/text/attachment cleanup and
`onClearDraft` to leave history-edit mode. It does not send, stop the agent, remove
history or modify the outbox. A clear-generation guard rejects late attachment
read/conversion results and revokes discarded image preview URLs. Cancel remains
a separate, non-destructive action that only leaves history-edit mode.

## Composer: one card, one control row
The card is a column (`.chat-composer-editor` is `flexDirection: "column"`): the text
area is a full-width block on top, and one row (`.chat-composer-actions`) below it
carries the attach button, the session controls
(`className="chat-composer-controls"`) and Send, in that order. Nothing sits beside the
typing, so a long prompt is typed across the card, and every control that acts on the
draft is within reach of it. Send stays the row's last child, so its disc keeps sharing
the card's bottom-right arc (measured by `e2e/composer-geometry.mjs`). The text area is
`flex: "none"` — in a column `flex: 1` is a zero basis and clips the auto-grow height to
`minHeight`, which is the regression `components/MobilePwaLayout.test.mjs` pins.

The controls in that row are icon-only: the reasoning level, the tool preset and the
model chip print no words, and each is a 32px square (`--control-h-lg`). The words are
not lost — they live in `title` and `aria-label` (`"Change reasoning level: medium"`,
`"Change tool preset: Chat only"`, `"<model name> — Change model"`, the compaction stop
button carries `"Stop compaction · Compacting (2/3)…"`), which is what a screen reader
and hover read. `ModelSelector` takes `iconOnly` for this; the `field` variant (Settings,
model dialogs) keeps its label. The project and branch chips keep their text: they name
which folder and which branch a session is in, which is identity, not a setting.

The four icon controls are **one cluster**, and on a desktop or a pad the cluster starts
behind the attach `+`: the model chip collapses into the group that the phone opens as
"More" — model, reasoning, tool preset, session automation, in that order — and the row's
spacer sits *after* the group, as a child of `.chat-composer-actions` (not inside
`.chat-composer-controls`), so the strip is no longer pushed to the card's right edge.
The chip is built once (`modelControl`) and placed by tier, never copied. A phone keeps
it in the left cell and the settings in the popover: a model picker one tap deep is the
control a phone cannot spare. `components/ChatInput.composer-row.test.mjs` pins the
order, the single `<ModelSelector>`, and that the strip has no `marginLeft: "auto"`.

The card has no "clear the composer" button: a textarea is selected and deleted, so a
trash icon asked for a click to do what the keyboard already does, in a row that carries
the controls with no key equivalent. `chat.clearDraft` left the three locales with it and
`onClearDraft` left `ChatInput` / `ChatWindow`. The attachments carry their own remove
controls, each named — `chat.removeAttachment` with the file's name, and `chat.removeImage`
for an image's ×, which was an unlabelled glyph while the clear button stood beside it —
and history-edit mode is left through its own Cancel.

The `/ commands · @ files · # sessions` hint rides the **placeholder's row**: it is
`position: absolute` inside the card
(`top: calc(8px + (var(--composer-line-height) - 1.4em) / 2); right: 0`), so it shares
the first line of an empty composer instead of growing a second line under the text and
landing out of the eye's line once typing starts. It never takes a click
(`pointer-events: none`), and the gates are unchanged — `!compact && !isNarrow &&
!isStreaming && value.length === 0`, visible on `:focus-within`.

The attach `+` is a bare glyph: no plate at rest, and no plate while files are attached
(`[data-active]` changes the glyph's colour only). The text area is stretched (`width: auto`),
never `width: 100%` — a full width and a horizontal margin together push the text 8px past
the card's right edge — and stretched, its margins are the card's insets: `margin: 8px 0
18px calc(var(--composer-send-size) / 2 - 10px)` (the 18px is the room above the control
row, the left margin is the ink alignment below) plus 13px of right padding for the caret.
`e2e/composer-geometry.mjs` measures the hint's centre against the text's first line and
asserts there is no clear button and the text ends inside the card, at every font size and
theme.
The card's two left ends are compared as **ink**, not as boxes. The `+` and Send are discs
with no disc painted (`background: none`), so the only ink in them is the glyph, and the
hint's 23px `padding-right` once left its sentence 13px short of Send's arrow — the
composer read as two left columns and a ragged right edge, typed lines included (the
placeholder and the text share the element, so both move together). The ink is what the eye
compares, so the ink is what is pinned: the `+` stays centered in its touch-sized disc
(`justify-content: center`; a finger aims at the disc, and Send's arrow is centered in its
own) and the **text moves to it** — the textarea's left margin is half the disc less 10px
(8px on the 36px tier, 12px on the touch tier's 44px), which stands the prompt's first
character on the glyph's left edge; `e2e/composer-geometry.mjs` measures it at both tiers.
The hint's `padding-right` is 10px — the disc's own inset — with its box still at
`right: 0`, so the ink moves and the layout does not.
The in-session "Waiting for model…" / "Compacting…" line is the **transcript's** last row
(`components/ChatWindow.tsx`), not part of the composer, and the composer floats over the
scrollport with a 32px fade above its card on top of the card's shadow — so the one sentence
the user is watching arrived painted over. `.chat-scroll-container`'s `padding-bottom` (34px)
is what lifts it clear; being scroll content, it only exists at the tail. The same test that
owns `overflow-anchor: none` pins it (`components/ChatWindow.scroll-anchor.test.mjs`).

The row under the card no longer exists; the same controls live inside it. On a phone
`.chat-composer-controls` is a grid with exactly TWO children (the wide spacer is a
sibling in `.chat-composer-actions` and is rendered only on the wide, non-compact tier),
so its template is
`minmax(0, 1fr) auto`: the left cell takes the free width and shrinks, the
controls keep their own `auto` track. With an `auto` first track the grid sizes
that column to the model chip's untruncated max-content, the controls cell
collapses to `0px`, and its button (squeezed to 16px in a zero-width track)
paints on top of the context ring — the reported iPhone 16 Pro Max overlap.
Both tiers keep the left cell shrinkable (`flex: "1 1 auto"` narrow,
`"0 1 auto"` wide, `minWidth: 0`), so a squeezed desktop window (workspace panel
open) truncates the row instead of pushing the controls out of it. The phone folds
the settings into a More popover on an absolutely positioned cell — that is why
`e2e/composer-geometry.mjs` measures the row's spread over the buttons that are in
flow, not over the popup's.

The model trigger's cap must be a shrink, not only a ceiling: the toolbar variant
uses `max-width: min(220px, 100%)`. A bare `220px` left a 220px box past the
shrunken 207px root and onto the ring. The label span (`flex: 1`, `minWidth: 0`,
ellipsis) is the part that gives way; in the composer it is not rendered at all
(`iconOnly` swaps the cap for a 32px square with `maxWidth: "none"`), so the cap
rule belongs to a labelled toolbar chip. The ring and the More button keep
`flexShrink: 0`. Pinned by `components/ChatInput.composer-row.test.mjs`. Verify
on a real session with a long model id and a live context ring, at 320–640px and
at desktop widths with the workspace panel open, in Chromium and WebKit.

## Conversation find

`ConversationFind` is mounted by `ChatWindow`. Ctrl+F / Cmd+F searches the current
conversation's loaded, expanded text (not the sidebar, composer or file panel).
Opening reveals the loaded render window; older server pages are requested explicitly
with “Load earlier messages”, idle-only through the existing guarded `loadContext`.
Collapsed process content is not silently expanded or advertised as searched.
Literal case-insensitive DOM ranges use CSS Custom Highlights, never DOM text replacement,
so React, syntax highlighting and streaming remain intact. Enter / Shift+Enter cycle
matches; Escape closes without aborting the agent and restores focus. DOM refreshes
preserve the active range where possible (otherwise clamp its index), update counts
without scrolling, and only explicit navigation or query edits move the viewport.
Text traversal preserves document order and treats block elements, line breaks and
excluded controls as boundaries while allowing matches across inline formatting.
Session/leaf changes clear search; inert/hidden conversations never intercept find;
modal dialogs and focused file workspaces retain their own keys.
Run `node e2e/conversation-find.mjs` (or `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome)
for real-component light/dark, narrow-width, keyboard, history and streaming checks.

## Conversation navigation
ConversationNavigator 仅在右侧工作面板关闭、对话滚动区宽度至少 1024px，且正文左边距至少 64px 时显示。
沿用 ResizeObserver 同时观察滚动区和实际正文列，因此侧栏缩放、窗口变化和正文宽度设置都会重新判断；
不可仅用窗口媒体查询推测可用空间。隐藏时移除导航及其键盘入口，并清理悬停预览，恢复显示时不主动滚动正文。
`node e2e/conversation-navigator.mjs` 覆盖真实导航组件的几何、面板开关、正文宽度及键盘交互。

## Touch affordances

Sidebar and topbar menus are placed from their measured size, never from a
guessed height: `lib/menu-placement.ts` flips a menu above its anchor when the
space below cannot hold it and keeps it inside the viewport, and
`hooks/useMenuPlacement.ts` applies that before the browser paints. A row near
the bottom of the window must not push its last entry (delete, remove project)
under the window edge. `node e2e/sidebar-menu-placement.mjs` covers the session
and project menus in both themes and languages.

The session-row more action reserves a 28px hit area. Its 20px painted highlight
is inset by the shared 4px choice gap on all sides, with the same 4px clearance
to the row's trailing edge. Keep the row/slot/button dimensions in CSS; do not
restore the old 24px inline slot and separate 7px row padding. The glyph and
highlight share a center in hover, keyboard-focus and open-menu states.

The topbar's More trigger is icon-only, and two rules make its box wider than
its glyph: the coarse-pointer 44px minimum for topbar buttons and the 1120px
padding trim. `.app-topbar-more-trigger` in `app/native-theme.css` sets
`justify-content: center`, and the trigger's inline style must not set
`justify-content` — the default flex-start left the three dots ~8px left of the
box's centre on a phone and on a coarse-pointer desktop. Keep the glyph an SVG
of three circles: text dots ride the text baseline and read high in a 44px box
on iOS. Pinned by `components/AppShell.more-menu.test.mjs`.

Session deletion uses the shared `ChatConfirmDialog`; do not swap the 28px session
row for inline Delete/Cancel buttons. Keep the row and title visible, show the full
name separately from the consequence, and use the shared neutral/soft-danger actions
with an 8px gap. Menu and Delete-key entry points share this confirmation, including
the optional chat-folder checkbox; Shift+click retains its existing bypass. Keep the
dialog open while deleting, with local errors and retry, and restore row focus on cancel.

Session rows render the "…" action menu when `(hovered || touchMode)` — `touchMode` is a post-mount `matchMedia("(hover: none)")` check, so hover styling is untouched on desktop and rename/delete stay reachable on touch. The composer's single circular action shows Stop while a run is active and the draft is empty; typing switches it to queued Send, including on narrow screens. A live subagent run counts as a run: a background run leaves the main session idle, and an empty card that offered a send arrow while the header read `↻1` sent the user into the Agents panel for the only Stop in the app — so `subagentsRunning` (the family's running set, `components/AppShell.tsx`) puts the square back, and `stopRuns` calls the session's abort for a live turn (its signal already ends the children it waits on) or the per-run `POST /api/subagents/[id] {action:"abort"}` when the session is idle. Escape follows the same order. Side chats are conversations the user drives, never runs to stop, so they stay out of the set. Escape remains available to stop while drafting. Rename/delete failures use the global shell notice shelf (`appNotify.error` with `sidebar.renameFailed` / `sidebar.deleteFailed`) instead of being swallowed.
Message-row copy/edit/fork actions use CSS hover/focus-within reveal instead of JS hover state, and are always visible under `(hover: none)`. They must remain pointer-enabled when focused so keyboard tabbing does not land on invisible controls.
While a session runs, in-session "Edit from here" stays visible but disabled with the Esc hint; fork stays available because it copies to an independent file.

## Global operation notices
Persistent operations use `persistent: true` and replace their progress notice with
`updateAppNotice` when they settle. An update cannot revive a dismissed notice;
success resets the normal expiry deadline, while actionable errors remain visible.
Generate title uses this shelf after its menu closes, including a Models shortcut
for failures. Retry reuses the operation's notice and clears the old error action.
The shelf starts below the 48px toolbar with a 12px gap and sits below menus and
dialogs, so notices cannot block retry or window controls. Its surface uses the
shared radius, spacing and semantic colors in both themes.

`lib/notification-store.ts` and `components/AppNoticeShelf.tsx` own cross-surface shell notices (`appNotify.info/success/warning/error`). They queue and expire automatically, but a notice with an action stays until dismissed so the action cannot vanish. Keep errors beside the affected control when position carries meaning; use the shelf when the action comes from a global surface such as the sidebar or workspace shell. Do not claim Undo in one of these notices unless the data path really restores the original state — session DELETE currently unlinks files and cascades subagents, so it has no safe client-side undo.

## Keyboard shortcuts
`hooks/useKeyboardShortcuts.ts` owns app-level shortcuts. Cmd/Ctrl+\ closes the right workspace (never bare `\`), Cmd/Ctrl+/ opens the shortcut reference dialog, Cmd/Ctrl+B toggles the sidebar, and Cmd/Ctrl+L focuses the composer. Browser-reserved variants may not fire in the web build; the desktop shell receives them. Help must not layer over Settings or let another global shortcut fire through it: pass the other callbacks as `undefined` while it is open, then focus the dialog, capture Escape (so closing it does not also stop a run), and keep Tab inside the dialog.
The sidebar project tree nests only subagent runs and side chats under the session that started them (`buildSessionTree()` in `lib/sidebar-session-nodes.ts`); a fork (`relation.kind: "fork"`) is a row of its own beside its source, with the fork glyph and "Forked from …" in its tooltip, so it keeps its own pin / archive / Fork menu and is never hidden by folding its source. A fork's own subagents nest under the fork. Children start folded: the row's toggle shows their count, the folded row still carries their running and selected state, and the ids of rows the user unfolded live in localStorage (`pi-web:expanded-subagent-rows`, newest 300; `lib/sidebar-subagent-expansion.ts`, read through `useSyncExternalStore` so the first render matches the server's all-folded HTML). A selected child unfolds the rows above it (#237).

The sidebar project tree is a keyboard `tree`: rows move focus with Up/Down/Home/End, project and subagent groups expand/collapse with Right/Left, Enter/Space activates, F2 starts rename, and Delete opens the same shared confirmation dialog as the row menu. Roving-tabindex extraction is intentionally not used yet because timeline rows and future non-session tree rows still need one shared focus model.

## Projects pane views
The Projects header's hover-only `…` menu switches between `grouped` (project rows with nested session families) and `timeline` (all top-level session families sorted by the root session's `modified` time, with each row's project name after the title). The choice persists in `APP_PREF_KEYS.projectViewMode`. Collapse/expand-all remain grouped-view actions; switching modes never rewrites the stored `collapsedProjects` set. The old Recent section is intentionally gone — the timeline replaces it. Desktop uses `showNativeMenu` check items, while the web build renders `ProjectViewMenu` as a DOM popover. In grouped view, "Show more" reveals five additional session rows per click; collapsing and reopening a project clears that page state so it starts from the latest five (`APP_PREF_KEYS.expandedProjects` stores root → extra pages).

## Projects section fold and count

The Projects heading shows the number of active project groups, not the session
count and not archived projects. Its button folds both the active list (including
the timeline view) and the Archive group. This section preference is independent
of per-project folds, per-session archives and the Archive group's own state.
`APP_PREF_KEYS.collapsedProjectsSection` is read with the same server-safe
`useSyncExternalStore` pattern as Chats; restoring a stored fold must not change
the initial hydration markup. The store keeps an in-memory snapshot after the
first read and updates it before writing, so quota/private-mode failures still
let the button fold for the session. Searching temporarily reveals the section
and its archived matches without changing the stored preference. The add/menu controls
remain available while folded and reuse the existing header styling.

## Project archive
A project row's menu (its `…` or a right-click on the row) offers "Move to archive"; the project leaves the list for the Archive group at the bottom of the Projects pane (`components/ArchivedProjectsSection.tsx`), folded by default (`APP_PREF_KEYS.archiveExpanded`). The archive is the old "Remove project" set (`APP_PREF_KEYS.archivedProjects`, keyed by project root, so all worktrees go together), now held by the `lib/archived-projects.ts` store that both `SessionSidebar` and `AppShell` read. Archived projects unfold to show their sessions, which stay readable and can be continued, but there is no new session in one: the row has no `+`, and every new-session entry point (sidebar "New session", the row `+`, Ctrl+Alt+N, the native app menu) refuses with a notice instead of silently restoring. Restoring is explicit: the archived row's menu ("Restore to projects") or picking the folder again through "Add project" / the composer's folder picker. Archiving the selected project moves the selection to the most recent listed project. Unfolding an archived project never selects it, since selecting a project opens a new-session composer there. A search looks inside the archive and unfolds it.

Single project sessions archive the same way chats do (#200): the session row's menu offers "Archive" / "Unarchive" on top-level sessions, ids are kept in `APP_PREF_KEYS.archivedSessions` (localStorage, so per browser like the project archive), and an archived session leaves its project's list and the chronological view for a "Show archived (n)" fold at the end of that project. The open session stays listed where it was until the user moves away, a search lists archived sessions in place, and sending to an archived session does not restore it.

## Plugins and skills
- `/api/plugins` uses pi's `SettingsManager` + `DefaultPackageManager` for global/project package install, remove, update, enable, and disable. Disabling writes empty `extensions/skills/prompts/themes` arrays for that package entry.
- `/api/skills` uses `DefaultResourceLoader` so settings paths, package skills, and project `.agents/skills` are listed the same way the runtime sees them.
- Skill toggling edits only the `disable-model-invocation` frontmatter key on the target `SKILL.md`; keep that surgical so user formatting survives.
- `/api/skills/install` shells through `npx skills add ... --agent pi`; project installs run with the selected cwd.

## Completion sound
- `hooks/useAudio.ts` stores the toggle in `localStorage` as `pi-sound-enabled` and reuses one `AudioContext`. The switch is in Settings › General (`settings.completionSound`), not the composer row.
- Browser autoplay policy means sound must be unlocked from a user gesture; `ChatInput` calls the unlock hook from interactive controls, and `ChatWindow` plays the tone from `onAgentEnd`.

## Settings dialog: one tab per concern
- The sidebar gear opens Settings directly through `openSettingsAtLastSection`, the same entry used by the keyboard shortcut. First use opens General; subsequent visits restore the last available section. Category navigation lives inside Settings; do not restore an intermediate section menu.
- The settings sections are `general`, `appearance`, `models`, `skills`, `agents`, `plugins`, `mcp` (`SETTINGS_SECTION_VALUES`). Appearance is available without a project and owns mode, background and the custom stylesheet through `AppearanceSettings.tsx`. General keeps language, chat controls, product/version information and the self-hiding desktop window/tray switches (`components/desktop/DesktopAppSection.tsx`). Do not duplicate appearance controls in General or reintroduce the former Desktop tab. `components/AppUpdatesSection.tsx` owns the update check and its chips.
- Navigation (#227): on every desktop platform the sections are a pane on the left under the dialog's title, the content beside it (the header is `display: contents` on the surface's grid). Between 641px and 899px the pane is an icon rail (labels stay as `.settings-section-tab-label`, visually hidden, plus the `title` tooltip); at 640px and below the phone drill-down is unchanged. Windows keeps its Fluent accent bar and caption close, GNOME its round close. The list is one tab stop (`tabIndex` only on the selected row) and arrow keys / Home / End move within it. General's two columns are a container query on `.settings-section-host` (760px of section width), not a viewport breakpoint, since the pane takes 208px. Rules live in `app/native-theme.css`; `app/settings.css` stays upstream's.
- A signed desktop update installs and relaunches the app, so `AppUpdatesSection` reports `busy` up to `SettingsPanel`, which keeps backdrop clicks and Escape from dismissing the dialog mid-upgrade. That is the reason for the `onBusyChange` prop; don't drop it when refactoring the panel.
- `UpdateReminder` opens the panel at `general`, where the update status now lives. `components/fork-extractions.test.mjs` pins that the update/desktop code stays in those fork-owned files instead of being regrouped into `SettingsPanel.tsx`.
- The dialog appears and disappears. Its entrance was already the app's shared one (`native-backdrop-in` on the scrim, `native-modal-in` on the sheet); what was missing is the exit — the panel was removed from the DOM on the click, so the sheet blinked out and the disappearance was never seen. `closeSettings` in `AppShell` sets `settingsClosing` (the panel's `is-closing` class on backdrop and surface, `pointer-events: none`), the shared reverse (`native-backdrop-out` / `native-modal-out`) plays, and the unmount happens after `SETTINGS_EXIT_MS` — `--dur-base`, the same length `DIRECTORY_PICKER_CLOSE_MS` uses. **The exit is cancelled only by an open, and the cancel lives in `openSettings`, next to the state it changes.** It must not be an effect watching `[settingsClosing, settingsSection]`: for the whole exit the section *is* the one being closed, so such an effect cancelled every close the instant it started — the sheet snapped back into its entrance, which read as a dialog that would not close and had no animation at all. Every open routes through `openSettings` (the gear, the shortcuts, the sidebar, the composer's bare `/mcp`, the update reminder), the timer is cleared on unmount, and `prefers-reduced-motion` turns both halves off. `components/SettingsPanel.animation.test.mjs` pins the mount, the classes, the keyframes and the writers of the section state; `e2e/settings-animation.mjs` measures the CSS, and `e2e/settings-exit.mjs` (in `e2e/run.mjs`) drives the shell in a real page: open, close, mid-fade, gone, Escape, and an open during the exit that cancels it and closes normally afterwards.

## Topbar, chat column, and right panel — who contains whom
Upstream segment D (0e36743) restructured `AppShell.tsx`'s main region in ways this fork's layout cannot survive; all three are pinned by `components/AppShell.right-panel-row.test.mjs`:

1. The "Center: chat" column must contain BOTH the topbar's chat content AND the chat wrapper. A merge variant closed the column right after the topbar, making the chat wrapper a second `flex: 1` row child — the viewport split 50/50 between an empty topbar-only column and the chat ("huge blank middle column, chat clipped at the right edge").
2. The right-panel toggle/backdrop/resizer/panel block must be inside the row, not after its close: as flex-**column** children of `.app-shell` the closed panel's content height still stole vertical space (`height: 432px` at `width: 0`), floating the composer.
3. Since 2026-09-24 the topbar sits inside a main column that follows the sidebar as a child of the outer row: `.app-shell` (column) → offline banner → outer row → [backdrop, sidebar (full height), sidebar handle, main column → [topbar, inner row → [center chat]], panel block]. The sidebar runs the full window height (its header hosts the macOS traffic lights via `session-sidebar-header--mac-inset`), and the topbar spans only the center column. Since 2026-10-14 the file panel block is a full-height sibling of the main column, drawn as an inset card (`--right-panel-gutter`, rules at the end of `app/native-theme.css`) that reaches the window top, like Claude Desktop's side panel; the card is one plain surface (no horizontal rules, the file tree white on its left, a × close in its header) on a canvas the topbar no longer tints or underlines, and its header row is a window drag region. `WindowControls` render in the topbar while the panel is closed and in the panel's header row while it is open, so they stay at the window's top-right corner. There is deliberately no `paddingLeft: sidebarResizer.width` on the topbar anymore — that was the old full-width-topbar hack that left a blank strip above the sidebar; re-adding it on a merge regresses the layout. `app-topbar--mac-inset` (72px) is only for the sidebar-closed/mobile case where the traffic lights land on the topbar itself.

The topbar renders exactly ONE toolbar group (`app-topbar-actions`: history/branches/more), pushed to the right edge by `margin-left: auto` — right-aligned since 2026-09-24 (a user request; an earlier experiment had it left of the title via `order: -1`, removed). The inline session-stats button (`renderSessionStatsButton`, ↑in ↓out ↻cache $cost) was removed the same day — session info opens from the More menu entry instead; `sessionStats`/`contextUsage` state stays (auto-name guards + More-menu labels). Segment D also left a second desktop group (`renderChatToolbarActions(false)` — history/generate-title/system/tools) next to it; the duplicate is removed, its unique entries (Sub-agents, Tools) live in the More menu via `handleSystemInfoToggle` (keeping the lazy dormant-session start), and its generate-title guards (persisted-stats counting + `selectedSession.transient` check) were merged into the group-A button — pinned by `AppShell.auto-name.test.mjs`. JSX indentation in AppShell.tsx is unreliable; verify structure with the TS AST or the DOM, not by counting whitespace. `fileContentBlock()` in `AppShell.file-viewer-state.test.mjs` slices source by the panel's closing-div sequence — keep in sync.

**A hover state is a solid layer, not a window.** The palette's `--bg-hover` is a 4–5%
overlay (light `rgba(0,0,0,.04)`, dark `rgba(255,255,255,.05)`) because it has to sit over
the desktop's translucent vibrancy window. The panel header has nothing opaque under it,
so the right panel's × (`.file-workbench-icon-button`) took that overlay straight over the
header, and pointing at the control the user is about to press read as the glyph going
faint. Compositing it with `color-mix` does **not** fix this: mixing a 5%-alpha colour
with an opaque one yields a layer that is about *half* transparent — measured in a browser
as `color(srgb … / 0.52)` — so the wallpaper kept showing through the hovered button. The
wash is therefore a solid build-up: `background-color: var(--surface)` (the base the
control sits on) with `background-image: linear-gradient(var(--bg-hover), var(--bg-hover))`
as the tint, one opaque layer, the same look in every palette, plus the glyph brightening
to `--text`, which is the feedback that was asked for. The same rule covers
`.right-panel-close:hover` and `.terminal-panel-header button:hover`. Measured in
`e2e/panel-hover-wash.mjs` (opaque base, tint over it, a composite at least 3 levels from
the strip, and a control pass proving the old `color-mix` recipe is translucent);
`app/native-theme-hover.test.mjs` pins the declarations and forbids both the bare overlay
and any `opacity` on a hover state.

The same token is what **upstream** paints the image preview's close with:
`app/globals.css` has `.image-preview-close:hover { background: var(--bg-hover) }`, and that
button floats over the dialog's `rgba(0, 0, 0, .72)` backdrop — clicking an attached image
in the composer, then touching the × at the top right, showed a plate that was "a little bit
transparent" (the photo through the control). `app/globals.css` is upstream-owned and stays
byte-identical, so the fork's override in `app/native-theme.css` lays the same
opaque base + tint under it. Measured over the photo's backdrop: base alpha `1`, composite
185 levels away from the backdrop, and a control pass installs upstream's rule to show its
alpha is `0.04` — the check cannot pass by being blind.

## Conversation header: project, branch, and the running clock

The title block (`app-topbar-title`) is the session title and, under it, one
context row (`app-topbar-subtitle-row`): `[folder] project`, `[branch] branch`,
`[clock] 1h50m32s`. The row replaced the old one-line `<small>` subtitle, which stays
`display: none`. The clock (`components/TopbarElapsed.tsx`, ticking in
`hooks/useElapsedSince.ts`) counts from the conversation's last prompt, which
`ChatWindow` reports up (`onLastPromptChange`, from `getUserInputText` scanning
back): a background subagent's report, a compaction summary, and the side-chat
boundary are custom messages, so they run the clock and never restart it. It is
rendered **only while the session runs** (`runningSessionIds.has(selectedSession.id)`):
a count that keeps ticking after its task ended is not a clock, so the chip is gone
the moment the run is over — on a main session and on a subagent's own session page
alike. The label is `formatTurnDurationCompact(elapsed, { withSeconds: true })` —
`1h50m32s`, `12d0h54m32s` — with `tabular-nums`; the seconds stay because a running
clock that changes once a minute reads as frozen, while a finished turn's length in
an assistant footer keeps the short `1h50m` (no options). The chip is a component of
its own on purpose — a per-second render inside AppShell would re-render the shell,
the sidebar and the chat column every second. The row is **visible on a phone**
(`@media (max-width: 900px)` hides only the old `<small>`; `@media (max-width: 640px)`
widens `.app-topbar-title` to `min(64vw, 340px)`): the header is the only place a
phone sees the project, the branch and the elapsed time. The clock never wraps
(`flex: 0 0 auto`); on the narrowest phones it is the *branch* that ellipsizes.
Pinned by `components/AppShell.topbar-elapsed.test.mjs`, and the row's shape and the
branch's contract by `components/AppShell.topbar-branch.test.mjs`.

The row's room is `.app-topbar-title`, and the bar's actions push with
`margin-left: auto` — an auto margin takes the free space before `flex-grow` does, so
the column is sized by its **own content** and every cap on it truncated the row: 420px
at desktop, then 240px at 1120px and 160px at 900px, which is how a 960px window ended up
showing `pi-desk  fe…`. The caps are gone (`max-width: none`; `min(72vw, 560px)` at
900px, `min(78vw, 420px)` at 640px) and the session title is the label that gives way:
`width: 0; min-width: 100%` keeps the title's text out of the column's intrinsic size, so
the project row is what sizes the column and the title is what ellipsizes.

Nothing in the row grows. The branch is `flex: 0 1 auto`, not `flex: 1 1 0`: a growing
branch filled the column and shoved the clock and the subagent counts to the far edge —
measured 320px from the branch's words, in a row whose project is six characters. Labels
that take their own width sit together (the clock 12px behind the words) and the branch
is still the first to shrink. A phone keeps the row on one line (`flex-wrap: nowrap`
at 640px): three stacked header lines are worse than an ellipsized branch, and the tip
below carries the whole name. The project keeps `min-width: 5.5em` (5em on a phone).

The branch is a control, `components/TopbarBranchChip.tsx`, not a label with a native
`title`: hover and focus on desktop, a tap on a phone, and the app's tip appears under it
with the **whole branch name** — the branch tip shows the branch and nothing else. The
project label in front of it is a control too, `components/TopbarProjectChip.tsx`, and its
tip is:

```
Path
/Users/lynx/Documents/github/pi-desk
```

so the folder the session works in is one tap from the label that names it. Both share the
plumbing in `components/TopbarTip.tsx`: `role="tooltip"`, `--z-popover`, repositioned on
reflow, closed by Escape or a tap elsewhere, and a touch pointer is ignored by the hover
handlers so a tap does not fight it. **The tip's value never ellipsizes** — the surface is
`min(70vw, 420px)` and its text wraps (`white-space: normal; overflow-wrap: anywhere`), so
a long branch name and a long path read complete on a 390px phone; the tip exists to carry
what the row could not fit, so cutting it in the tip defeats it. The native tooltip this
replaced showed a raw key in Safari (`chat.gitBranchTitle`, missing from every catalogue —
the tip's labels are keys in all three locales now, and `lib/i18n/registry.test.mjs` keeps
the locales in step) and on a phone a native tooltip never opens, so the full name was
unreachable exactly where the row cuts it.

**A worktree is a checkout of its project, not a project of its own.** Working in
`tab-to-find-worktrees/fix-wt-test-first-click-delayed-scroll`, the header and the composer
said `fix-wt-test-first-click-delayed-scroll`, which is a folder name the user never chose
and which names no project. Both now read the repository the folder belongs to
(`hooks/useProjectBranch.ts` → `useProjectIdentity(cwd)`, whose `readProjectIdentity` is
exported and unit-tested): the label is the project's display name
(`getProjectDisplayName(projectRoot, availableProjectRoots)` — the same resolution every
project name uses, so duplicate basenames stay disambiguated), and the glyph in front of it
is `WorktreeIcon`, the checkout glyph, in the header
(`TopbarProjectChip`'s `isWorktree`) and in the composer (`ComposerProjectChip`'s
`isWorktree`, fed by `ChatWindow`'s `composerProjectRoot` / `composerProjectIsWorktree`). A
session carries both from its file (`SessionInfo.projectRoot` / `isWorktree`); a fresh
composer resolves them from the folder it points at, so the pair agrees with the branch chip
beside it. Only a linked worktree takes the glyph and the project name — a normal checkout
keeps its folder name, because there the folder *is* the project. The worktree's own path is
not lost: the project tip's `Path` row is `visibleProjectCwd`, the folder being worked in,
and the branch chip names the branch that lives there. **The project row is the chip that
says which folder this is**, so it is the one that wears the checkout glyph; the branch chip
beside it always wears `BranchIcon` (see the next section). `components/AppShell.worktree-project.test.mjs`
pins the resolution and the four places it is worn; live on the user's repository it reads
`tab-to-find` + the checkout glyph in the header and the composer, with the menu listing
every branch of the repository.

The row ends with the context ring, `components/TopbarContextChip.tsx` (last turn's move out
of the composer's control strip). Its tip is the numbers and **nothing else**: `Context
usage` over `37.6% ctx · 161.8M tok · $0.123` and `Window` over `400k / 1.0M`, both from
`lib/context-usage-summary.ts` so the accessible name, the tip and the stats panel say the
same sentence. A "Session stats" row inside the tip was removed: a control inside a readout
turns a label into a target the pointer has to aim at, and the panel already has its way in
through the chat's usage command (`onSessionStatsPanelOpen`, `hooks/useAgentSession.ts`).
With nothing to report the chip renders nothing, so an empty ring never reads as a spinner.

**The row's order is `[folder] project  [branch] branch  [robot] ✓2 ⚠1 ↻3  [side] 2 ↻1
[clock] 11m5s  [context]`.** The counts of the family's runs come right behind the branch —
they are the state of the work — and the clock is the tail of that state, with the context
ring last. The clock used to sit in front of the counts, so the row read as a header that
ended with a label.

`components/TopbarSubagents.tsx` is the family's chip: **one button, two groups**. A family
holds two kinds of member (ADR 0007, `lib/session-family.ts`), and `countSubagents` /
`countSideChats` read them apart — a delegated run and a conversation the user opened are
different facts, and "6 runs" that mixes them says nothing a user can act on. Each group
leads with the glyph its kind already wears elsewhere (the Agents panel's head, and the
side-chat bubble `components/SideChatIcon.tsx` draws for the composer, the sidebar, a tab
and the panel), so the row reads
`[robot] ✓2 ⚠1 ↻3  [side] 2 ↻1`. Both groups open the same panel, so they live in **one**
control: two `<small role="button">` neighbours would be two targets for one action and two
tab stops on a phone, and the accessible name is both sentences joined.

**The kind's head is one drawing, the state's head is another.** The chip's leading robot
is the app's subagent head — the same `<rect x="5" y="7" …>` + `M9 11h.01M15 11h.01M9 15h6
M12 7V4M10 4h4` the sidebar's subagent row, the Agents panel's rows and the
Settings › Agents icon draw. It used to be a second robot (an antenna ball with vertical-bar
eyes) ten pixels from the first, so the same delegate read as two different things. The
running bucket keeps its own lit-eyes head (`AgentRunningIcon`, the pulsing one the Agents
panel imports at row size): merging the two would make the chip's leading glyph and its live
count one shape, and the row would stop separating "this family delegates runs" from "one of
them is going right now". `AppShell.topbar-branch.test.mjs` asserts the head's paths match
the sidebar, the panel and the Settings icon, and that the running eyes stay `M8 13h2` /
`M14 13h2`.

**No rule is drawn between the two groups.** A vertical divider inside a single control
reads as two controls, which is exactly what the row looked like; the 10px gap plus each
group's own leading glyph (robot / the shared side-chat bubble) is what separates them.
`components/AppShell.topbar-branch.test.mjs` asserts the sibling rule carries
`margin-left: 10px` and **no** `border-left`, and that no
`.app-topbar-family-group--side::before` exists.

**The chip and the ring are gray at rest and lit under the pointer.** An accent glyph and
an accent ring sitting at the end of a row of muted labels read as two live controls that
answer to nothing, and the chip that opens the Agents panel had no pressed state at all —
no answer to "is this clickable". So:
`.app-topbar-subagents` wears the row's pill (`padding: 1px 4px` and
`background: var(--bg-hover)` on `:hover` **and** `:focus-visible`, the same wash the branch
label takes — measured equal, not asserted equal by eyeball), its text goes `--text-muted`
→ `--text`, and the **side-chat group** goes `--text-dim` → `--accent` while the chip is
hovered or focused, glyph and count together.
`e2e/topbar-project-row.mjs` reaches the chip by Tab (`document.activeElement` is the chip:
one control, one tab stop) because programmatic focus is not `:focus-visible`.

The context ring's colour is a token the stylesheet owns — `--ctx-ring`, rest
`var(--text-dim)`, hover / focus / open tip `var(--accent)` — and the component paints the
arc with `stroke="var(--ctx-ring)"`. **One state is painted in the component and is never
gated on the pointer:** the high-risk red at `CTX_DANGER_PCT` (90%). A warning that needs a
hover is a warning nobody sees, so `?danger=1` in the fixture asserts the arc is
`var(--danger)` with no pointer on it.

**A side chat has no outcome.** Only a subagent relation carries a `status`; a conversation
the user is typing into is not "completed" or "aborted". The side-chat group therefore
states its count and its live runs (`{total} side chats · {running} running`), and there is
no `chat.sideChatsCompleted` / `chat.sideChatsAborted` key to invent a check mark for —
`components/AppShell.topbar-branch.test.mjs` asserts those keys stay **absent** from all
three locales, because a ✓ over a conversation is fabricated data.

`e2e/topbar-project-row.mjs` measures all of this in Chromium: the four labels at
1920/1200/960/700px, the distance from the branch's words (measured on a Range, because a
growing label carries its empty space with it) to the clock, the branch tip under hover and
under a tap on a 390px touch context, the project tip's `Path` row on both, and `?long=1`
— a branch name and a path wider than the phone, which the tips must show complete and
wrapped. Two control passes put the old rules back: the 760px cap with a growing branch
strands the clock, a 200px column cuts the name to a stub — so the checks cannot pass by
being blind.

## Composer branch chip, and a worktree from a branch

A new-session composer ends its control row with `[branch icon] main`, right behind
the project chip (`components/ComposerBranchMenu.tsx`, mounted by `ChatInput` with
`branchChipCwd` — an open session and a chat render nothing). **The chip always wears
`BranchIcon`.** A worktree session used to wear `WorktreeIcon` there, and the header read
`[folder] pi-desk  [worktree] wt/x`: one row, the same glyph twice, and a claim about the
folder standing in front of a branch name. The chip is the project row's twin
(`.app-topbar-branch-hit` is in the same CSS block), the project chip already says which
folder this is with its own tip, and the sidebar, the composer's chip and the branch list
all use `BranchIcon` for "this is a branch". The kind stays in the words: the accessible
name is `chat.gitWorktreeBranchTitle` ("Worktree branch: x") and the tip's `Branch` row is
labelled `chat.branchTipWorktreeLabel` ("Worktree branch"), so a phone and a screen reader
lose nothing. `lib/worktree-folder.ts` is no longer asked of the chip, and the header's
`WorktreeIcon` lives on the project row, where the folder is the fact
(`components/AppShell.topbar-branch.test.mjs`, `e2e/topbar-project-row.mjs`).

It opens the project
menu's own pages (`components/ProjectContextMenu.tsx`, driven by
`hooks/useProjectWorktreeActions.ts`), so the branch list, "Fetch from remote", the
worktree list and the new-worktree form are the same code the sidebar's "…" menu
always used. The chip adds one button after a branch name: the worktree icon opens the
new-worktree form **from that branch** — the branch is created at the row's tip
(local ref, else the one remote that carries it) and checked out in
`<repo>-worktrees/<branch>`, and the new session moves into that folder while the
folder the composer was opened from keeps its own branch. The row's **name is the
switch** (it was always the only thing that could be): a second branch glyph that
also checked the branch out was a target that did the same thing as the label, and a
button on a row whose branch git would refuse (this folder's own branch, a branch a
worktree already holds) promised a click that answers with an error. The form names the base
branch and the folder the branch lands in, and picking an existing worktree moves the
session there. A worktree the
composer was sitting in, once removed, sends the composer to the project's main
checkout. The sidebar's "…" menu keeps folder actions only: `Switch branch` and
`Worktrees…` are gone from it, DOM and native, so the app has one branching surface.

**The branch page is a tree, not a list, and it is the panel's first page.** The
`Project actions` step is gone: the chip opens branches, the panel opens at the top of
the tree, and Escape, Cancel, a click outside close it, as every other menu of the app.
`lib/branch-tree.ts` orders it: the branch this folder is on, then the branches that own a
folder of their own, then the rest — names with no `/` first, then each prefix as a group
row with an arrow that folds it (`aria-expanded`, and a count of what a fold hides),
nested as deep as the names go (`wt/a/b` sits under `wt` then `a`), remotes included
(`origin/main` groups under `origin`). A leaf under a group is labelled by the part the
group's row did not already say, and carries the full name in `data-branch`: a branch name
is what a git call takes and what a screen reader reads, and it must never be cut. The
glyphs are the three facts, in two voices: `ProjectFolderIcon` for a branch the project's own
folder holds (the main checkout's own row included), `WorktreeIcon` for a branch a **linked**
worktree holds — and for the current row when this checkout *is* a linked worktree —, plain-ink
`BranchIcon` for every other name and every group; the accent voice is only ever a fact, never
decoration. `BranchRow.holderIsMain` (the checkout that holds the branch, which for the current
row is this folder) is what says which of the two glyphs the head of the list wears. Titles say
what a row will do (`sidebar.currentBranchTitle` on the main checkout,
`sidebar.currentWorktreeBranchTitle` in a linked folder, `sidebar.mainCheckoutBranchTitle`,
`sidebar.branchInWorktreeTitle`, `sidebar.branchRemoteTitle`, `sidebar.switchBranchTitle`).
A removal is confirmed in the row of the branch that owns the worktree, so the
`Worktrees…` page has no menu item any more — the branches with folders are rows here —
and the desktop shell keeps its native popup with its own page. A filter box appears once
the list is longer than `BRANCH_FILTER_THRESHOLD`, and a query unfolds every group: a search
that answers from inside a folded group is a dead end.

**Nothing in this panel may be cut, so the panel is as wide as its longest name.**
`.sidebar-project-context-menu--wide` is `width: max-content` with a 240px floor and a
`min(420px, calc(100vw - 16px))` cap; a branch name has `min-width: 4em` and
`overflow-wrap: anywhere`, so it is squeezed against the window's own edge by breaking
inside a word, never by an ellipsis; a `remote` / `worktree` tag is `flex: 0 0 auto` with
`white-space: nowrap`, because the word "w…" says nothing; and the row's button keeps
`overflow: hidden` as the last line of defence, with the action icons outside it.
The new-worktree form's folder hint is a path, so it wraps with `overflow-wrap: anywhere`
too. `e2e/branch-menu-rows.mjs` measures all of it in Chromium and re-runs the fixture
with those four rules surgically removed, expecting the overlap back; the unit test
asserts the CSS carries them, so the browser check cannot pass on an empty file.

The chip opens the **app's** menu on click, on every platform: a branch row carries a
button — the worktree that branch can start — which a native popup cannot host, and a long
list wants a box to narrow it. The
desktop shell keeps the OS popup for the **right-click**, where a plain list of names is
what a pointer wants (`onContextMenu` → `showNativeProjectBranchMenu`); the popup answers
with the same `buildBranchRows` order — the checkout's branch, the worktree branches, the
rest — because two orders of one list read as two different lists. The chip reads
`newSessionCwd ?? activeCwd` (`AppShell`'s `onBranchChipCwd`): the folder the composer's
project chip names. Reading `activeCwd` alone listed the *previously selected* session's
branches under a chip labelled with the new session's project.

**Branches belong to the repository, so a worktree's menu lists them all.**
`fetchProjectBranchMenu(cwd)` is keyed by the checkout that was asked about, and the payload
is accepted when it *belongs* to it: `data.projectRoot === cwd`, **or** `cwd` is one of the
worktrees the payload lists. The equality check alone rejected every linked worktree — the
endpoint answers a worktree with the repository's root — and a repository with a dozen
branches read as "No other branches" while its sidebar row showed them. The guard is not
dropped: a response for an unrelated project must still never paint this menu, and the
stale-response protection is what `root: cwd` (the checkout the actions run in, the value
`useProjectWorktreeActions` posts) is for. `projectRoot` rides along in the state so the
menu can name the project a worktree belongs to.

A branch checked out in **another** worktree cannot be checked out here, and git's refusal
is a useless answer, so `useProjectWorktreeActions.switchBranch` never asks git: it finds
the holder and calls `onBranchInWorktree`, and the chip selects that worktree — the header's
project label does not change, the session works in that folder, and the header's branch
glyph becomes the worktree's (`SessionInfo.isWorktree`). The row says it twice: the name's
tip ("… is already checked out in another worktree — open that worktree") and the icon's
title ("… is checked out in a worktree — work in that folder", `sidebar.openWorktreeForBranchTitle`).
`switchBranch` resolves to `{ branch, worktreePath }`: the native path reopens the DOM menu
at the same point only when **both** are null, because a worktree move is a success with
nothing to report.

Above a list longer than `BRANCH_FILTER_THRESHOLD` (6 branches) the branch page carries a
filter box (`sidebar.filterBranches`): a case-insensitive substring of the branch name across
local and remote rows alike (`filterBranchRows`, exported and unit-tested), a hint that names
the query when nothing matches, and a filter dropped when the page changes — a word typed a
page ago must not hide branches silently. The box is not a `menuitem`, so the page's arrow
keys keep walking the branches, it never takes the caret on open, and Escape stays the menu's
(it closes the page, as it closes every menu: `useMenuNavigation` stops the key before the
box can see it, so a keydown handler on the input would never run). `e2e/branch-menu-filter.mjs`
types into a twelve-branch fixture and reads the rows back; its `?short=1` pass requires the
box to be **absent** for three branches, so the check cannot pass by always having a box.

A branch row is `[name] [remote|worktree tag]` inside one button, with the **one** action
icon after it: the worktree this branch can start. It used to carry a second icon that
checked the branch out, which is exactly what the name under the pointer already does, and a
row with two ways to do one thing reads as two different things — the user asked for the name
to *be* the switch (`components/ProjectContextMenu.tsx`; `e2e/branch-menu-rows.mjs` counts
one action button per row). The name is the flexible element (`min-width: 4em`,
`overflow-wrap: anywhere`) and the tag is the element that gives way (it shrinks and
ellipsizes); the button clips. A long name like
`claude/conversation-list-optimization-9ec111` used to push the `remote` tag past the
button's edge, where it painted over the icons — `e2e/branch-menu-rows.mjs` measures
the tag against the icons in a real browser, and its last pass removes the rules to
prove the measurement can see that overlap.

The chip's menu is placed for the height the panel **settles at**, and it is invisible for
the first beat of the fetch. `lib/menu-placement.ts` owns one cap — `MENU_MAX_HEIGHT_PX`
(420) and `MENU_MAX_HEIGHT_CSS` — and the chip's estimate, `useMenuPlacement`'s **first**
placement, and the panel's own `max-height` all read it: placed from 560 (the number this
shipped with) against a 420 cap, the panel's top sits 140px above where its content can
reach, and the measured placement moves the visible panel when the list arrives.
`placeMenuWithinViewport` also **keeps the side it chose** (`side` in the result, remembered
in the hook): a menu whose list arrives later grows its far edge, the way a native menu
does, and never flips from below the chip to above it mid-flight — the flash the user
described ("it pops out below the chat composer, and then it would immediately show up
above, so it looks like it just flashed"). The cap floor is in force while the menu is born
**and** while its list is in flight — the panel passes `{ growing: loadingShape }` — because
the hook's first placement is not the last one: the `ResizeObserver` re-places from the
measured height on every later frame, and in the live app that put the loading shape 343px
from where the list landed. Once the content is final the measured height rules, so a
five-branch repository still sits against its chip.
The branch page paints no shape at first: the panel is invisible for
`MENU_SKELETON_REVEAL_MS` (120 ms, timed in code, so a reduced-motion rule cannot strand it
invisible) and paints the eight skeleton rows — at the list's height — only on a fetch that
takes a beat; focus goes to the first row as it shows, because focusing an invisible element
is a no-op. `e2e/branch-menu-rows.mjs` samples the panel **every frame** from the click (a
round trip per sample steps over phases that last tens of milliseconds) and reports the
movement of the visible rectangle: **0px** (38 frames, top and bottom both locked), while
`?flash=1` puts the fixture back on the pre-fix flow and shows **342px** — the check cannot
pass by being blind. Measured live in the app: `visible tops 38..38 → drift 0px`.

The composer's **project chip** is a new-session control only: `ChatInput` gates it on
`showProjectChip`, which `ChatWindow` passes as `!chatOnly && isNew`. A session that has run
is pinned to its project and the header above names it, so an inert copy under its composer
is noise.

The header's row reads `[folder] project  [branch|worktree icon] branch  [clock]  [subagents] N [✓] N [⚠] N [↻] N`. The worktree
glyph is asked of the **folder**, and of nothing else: the header's project chip, the composer's
project chip and the branch list's current row wear `WorktreeIcon` when the folder the session
works in is a linked worktree checkout (`SessionInfo.isWorktree` / `ProjectInfo.isWorktree`), and
`ProjectFolderIcon` on the main checkout and in a plain folder. It used to ask a second question —
is this folder the worktree the app made for the branch we are on (`lib/worktree-folder.ts` reads
the `<repo>-worktrees/<branch>` pairing backwards)? — so that a linked folder switched to an
ordinary branch read as a plain folder: `auto-toc` on `main-bak` inside
`auto-toc-worktrees/main-bak3-test-wt` wore the **folder** glyph in all three places, on the
argument that a row is a statement about the branch in front of it. The user read that as a lie
and said so: the folder *is* a worktree, and the glyph is how they check which folder a prompt is
about to run in — the same branch name can live in the repo and in a worktree, and the folder is
the fact that changes what a session touches. `lib/worktree-folder.ts` stays as the naming rule
the new-worktree form shows while a branch name is being typed; nothing asks it of a glyph.
The chips' own tip (`Path`) and the row's title carry the folder, so the words say it too.
Hover, focus, or an open tip lights a chip's label **and its glyph** onto `--text`: the row's
only state used to be the `--bg-hover` wash, and over the chrome's translucent bar a 4% tint
says nothing (the glyph sits below the button, where `.app-topbar-project svg`
out-specifies an inherited `color`, so it is named with the label).
The counts are the
active family's subagent runs (`components/TopbarSubagents.tsx`,
`countSubagents`): the subagent glyph, then completed / aborted (aborted counts failed
and stopped runs too) / running, each with the Agents panel's own icon for that state
(the check, its stopped mark, the pulsing runner) in the success / warning / accent
colours. No total is printed — the three buckets are the total, and a number after the
glyph only took width from the project and the branch. Clicking
opens the Agents panel, and a session with no subagent runs renders nothing. The panel is
one `.app-menu` surface — the rounded card, the separator and `--shadow-popover` every
popup already uses — and not a box welded to the topbar: no hairline down its sides, no rule
under the header, none under the search box, none under a row. Its rows are flat and rounded
and the selected one is a wash with an inset accent bar (`--menu-selection-color`);
delete confirmation and steer field are inset strips. **The main agent's row is outside
that selection** (`.agent-row.is-main.is-selected` is `background: transparent`,
`box-shadow: none`, with the pointer's `--bg-hover` kept): the list always opens on it and
the row says "Current" in words, so a wash and a blue bar on the row that is never *not*
selected highlighted nothing and made the panel's first row the loudest thing in it. A row
the user actually switched to (a side chat, a run) still takes the wash and the bar.
The filter box lives in the header row with the title and the counts (the `> 8` gate is
unchanged) and is a **quiet filled field**: `border: 0` and a tint of the theme's own ink
(`color-mix(in srgb, var(--text) 8%, transparent)`) — `--surface-muted` is a white wash that
vanishes on the `--surface-elevated` card — and its `:focus` / `:focus-visible` rule paints
nothing, so typing in it raises no accent border and no ring: the box is already a shape and
the caret is the position (`components/AgentSessionPanel.test.mjs` asserts both).

The card's surface and its place are both measured (`e2e/agents-panel-card.mjs`, real
CSS and real components at 1440 / 834 / 390): a rounded rectangle (`--menu-radius`), the
menu's shadow, `--surface-elevated` ink, and a
layer that never scrolls (`overflowY: "visible"`) because a scroll container clips the
shadow on the left, the right and the bottom. The tail of `app/native-theme.css` used to
undo all of that with `.agent-session-panel { background: var(--bg-panel) !important;
border-radius: 0 !important }` — the sheet in the user's screenshot — so the panel now
states the three things itself as `.agent-session-panel.app-menu` (0,2,0), which no
single-class rule can beat. Placement is `placeAgentsPanel` in
`lib/top-panel-placement.ts` (pure, `lib/top-panel-placement.test.mjs`), and it anchors
on `topbarSubagentsRef` — the chip publishes its box through `anchorRef`, which is the
only reason the card knows where the count is. A desktop and a pad open the card **under
the count**, its left edge in line with it, clamped so its right edge stays inside the
conversation column (pinned to the topbar's right edge, the 420px card sat on the file
panel, a screen from the control that opened it). A phone's row wraps and the count can
land anywhere, so there the card **centres on the page** below the header, the way the
phone's other popups read. Both keep `AGENT_PANEL_DROP_GAP` under the header and
`AGENT_PANEL_EDGE_GUTTER` from the edges: a card flush with a window edge loses the
shadow on that side, which is the flat look the card is meant to escape. One local caveat
is worth knowing when a panel refuses to look round: the install's
`<agentDir>/desktop/custom.css` loads after every app stylesheet, and an id-scoped block
like `#panel-layer .agent-session-panel { border-radius: 0 !important }` in it still wins
the cascade (a bare single-class rule no longer does).

**The three read-only cards the More button opens** (system prompt, tools, session stats)
wear the same `.app-menu` surface and open under the button, at the conversation column's
right end (`placeHeaderCard`, `lib/top-panel-placement.ts`). The prompt is prose and the
tool list is two panes, so each keeps a reading width (`SYSTEM_PROMPT_PANEL_WIDTH` 680,
`TOOLS_PANEL_WIDTH` 780). The **session stats card fills the column** (`"fill"`): three
columns of numbers want the horizontal space the conversation has, and capping it at 900
left a 900px card in a 2081px column with its Tokens numbers cut off the right edge — the
card's `overflow: hidden` makes an over-wide column invisible, not scrollable. So the
numbers columns are `minmax(…, max-content)` tracks that hug the card's right edge (a wide
column never pushes a value away from its label), the first column takes the slack because
it carries the long paths, and below `SESSION_STATS_STACK_WIDTH` the card stacks into one
column. The compact rows keep `max-content max-content` tracks for the same reason.
`components/AppShell.topbar-branch.test.mjs` pins the placement and the tracks;
live at 2342/1440/900/390 the card's `scrollWidth` equals its width and the page never
scrolls sideways.
A running row leads with the header's subagent head (`AgentRunningIcon`, exported, at row
size, pulsing), not a spinner: one shape for one state.
The row
wraps, and the counts are its last item, so on a phone, or behind a long project name,
they take the second line; the topbar is a floor (`minHeight` in `AppShell`, `height:
auto` in the standalone rule) so a wrapped line grows the bar instead of spilling into
the chat. The branch name is polled (`hooks/useProjectBranch.ts`: 3s on the cheap
`GET /api/worktrees/branch`, refresh on tab focus, 60s client cache, `setBranch` only
on a change) — a checkout made in a terminal shows up without a reload.

## Composer text across devices

A composer's draft is mirrored to the server (`lib/composer-draft-store.ts`,
`PUT/GET/DELETE /api/composer-draft`) so the prompt typed on the laptop appears in the
phone's composer: `lib/composer-sync.ts` pushes on a 700ms debounce and polls every 4s
while the tab is visible. The key is a shared identity (`composerSyncKey`: a session id,
`parked-new:<cwd>`, or the folder of a `new:<id>:<cwd>` draft — the device's own draft id
is dropped), the newest `updatedAt` wins, and a client applies a remote copy only when it
is newer than its own last write, so typing is never overwritten by its own echo. A
composer that only *loaded* a draft never pushes it: that content was written by the
device that typed it. Sending clears the server's copy. Two rules keep the mirror from
eating the composer it mirrors, and both came from real losses:

- **The store keeps no empty draft.** An empty snapshot is written by the debounced
  mirror right after a send cleared the composer; applied elsewhere it wipes a prompt
  that was being typed. `pushComposerDraft` answers an empty composer with a DELETE, and
  `writeComposerDraft` treats an empty write as the clear (never stale). The composer
  also refuses a remote copy that is blank while it holds content
  (`BLANK_DRAFT_SIGNATURE` in `components/ChatInput.tsx`).
- **A draft the mirror cannot carry stays local.** A pasted screenshot is routinely
  larger than the store's image cap, so a push used to store the prompt *without* the
  screenshots and the composer's own 4s poll painted that trimmed copy back: the
  attachments vanished mid-typing, with no reload and no send. `normalizeComposerDraft`
  reports what the size guards refused, `writeComposerDraft` refuses such a write (the
  route answers **413**, and a whole-snapshot refusal is a `refused` result, never a
  "newer draft" 409 the client would answer by reading the store), and
  `lib/composer-sync.ts` then stops pushing and polling that composer for the tab's life —
  checked when the watcher starts *and* on the tick that learns the key is unmirrored.
  Such a composer keeps its own **monotonic stamp** (`nextStamp`): `pushComposerDraft`
  handing back `0` used to flatten the composer's echo guard, and the next accepted
  snapshot then looked newer than anything the composer had written. The user's composer,
  with its attachments, beats the other device's copy.

`lib/composer-sync.test.mjs`, `app/api/composer-draft/route.test.mjs` and
`components/ChatInput.composer-sync.test.mjs` pin each half. See
[fork-files-security](fork-files-security.md) for what the mirror may hold.

## The right panel opens on a terminal

`handleRightPanelToggle` opens a project panel onto its shell: with a live terminal
tab it activates that tab when nothing is shown, and with none it calls
`handleOpenTerminal(visibleProjectCwd)` — it no longer opens the file list, which is
behind its own header button (`handleFileTreeToggle`, `fileTreeOpen`). A chat has no
shell (`isChatWorkspaceActive`), so a chat panel with no tabs still falls back to the
tree, and a chat's hidden cwd is never a terminal cwd. Because the panel's open path
calls `handleOpenTerminal`, the toggle is declared *after* it in `AppShell.tsx` (a
`useCallback` dependency array is evaluated during render: declaring it first reads an
uninitialized `const`). The toggle also raises a phone's keyboard through
`lib/terminal-focus.ts` — see [../terminal.md](../terminal.md).

# 本地定制与桌面上游同步

单选菜单（Config、推理级别、模型、表单选择与项目/分支/worktree）与设置导航共用左侧蓝色短条和选中底色，不使用对号。默认值星标保持独立：空心星直接可点，保存成功后显示点亮的实心星，无底色、边框或阴影；保存时菜单保持打开。保留键盘焦点提示与 4px 行间距。

选项几何统一由 `app/native-theme.css` 的 `--choice-*` 定义：设置导航基准的 8px 内边距和 5px 行圆角，Config 基准的 4px 行间距。弹层内层滚动容器 `.app-menu-list` 不额外增加 padding；不得为 Config、推理或模型各自叠加一层边距。`e2e/option-controls.mjs` 测量真实设置页与各类弹层的选项边界，而非仅检查 CSS 声明。

同步桌面上游时遵循 [同步流程](../fork-sync.zh-CN.md)。统一选项菜单、4px 行间距、
独立 Config 入口、发送按钮与输入框底部圆角同心、顶部操作靠右，以及运行时 home
解析必须保留；拆出的上游组件要接入这些规则，不能用旧组件替换上游功能。

## 输入框单按钮与待发送队列

- 输入框只保留一个圆形主操作：空闲时发送；运行中且草稿为空时停止（方块）；运行中有文字或附件时，点击或发送快捷键都加入“完成后发送”队列。不要重新引入 Steer / Follow-up 双按钮或底栏重复的 Stop。
- `ComposerOutbox` 把待发送消息贴在输入框上沿；每条消息支持立即发送、取回编辑、删除。窄窗口操作使用图标和完整无障碍标签，触屏点击范围至少 44px；不使用彩色描边区分队列模式。
- 待发送行的文字与排队图标之间留左侧间距：行 `gap` 加 `.composer-outbox-preview` 的 6px `padding-left`，桌面实测 14px，使多条消息沿自己的左边距成列，而不是文字顶到图标边缘。`e2e/composer-outbox.mjs` 量取文字起点相对图标（窄窗口图标隐藏时相对输入卡片左缘）的距离。
- 输入卡片是一列：文本域在上、独占整行宽度，下一行依次是 `+` 附件按钮、会话控件（`.chat-composer-controls`）、发送按钮。控件不再摆在卡片下方，长文本横贯卡片输入，操作就在文字手边。文本域用 `flex: "none"`，因为列布局里 `flex: 1` 等于零基准，会把自适应高度压回 `minHeight`（`components/MobilePwaLayout.test.mjs` 钉住）。
- 这一行的控件只有图标：推理级别、工具预设、模型选择都不显示文字，统一 32px 方按钮（`--control-h-lg`）；文字搬进 `title` 与 `aria-label`（`"Change reasoning level: medium"`、`"Change tool preset: Chat only"`、`"<模型名> — Change model"`、压缩停止按钮是 `"Stop compaction · Compacting (2/3)…"`）。`ModelSelector` 用 `iconOnly` 属性进入这种形态，Settings 与模型对话框的 `field` 形态保留文字标签。项目与分支标签保留文字：它们说明的是“哪个目录、哪个分支”，属于身份，不是设置。
- 发送按钮仍是行内最后一个控件，保持与卡片右下圆角同心；`e2e/composer-geometry.mjs` 在 12/14/20/24px 字号、深浅色、1280/390/320 宽度下量取：文本域宽度等于卡片内宽、行内按钮同一水平线（手机 More 弹层是绝对定位，不计入）、控件按钮无文字且 `title` 非空、发送圆与卡片圆弧圆心重合。
- 手机键盘弹起时 `.chat-composer-controls` 被 `html[data-keyboard-open]` 隐藏，而它正是这一行的弹性填充块：填充消失后整行靠左堆叠，发送按钮离开卡片右下角（WebKit 390px 实测 Send 在 x=130，卡片右边界 366，右边留出一条空带 —— 就是用户发来的手机 Safari 截图）。`.chat-composer-actions > .composer-send-button { margin-left: auto }` 让 Send 在有控件条和没有控件条时都钉在角上。`e2e/composer-ios.mjs` 用 **WebKit** 量这条（Chromium 的手机模拟看不出这类问题），带对照 pass（移除该规则 Send 漂移约 200px）并断言 fixture 的 class 链与 `ChatInput` 一致，防止 fixture 与被测对象漂移。
- 文本域的宽度来自这一列的 `align-items: stretch`，不是 `width: 100%`：卡片内缩是它的 padding（再加编辑器左侧 4px），整宽 *加上* 水平 margin 会把文字推出卡片右边界 8px（手机上光标落在边框里）。被拉伸时 margin 只能内缩，所以 `ChatInput` 不设行内宽度，规则是 `width: auto; margin: 8px 0 0`。这个配对是承重的：该 bug 曾因样式表里一次手改 margin 而复现，`components/ChatInput.composer-row.test.mjs` 钉住 `width: auto` 且禁止 `margin: 8px;`。
- 输入卡片没有“清空”按钮：文本域选中即可删除，键盘已能完成的事不该占去一行里属于无快捷键控件的位置；`chat.clearDraft` 随按钮从三个语言文件删除，`onClearDraft` 同时从 `ChatInput` 与 `ChatWindow` 移除。附件的移除控件各自带无障碍名称（文件的 `chat.removeAttachment` 含文件名，图片的 × 是 `chat.removeImage`，此前只是无标签图形）；历史编辑模式由自己的 Cancel 退出。
- `/ commands · @ files · # sessions` 提示与占位文字同占一行：它在卡片内绝对定位（`top: calc(8px + (var(--composer-line-height) - 1.4em) / 2); right: 0`），不再在文本下多撑一行、把提示挤到视线之外；`pointer-events: none` 不抢点击，显示条件不变。`+` 附件按钮默认和附带附件时都不加底色，附件状态只改图标颜色。文本域 CSS 只留上边距：`width: 100%` 再加横向 margin 会让文字越出卡片右缘 8px（e2e 量取文字右缘不越过卡片）。
- 立即发送通过 SDK prompt admission 的 `steer` 在下一个可接收指令的时机引导当前任务，不承诺强制中断正在进行的工具调用。编辑通过 `restoreSubmission` 合并到原会话草稿，保留已有输入与图片。
- 验证：`node e2e/composer-outbox.mjs`，覆盖深浅色、1280/390/320 宽度、换行同心圆角、排队/编辑/删除/引导、页面刷新及停止后的队列状态。


## 外观与背景

外观页的 `FontSettings` 分别选择界面与代码字体；常用字体通过共享 `AppSelect` 选择，
自定义名称显式应用，恢复默认时移除界面设置的覆盖，让原有 `custom.css` 重新接管。
`useFonts` 在 AppShell 生命周期中恢复配置、即时应用并串行保存到
`pi-web/settings.json` 的 `fonts`，旧读取不能覆盖新选择；失败保留本地预览并提供重试。
`FONT_INIT_SCRIPT` 只从本地缓存恢复首屏，服务器选择负责跨端口恢复。
界面字体同时覆盖标题，代码字体更新已有 xterm 的字体与尺寸，不重建终端会话。
默认字体栈保留上游的原生等宽字体优先级和中文回退；通过 `--font-*-default`
接入字体选择器，恢复默认时同时恢复上游的字体顺序。
字体名称为单个本机 family，不下载字体，不改写用户样式表。
桌面外观页通过 `listInstalledFontsNative()` 和受桌面进程 token 保护的 `/api/desktop/fonts`
读取本机字体；Windows 使用系统字体集合及其本地化名称，macOS 使用 system_profiler，Linux 使用 fontconfig。
两种字体选择器沿用 AppSelect 的菜单、键盘导航和间距，读取失败保留手动输入并提供重试。
字体为默认值时隐藏恢复按钮，改动后显示可用的恢复操作；标题行保留高度。
字体保存状态仅供读屏播报，不插入可见行挤动布局；错误仍显示并可重试。
嵌入设置的配置面板与侧栏共用 `--surface-elevated`，与常规/外观内容底色一致，控件和选中态仍使用各自 token。
设置行的 `.settings-option-action` 使用 `align-self: center`，与多行说明整体居中。
终端说明与 Shell 工具一致，使用标题与选项之间的 `.settings-general-description`，不放进选项卡片。
回归：`node e2e/fonts.mjs` 覆盖真实设置页、即时预览、保存/恢复、错误、菜单及按钮几何。

外观页只提供明暗模式，没有背景选择；侧栏、窗口和设置外框是同一个中性纯色（`--canvas-background`），
强调色用 CSS `AccentColor` 跟随系统。`THEME_INIT_SCRIPT` 先使用浏览器缓存避免刷新闪烁。相关回归：`node e2e/appearance.mjs`。

**悬停态是一层实心色，不是一扇窗。** 调色板的 `--bg-hover` 是 4–5% 的叠加层（浅色
`rgba(0,0,0,.04)`，深色 `rgba(255,255,255,.05)`），因为它要盖在桌面端半透明的 vibrancy 窗口上；
右侧面板头部下面没有实心底色，面板右上角的 × 就把这层叠加直接铺在头部上，指针移到准备按的控件上时
读起来像控件变淡。用 `color-mix` 合成并**不能**修好：把 5% alpha 的颜色和不透明颜色混合，
得到的层大约只有*一半*不透明（浏览器实测 `color(srgb … / 0.52)`），壁纸仍会从悬停的按钮后透出。
所以现在实心铺底：`background-color: var(--surface)` 作为控件所在的底，`background-image:
linear-gradient(var(--bg-hover), var(--bg-hover))` 作为叠加色，在每套配色里都是一层实心，
图标同时提到 `--text`。同样的写法覆盖 `.right-panel-close:hover` 与 `.terminal-panel-header button:hover`。
`e2e/panel-hover-wash.mjs` 在真实浏览器里量明暗两套：实心底、叠加色、合成后与所在条至少差 3 级，
并带一次对照（旧的 `color-mix` 写法确实是半透明，证明断言不是瞎的）；
`app/native-theme-hover.test.mjs` 钉住声明，并禁止裸叠加层与悬停态的 `opacity`。

**worktree 是项目的检出，不是一个新项目。** 在 `tab-to-find-worktrees/fix-wt-test-first-click-delayed-scroll`
里，头部和输入框都显示那串工作目录名，而用户从没选过这个名字。两处现在读目录所属的仓库
（`hooks/useProjectBranch.ts` 的 `useProjectIdentity(cwd)`，其 `readProjectIdentity` 导出并有单元测试）：
标签用项目的显示名（`getProjectDisplayName(projectRoot, availableProjectRoots)`，与其它项目名同源，
重名的 basename 仍会消歧），前面的图标换成 branch chip 一直在用的检出图标 —— 头部由
`TopbarProjectChip` 的 `isWorktree`，输入框由 `ComposerProjectChip` 的 `isWorktree`（`ChatWindow` 传
`composerProjectRoot` / `composerProjectIsWorktree`）。已存在的会话从会话文件里带这两项
（`SessionInfo.projectRoot` / `isWorktree`），新会话按当前目录解析，所以和旁边的 branch chip 一致。
只有 linked worktree 才换图标、换项目名；普通检出仍显示目录名，因为那里目录就是项目。
worktree 自己的路径没丢：项目 tip 的 `Path` 行就是正在工作的目录，branch chip 说那里的分支。
`components/AppShell.worktree-project.test.mjs` 钉住解析与四处佩戴。

**头部行的顺序是 `[文件夹] 项目  [分支] 分支  [机器人] ✓2 ⚠1 ↻3  [侧聊] 2 ↻1  [时钟] 11m5s  [上下文]`。** 家族运行的计数紧跟在分支后面（它们是工作的状态），时钟是这段状态的尾巴，上下文环收尾；时钟曾排在计数之前，整行读起来像以标签结束。`components/TopbarSubagents.tsx` 是**一个按钮、两个分组**：一个家族含两种成员（ADR 0007），`countSubagents` 与 `countSideChats` 分开计数 —— 委派运行与用户自己开的会话是两件事，混在一起的 “6 runs” 无法据以行动。每组以该类型在别处已使用的图标开头（Agents 面板的机器人头、输入框与侧栏的圆圈加号）。两组打开同一个面板，所以放在**一个**控件里：两个 `role="button"` 兄弟节点等于同一动作两个目标，手机上还多一次 Tab。可访问名是两句拼在一起。

**两组之间不画分隔线**：一个按钮内部出现竖线，会被读成两个控件（就是用户指出的样子）。
间隔只靠 10px `margin-left` 和每组自己的引导图标（机器人 / 圆圈加号）；测试断言兄弟规则只有 `margin-left: 10px`、**没有** `border-left`，且不存在 `.app-topbar-family-group--side::before`。

**家族计数与上下文环默认是灰色，指针到达时才点亮。** 在一行灰字末尾放一个 accent 图标和
一个 accent 圆环，看起来像两个随时可点的控件，而打开 Agents 面板的计数按钮此前完全没有按下态
（无法回答“这能不能点”）。现在 `.app-topbar-subagents` 在 `:hover` **与** `:focus-visible` 都戴上
头部行同一枚药丸（`padding: 1px 4px` + `background: var(--bg-hover)`，实测与分支标签的高亮背景相等），
文字 `--text-muted` → `--text`，并且**侧聊分组**（图标 + 数量）随悬停 / 聚焦由 `--text-dim` → `--accent`。
`e2e/topbar-project-row.mjs` 用 Tab 走到该控件并检查 `document.activeElement`（脚本聚焦不会触发
`:focus-visible`），顺带证明它只有一个 tab 停靠点。上下文环的颜色交给样式表拥有：`--ctx-ring`
静置 `var(--text-dim)`，悬停 / 聚焦 / 提示打开时 `var(--accent)`，组件只用 `stroke="var(--ctx-ring)"` 画弧。
**唯一写在组件里、永不依赖指针的状态是阈值红**（`CTX_DANGER_PCT` = 90%）：需要悬停才出现的警告等于没人看见的警告，
因此 fixture 的 `?danger=1` 断言无指针时弧线就是 `var(--danger)`。

**图片预览的 × 也使用实心层。** `app/globals.css`（上游文件，逐字节一致）写的是
`.image-preview-close:hover { background: var(--bg-hover) }`，而这个按钮浮在对话框
`rgba(0, 0, 0, .72)` 的遮罩上：在输入框里点开附件图片、再把指针移到右上角的 ×，底板就“有点透明”
（照片透过了控件）。fork 在 `app/native-theme.css` 里用同一套不透明底 + 渐变着色覆盖它。
`e2e/panel-hover-wash.mjs` 在照片遮罩上实测：底板 alpha 为 `1`、合成结果与遮罩相差 185 级，
并额外装回上游规则做对照（其 alpha 是 `0.04`），保证断言不是瞎的。

**侧聊没有“结果”。** 只有 subagent 的 relation 带 `status`；用户正在输入的会话谈不上“已完成 / 已中止”。所以侧聊分组只报数量与正在运行的条数（`{total} 个侧聊 · {running} 运行中`），语言文件里不存在 `chat.sideChatsCompleted` / `chat.sideChatsAborted` —— 给会话画 ✓ 是编造数据，`components/AppShell.topbar-branch.test.mjs` 断言这两个 key 在三种语言中始终**不存在**。

worktree 的分支菜单列的是**仓库的**分支：`fetchProjectBranchMenu(cwd)` 按被询问的检出取数据，
返回属于它即可接受 —— `data.projectRoot === cwd`，**或** `cwd` 在返回的 worktree 列表里。
只用相等判断会把每个 linked worktree 都拒掉（接口对 worktree 回答的是仓库根目录），
于是十几条分支的仓库显示成 “No other branches”。守卫没有删掉：不相关项目的响应仍不能画进这个菜单，
`root: cwd` 就是动作真正执行的检出。

## 设置选项细节

`ConfigSidebarList` 与 `.config-sidebar-group` 都按共享 `--choice-*` 留距；模型供应商的
子项容器同样使用 `.config-sidebar-group`，不能重新引入零间距或行内 margin。
分段控件共用 `--segment-*`，内衬和按钮间隔都引用设置行间距的 4px（5px 内圆角、9px 外圆角），涵盖明暗、语言、
发送快捷键、Diff 和作用域。选中状态在鼠标悬停自身或相邻项时必须保持；键盘焦点与禁用语义保留。
文件与 Artifact 的预览／源码切换也使用这套分段控件参数，工具定义列表同样保持 4px 行间距。
`node e2e/settings-controls.mjs` 测量真实设置组件，不只断言 CSS 字符串。

输入框加号沿第一行文字居中；SVG、占位文字和实际文字用同一行高计算。加号不是字符，
不能用字形基线偏移来补偿；多行仍保留右下发送按钮的同心几何。几何回归覆盖全部字号范围。
