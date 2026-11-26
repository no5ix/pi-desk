import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const sessionItemSource = source.slice(source.indexOf("function SessionItem("));

test("only Shift+click bypasses session deletion confirmation", () => {
  // Deleting without Shift must always route through the confirmation step.
  // The handler moved inline into the row's menu item, so match the guard
  // itself rather than a named function, and tolerate either brace style.
  assert.match(
    sessionItemSource,
    /if \(e\.shiftKey\)\s*\{?\s*void performDelete\(\);\s*\}?\s*else\s*\{?\s*beginDeleteConfirmation\(\);/,
  );
});

test("keeps the project-tree sidebar without an inline explorer section", () => {
  // Upstream's resizable sidebar explorer (ed50d88) is deliberately not
  // adopted: this fork renders the file explorer in the right panel and the
  // sidebar as Chats + project lists. The upstream quick-filter stays.
  assert.match(source, /sidebar-search-input/);
  assert.match(source, /sidebar-chats-header/);
  assert.doesNotMatch(source, /data-resize-handle="sidebar-sections"/);
});

test("the sidebar tree supports row-level keyboard navigation", () => {
  assert.match(source, /role="tree"/);
  assert.match(source, /data-sidebar-tree-row/);
  assert.match(source, /case "ArrowDown":[\s\S]*?focusSidebarTreeRow\(current, 1\)/);
  assert.match(source, /case "ArrowUp":[\s\S]*?focusSidebarTreeRow\(current, -1\)/);
  assert.match(source, /case "Home":[\s\S]*?focusSidebarTreeRow\(current, "first"\)/);
  assert.match(source, /case "End":[\s\S]*?focusSidebarTreeRow\(current, "last"\)/);
  assert.match(sessionItemSource, /role="treeitem"/);
  assert.match(sessionItemSource, /aria-selected=\{isSelected\}/);
  assert.match(sessionItemSource, /requestDelete: beginDeleteConfirmation/);
  assert.match(sessionItemSource, /rename: startRename/);
});

test("streams running sessions and reconnects after visibility or network changes", () => {
  // One stream for the whole browser, not one per tab: the browser's handful of HTTP/1.1
  // connections per host is what a page load competes with (e2e/offline-navigation.mjs).
  assert.match(source, /openSharedEventStreamHandle<RunningFrame>\(\{\s*url: "\/api\/agent\/running\/events",\s*name: RUNNING_SESSIONS_STREAM_NAME,/);
  assert.doesNotMatch(source, /new EventSource\("\/api\/agent\/running\/events"\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisible\)/);
  assert.match(source, /window\.addEventListener\("online", onOnline\)/);
  assert.match(source, /const onVisible = \(\) => \{\n\s*if \(document\.visibilityState === "visible"\) stream\.reconnect\(\);/);
  assert.match(source, /stream\.stop\(\);/);
  // The frames drive the running set and the cross-window list invalidation, as before.
  assert.match(source, /sseAuthoritativeRef\.current = true;/);
  assert.match(source, /setRunningSessionIds\(new Set\(data\.runningSessionIds \?\? \[\]\)\)/);
  assert.match(source, /await loadSessions\(\);/);
});

test("re-adding an archived project restores it to the list", () => {
  assert.match(source, /const activateProject = useCallback\(\(cwd: string\) => \{\s*restoreProjectRoot\(projectRootFor\(cwd\) \?\? cwd\);/);
  // The add-project dialog is the only picker left in the sidebar.
  assert.match(source, /onSelectCwd=\{\(cwd\) => \{\s+activateProject\(cwd\);/);
});

test("archived projects sit in a folded Archive group and need a restore before a new session", () => {
  // New session in an archived project is refused, never a silent restore.
  assert.match(source, /if \(archivedProjectRoots\.has\(projectRoot\)\) \{\s*appNotify\.info\([^;]*sidebar\.projectArchivedNewSession[\s\S]*?return;/);
  // The archived row has no "+" and opens the restore menu, from "…" or a right-click.
  assert.match(source, /\{!archived && \(\s*<button[\s\S]*?handleNewSession\(group\.projectRoot\)/);
  assert.match(source, /onContextMenu=\{\(e\) => openProjectMenu\(e, group\.projectRoot, archived\)\}/);
  // The menu keeps the project it opened for across the exit (useShownWhileClosing), so
  // the closing panel still names the project whose rows it acted on.
  assert.match(source, /onRestore=\{\(\) => restoreProject\(shownProjectMenu\.root\)\}/);
  // The group sits after the project list and unfolds for a search.
  assert.match(source, /activeProjects\.map\(\(group\) => renderProjectGroup\(group\)\)\)\}\s*\{!projectsSectionFolded && archivedProjects\.length > 0 && \(\s*<ArchivedProjectsSection/);
  assert.match(source, /const archiveShown = archiveExpanded \|\| Boolean\(trimmedSessionQuery\)/);
  // Unfolding an archived project must not select it (that opens a composer there).
  assert.match(source, /if \(archived\) \{\s*setExpandedArchivedProjects\(\(prev\) => toggleId\(prev, group\.projectRoot\)\);\s*return;\s*\}/);
});

test("exposes the polled running-session set to the shell", () => {
  assert.match(source, /onRunningSessionIdsChange\?: \(ids: Set<string>\) => void/);
  assert.match(source, /onRunningSessionIdsChange\?\.\(runningSessionIds\)/);
});

test("exposes the loaded session catalog to the shell", () => {
  assert.match(source, /onSessionsChange\?: \(sessions: SessionInfo\[\]\) => void/);
  assert.match(source, /onSessionsChange\?\.\(allSessions\)/);
});

test("subagent completion stays silent and never becomes unread", () => {
  assert.match(source, /completionNotificationSuppressedSessionIds\?: string\[\]/);
  assert.match(
    source,
    /completedWithNotifications = completedInBackground\.filter\([\s\S]*?!previousSuppressedCompletionSessionIdsRef\.current\.has\(id\)[\s\S]*?!knownSubagentIds\.has\(id\)/,
  );
  assert.match(source, /completedWithNotifications\.forEach\(\(id\) => next\.add\(id\)\)/);
  assert.match(source, /if \(completedWithNotifications\.length > 0\) \{\s*onBackgroundTaskDone\?\.\(\)/);
  assert.match(
    source,
    /filter\(\(session\) => session\.relation\?\.kind !== "subagent"\)[\s\S]*?unreadEligibleIds\.has\(id\)/,
  );
});

test("includes project activity counts in accessible labels", () => {
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.agentRunning"\)\} \(\$\{activity\.running\}\)`\}/,
  );
  assert.match(
    source,
    /aria-label=\{`\$\{t\("sidebar\.newSessionActivity"\)\} \(\$\{activity\.unread\}\)`\}/,
  );
});

test("formats session timestamps with the active locale", () => {
  assert.match(source, /import \{ formatCompactRelativeTime, formatRelativeTime \} from "@\/lib\/i18n\/format"/);
  assert.match(sessionItemSource, /const \{ locale, t \} = useI18n\(\)/);
  assert.match(sessionItemSource, /formatRelativeTime\(session\.modified, locale\)/);
});

test("does not persist an unchanged fallback title ending in whitespace", () => {
  assert.match(
    sessionItemSource,
    /const name = renameValue\.trim\(\);[\s\S]*?if \(renameValue === title \|\| name === \(session\.name \?\? ""\)\) return;/,
  );
});

test("offers the downstream context-menu hook only on a normal session row", () => {
  assert.match(sessionItemSource, /const handleContextMenu[\s\S]*?dispatchSessionRowContextMenu\(\{/);
  assert.match(
    sessionItemSource,
    /onContextMenu=\{confirmDelete \|\| renaming \? undefined : handleContextMenu\}/,
  );
});

test("lifecycle refreshes bypass the cache while cross-window polling reuses it", () => {
  assert.match(source, /function sessionListUrl\(summary: boolean, force: boolean\)/);
  assert.match(source, /if \(summary\) return "\/api\/sessions\?summary=1"/);
  assert.match(source, /if \(force\) return "\/api\/sessions\?force=1"/);
  assert.match(source, /cache: "no-store"/);
  // First paint uses the cheap summary listing, then hydrates after a delay.
  assert.match(source, /loadSessions\(true, false, true\)/);
  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?void loadSessions\(false, true\)/);
  assert.match(source, /data\.sessionListVersion !== sessionListVersionRef\.current[\s\S]*?await loadSessions\(\)/);
  assert.doesNotMatch(source, /sessionRefreshDone|sessionRefreshTimerRef|title=\{t\("sidebar\.refresh"\)\}/);
  assert.match(source, /loadSessions\(false, true\);[\s\S]*?onBackgroundTaskDone/);
});

test("does not expose disk-backed actions for transient sessions", () => {
  assert.match(sessionItemSource, /if \(session\.transient\) return;/);
  assert.match(sessionItemSource, /\{!session\.transient && \(\s*<div\s+className="session-item-trailing"/);
});

test("hides subagent rows and aggregates their state into the main session row", () => {
  assert.match(source, /const sessionFamilies = listSessionFamilies\(projectSessions\)/);
  assert.match(source, /familySessions\.some\(\(session\) => session\.id === selectedSessionId\)/);
  assert.match(source, /familySessions\.some\(\(session\) => runningSessionIds\.has\(session\.id\)\)/);
  assert.doesNotMatch(source, /function SessionTreeItem/);
});

test("Chats sit beside Projects and never enter project grouping", () => {
  assert.match(
    source,
    /const chatSessions = filteredSessions[\s\S]*?session\.workspaceKind === "chat" \|\| isChatCwd\(session\.cwd\)[\s\S]*?const projectSessions = filteredSessions\.filter\(/,
  );
  assert.match(source, /const allChatFamilies = listSessionFamilies\(chatSessions\)/);
  assert.match(source, /const sessionFamilies = listSessionFamilies\(projectSessions\)/);
  assert.match(source, /groupByProject\(projectSessions,/);
  assert.match(source, /getRecentProjects\(allSessions\)/);
  assert.match(source, /sidebar-project-tree-header sidebar-chats-header/);
  assert.match(source, /handleNewSession\(chatWorkspaceCwd \?\? undefined, "chat"\)/);
});

test("Chats show five families at a time even when there are no projects", () => {
  assert.match(source, /const MAX_VISIBLE_CHAT_SESSIONS = 5/);
  assert.match(source, /: chatFamilies\.slice\(0, Math\.max\(MAX_VISIBLE_CHAT_SESSIONS \* \(chatSessionPages \+ 1\), alwaysVisibleChatFamilies\)\)/);
  assert.match(source, /setChatSessionPages\(\(pages\) => pages \+ 1\)/);
  assert.match(source, /!loading && !error && chatFamilies\.length === 0/);
  assert.match(source, /sidebar-chats-empty/);
  // The Chats section renders before the Projects empty state, so it remains
  // available when `activeProjects` is empty.
  assert.match(
    source,
    /sidebar-chats-header[\s\S]*?\{!projectsSectionFolded && \(activeProjects\.length === 0 && !\(trimmedSessionQuery && archivedProjects\.length > 0\) \? \(/,
  );
});

test("Chats fold like a project and unfold back to the first five", () => {
  // Folding drops the extra pages so the next unfold starts at five again.
  assert.match(source, /const setChatsFolded = \(folded: boolean\) => \{\s*writeChatsCollapsed\(folded\);\s*if \(folded\) setChatSessionPages\(0\);/);
  // A search lists every match regardless of the fold.
  assert.match(source, /const chatsFolded = !trimmedSessionQuery && chatsCollapsed/);
  assert.match(source, /\{!chatsFolded && \(\s*<div className="sidebar-project-tree-children sidebar-chats-list">/);
  // The fold and the page count survive a reload.
  assert.match(source, /APP_PREF_KEYS\.collapsedChats/);
  assert.match(source, /APP_PREF_KEYS\.chatSessionPages/);
});

test("Projects section hydrates safely, folds archive, and still works when storage fails", () => {
  assert.match(source, /let projectsSectionCollapsedMemory: boolean \| null = null;/);
  assert.match(source, /if \(projectsSectionCollapsedMemory === null\) \{\s*projectsSectionCollapsedMemory = getPref\(APP_PREF_KEYS\.collapsedProjectsSection\) === "1";\s*\}/);
  assert.match(source, /projectsSectionCollapsedMemory = collapsed;\s*if \(collapsed\) setPref\(/);
  assert.match(source, /const projectsSectionCollapsed = useSyncExternalStore\(\s*subscribeProjectsSectionCollapsed, readProjectsSectionCollapsed, serverProjectsSectionCollapsed/);
  assert.match(source, /const serverProjectsSectionCollapsed = \(\) => false/);
  assert.match(source, /const projectsSectionFolded = !trimmedSessionQuery && projectsSectionCollapsed/);
  assert.match(source, /aria-expanded=\{!projectsSectionFolded\}/);
  assert.match(source, /writeProjectsSectionCollapsed\(!projectsSectionCollapsed\)/);
  assert.match(source, /sidebar-project-tree-count">\(\{activeProjects\.length\}\)/);
  assert.match(source, /!projectsSectionFolded && archivedProjects\.length > 0 &&/);
  assert.match(source, /onToggle=\{\(\) => setArchiveExpanded\(!archiveExpanded\)\}/);
});

test("the Chats fold hydrates with the server value before reading localStorage", () => {
  // Reading the pref in a useState initializer rendered the header collapsed on
  // the client but expanded on the server, a hydration mismatch.
  assert.doesNotMatch(source, /useState\(\(\) => getPref\(APP_PREF_KEYS\.collapsedChats\)/);
  assert.match(source, /const chatsCollapsed = useSyncExternalStore\(subscribeChatsCollapsed, readChatsCollapsed, serverChatsCollapsed\)/);
  assert.match(source, /const serverChatsCollapsed = \(\) => false;/);
  // The pref is written by the setter, never by an effect that could store the
  // server value over the saved one on the first commit.
  assert.doesNotMatch(source, /if \(chatsCollapsed\) setPref\(APP_PREF_KEYS\.collapsedChats/);
});

test("the Chats header shows its menu and add buttons only on hover, like Projects", () => {
  const header = source.slice(
    source.indexOf("sidebar-project-tree-header sidebar-chats-header"),
    source.indexOf("{!chatsFolded && ("),
  );
  // Same hover-revealed tools container the Projects header uses.
  assert.match(header, /className="sidebar-project-tree-tools"/);
  assert.match(header, /sidebar-project-tree-menu/);
  assert.match(header, /sidebar-project-tree-add/);
  assert.match(header, /handleNewSession\(chatWorkspaceCwd \?\? undefined, "chat"\)/);
  assert.doesNotMatch(source, /sidebar-chats-add/);
});

test("chats can be pinned and archived, ordered by recency with no date groups", () => {
  // Pinned first, then the running chats, then recency.
  assert.match(source, /orderChatFamilies\(allChatFamilies, pinnedChats, runningSessionIds\)/);
  assert.match(source, /trimmedSessionQuery\s*\? orderedChatFamilies\s*: orderedChatFamilies\.filter\(\(family\) => !archivedChats\.has\(family\.root\.id\)\)/);
  // Rows already show their own relative time, so the list has no Today / This week headings.
  assert.doesNotMatch(source, /sidebar-chats-group-label|chatsToday|CHAT_GROUP_LABEL_KEYS/);
  // The +5 paging still runs over the whole order, and the window never drops a
  // pinned or running chat.
  assert.match(source, /: chatFamilies\.slice\(0, Math\.max\(MAX_VISIBLE_CHAT_SESSIONS \* \(chatSessionPages \+ 1\), alwaysVisibleChatFamilies\)\)/);
  assert.match(
    source,
    /const alwaysVisibleChatFamilies = chatFamilies\.filter\(\(family\) => \(\s*pinnedChats\.has\(family\.root\.id\) \|\| familyHasRunningSession\(family, runningSessionIds\)\s*\)\)\.length;/,
  );
  // Archived chats stay reachable and recoverable.
  assert.match(source, /sidebar\.showArchivedChats/);
  assert.match(source, /APP_PREF_KEYS\.archivedChats/);
  // A chat pin is the server's, like every other pin: no localStorage behind it.
  assert.match(source, /const pinnedChats = pins\.pinnedIds;/);
  assert.match(source, /pinned: pinnedChats\.has\(id\),\s*archived: archivedChats\.has\(id\),\s*onTogglePin: \(\) => \{ void pins\.toggleSessionPin\(id\); \},/);
  // Row menu: only chat rows (depth 0) get the actions, in both the native and DOM menus.
  assert.match(source, /chatActions=\{depth === 0 \? chatActions : undefined\}/);
  // The pin is generic: chats always pass one, project sessions too (S2).
  assert.match(source, /t\(pin\.pinned \? "sidebar\.unpinChat" : "sidebar\.pinChat"\)/);
  // Archive is shared with project sessions: chats bring it with their actions.
  assert.match(source, /const archive: SessionArchiveActions \| undefined = chatActions \?\? archiveActions;/);
  assert.match(source, /t\(archive\.archived \? "sidebar\.unarchiveChat" : "sidebar\.archiveChat"\)/);
});

test("project sessions can be archived one by one (#200)", () => {
  assert.match(source, /APP_PREF_KEYS\.archivedSessions/);
  // Only top-level rows get the action, in the project tree and the chronological view.
  assert.match(source, /archiveActions=\{depth === 0 \? archiveActions : undefined\}/);
  assert.match(source, /archiveActions=\{sessionArchiveActions\(node\.session\.id\)\}/);
  assert.match(source, /archiveActions=\{sessionArchiveActions\(family\.root\.id\)\}/);
  // Archived roots leave the list for a per-project fold; a search lists them in place.
  assert.match(source, /const archivedGroupTree = trimmedSessionQuery\s*\? \[\]\s*: fullGroupTree\.filter\(\(node\) => archivedSessions\.has\(node\.session\.id\)\)/);
  assert.match(source, /trimmedSessionQuery \|\| !archivedSessions\.has\(family\.root\.id\)/);
  assert.match(source, /setProjectsShowingArchived\(\(current\) => toggleId\(current, group\.projectRoot\)\)/);
});

test("a chat's row menu can continue it in a project", () => {
  // Chats only: project rows and subagent children are never given the callback.
  assert.match(source, /onContinueInProject=\{setContinueChat\}/);
  assert.match(source, /onContinueInProject=\{depth === 0 \? onContinueInProject : undefined\}/);
  assert.match(source, /t\("sidebar\.continueInProject"\)/);
  assert.match(source, /\/continue-in-project`/);
  // The picker reuses the project picker and never offers the chat workspace itself.
  assert.match(source, /\{continueChat && \(/);
});

test("a chat cwd skips worktree lookup and stays out of project pickers", () => {
  assert.match(source, /if \(!selectedCwd \|\| selectedCwdIsChat\) \{\s*setWorktreeState\(null\)/);
  assert.match(source, /const selectedProjectRoot = selectedProjectObject\?\.kind === "project"/);
  assert.match(source, /selectedCwd=\{selectedCwdProp && !isChatCwd\(selectedCwdProp\) \? selectedCwdProp : null\}/);
  assert.match(source, /if \(isChatCwd\(cwd\)\) return projectSelection\(cwd, cwd, "chat"\)/);
});

test("the project context menu reveals the project in the OS file manager", async () => {
  // Upstream's open-in-file-manager (#907) reaches the fork through the
  // project context menu: the desktop shell reveals natively and the browser
  // goes through /api/open-in-explorer, which the menu only offers after the
  // availability probe answered. A failure stays visible inside the menu.
  assert.match(source, /const revealProjectInFileManager = useCallback/);
  assert.match(source, /isTauriDesktop\(\) \|\| fileManagerAvailability\?\.supported/);
  assert.match(source, /revealItemInDirNative\(root\)/);
  assert.match(source, /fetch\("\/api\/open-in-explorer", \{\s*method: "POST"/);
  assert.match(source, /FILE_MANAGER_ERROR_KEYS\[data\.error \?\? ""\]/);
  // The menu itself is fork-owned (components/ProjectContextMenu.tsx).
  const menuSource = await readFile(new URL("./ProjectContextMenu.tsx", import.meta.url), "utf8");
  assert.match(menuSource, /\{projectRevealError && \(/);
  // The platform-adaptive label (Finder / Explorer / generic).
  assert.match(source, /"sidebar\.openInFinder"/);
  assert.match(source, /"sidebar\.openInExplorer"/);
  assert.match(source, /"sidebar\.openInFileManager"/);
});

test("session rows swap a compact time for the action button in one fixed-width slot", () => {
  // At rest the row shows its last-activity time; hover, keyboard focus,
  // touch and an open menu show the "…" button in the same slot so the title
  // never reflows.
  assert.match(sessionItemSource, /className="session-item-trailing"/);
  assert.match(sessionItemSource, /hovered \|\| treeFocused \|\| touchMode \|\| menuOpen \?/);
  assert.match(sessionItemSource, /formatCompactRelativeTime\(session\.modified, locale\)/);
  // Transient runtime rows have neither actions nor a reliable time.
  assert.match(sessionItemSource, /\{!session\.transient && \(\s*<div\s+className="session-item-trailing"/);
});

test("project header always shows its session count and running/unread chips", () => {
  // Folded, the header is the only place the numbers show; open, it is the only
  // place the running and unread totals show — so both states keep them.
  assert.match(source, /<span className="sidebar-project-tree-count" title=\{t\("sidebar\.sessionCount", \{ count: groupTree\.length \}\)\}>\s*\(\{groupTree\.length\}\)/);
  assert.match(source, /<span className="sidebar-project-tree-meta">\s*\{runningCount > 0 && \(/);
  // The chips are no longer gated on the fold.
  assert.doesNotMatch(source, /\{isCollapsed && \(\s*<span className="sidebar-project-tree-count"/);
  assert.doesNotMatch(source, /\{isCollapsed && \(\s*<span className="sidebar-project-tree-meta"/);
  // The rendered path replaces the native tooltip; the accessible label keeps the branch.
  assert.doesNotMatch(source, /className="sidebar-project-tree-branch"/);
  assert.match(source, /const rowTitle = branchSubtitle \? `\$\{group\.projectRoot\} · \$\{branchSubtitle\}` : group\.projectRoot/);
  // A pinned project has no glyph in its row, so the state rides in the label.
  assert.match(source, /aria-label=\{`\$\{displayName\}\$\{pinned \? ` · \$\{t\("sidebar\.pinnedProject"\)\}` : ""\} · \$\{rowTitle\}`\}/);
  assert.doesNotMatch(source, /title=\{rowTitle\}/);
});

test("project header keeps its actions hover-only and no separate chevron", async () => {
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  // The folder glyph already shows open / closed; a chevron would repeat it.
  assert.doesNotMatch(source, /sidebar-project-tree-chevron/);
  assert.match(source, /aria-expanded=\{!isCollapsed\}/);
  assert.match(css, /\.sidebar-project-tree-row-actions \{[^}]*opacity: 0;[^}]*pointer-events: none;/);
  assert.match(css, /\.sidebar-project-tree-row\.is-menu-open \.sidebar-project-tree-row-actions/);
  assert.match(css, /@media \(hover: none\) \{[^@]*\.sidebar-project-tree-row-actions \{\s*opacity: 1;/);
});

test("Projects header actions stay hover-only", async () => {
  const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
  assert.match(css, /\.sidebar-project-tree-tools \{[^}]*opacity: 0;[^}]*pointer-events: none;/);
  assert.match(css, /\.sidebar-project-tree-header:hover \.sidebar-project-tree-tools,/);
  assert.match(css, /\.sidebar-project-tree-header\.is-menu-open \.sidebar-project-tree-tools,/);
  assert.match(css, /\.sidebar-project-tree-header:focus-within \.sidebar-project-tree-tools \{\s*opacity: 1;\s*pointer-events: auto;/);
  assert.match(css, /@media \(hover: none\) \{[^@]*\.sidebar-project-tree-tools \{\s*opacity: 1;\s*pointer-events: auto;/);
});

test("folded projects persist across reloads", () => {
  assert.match(source, /getPrefJson<unknown>\(APP_PREF_KEYS\.collapsedProjects\)/);
  assert.match(source, /setPrefJson\(APP_PREF_KEYS\.collapsedProjects, \[\.\.\.collapsedProjects\]\)/);
  // Collapse/expand-all operate on the visible project groups.
  assert.match(source, /const canCollapseAllProjects = activeProjects\.some\(\(group\) => !collapsedProjects\.has\(group\.projectRoot\)\)/);
  assert.match(source, /const canExpandAllProjects = activeProjects\.some\(\(group\) => collapsedProjects\.has\(group\.projectRoot\)\)/);
  assert.match(source, /setCollapsedProjects\(new Set\(activeProjectRoots\)\)/);
  assert.match(source, /setCollapsedProjects\(new Set\(\)\)/);
});

test("show more reveals five sessions at a time and a project toggle resets it", () => {
  assert.match(source, /getPrefJson<unknown>\(APP_PREF_KEYS\.expandedProjects\)/);
  assert.match(source, /setPrefJson\(APP_PREF_KEYS\.expandedProjects, projectSessionPages\)/);
  // The page grows by five, and never shrinks below the pinned + running rows.
  assert.match(
    source,
    /const visibleSessionLimit = Math\.max\(MAX_VISIBLE_PROJECT_SESSIONS \* \(extraPages \+ 1\), alwaysVisibleRoots\);/,
  );
  assert.match(
    source,
    /\[group\.projectRoot\]: \(prev\[group\.projectRoot\] \?\? 0\) \+ 1/,
  );
  assert.match(
    source,
    /count: Math\.min\(MAX_VISIBLE_PROJECT_SESSIONS, hiddenSessionCount\)/,
  );
  // Reopening a project starts from its latest five sessions again.
  assert.match(source, /setProjectSessionPages\(\(prev\) => \{[\s\S]*?delete next\[group\.projectRoot\]/);
  // Legacy arrays meant "expanded everything"; migrate them to one extra page.
  assert.match(source, /Array\.isArray\(stored\)[\s\S]*?\.map\(\(root\) => \[root, 1\]\)/);
});

test("an open project leads with its pinned rows, then every running one", () => {
  // The preview window never buries what is live: pins, then the running families,
  // then recency — and it widens past the five rows so all of them fit.
  assert.match(source, /const rowIsPinned = \(node: SessionTreeNode\) => pinnedSessions\.has\(node\.session\.id\);/);
  assert.match(source, /const rowIsRunning = \(node: SessionTreeNode\) => treeHasRunningSession\(node, group\.runningIds\);/);
  assert.match(source, /const groupTree = pinnedThenRunning\(unarchivedGroupTree, rowIsPinned, rowIsRunning\);/);
  assert.match(source, /const alwaysVisibleRoots = unarchivedGroupTree\.filter\(\(node\) => rowIsPinned\(node\) \|\| rowIsRunning\(node\)\)\.length;/);
  assert.match(
    source,
    /const visibleSessionLimit = Math\.max\(MAX_VISIBLE_PROJECT_SESSIONS \* \(extraPages \+ 1\), alwaysVisibleRoots\);/,
  );
  // A running family is the family's live work: the row's own session, or any run
  // nested under it (a subagent is only reachable through its parent's row).
  assert.match(source, /treeHasRunningSession/);
  // The header carries the running / unread chips in both fold states.
  assert.match(source, /<span className="sidebar-project-tree-meta">/);
});

test("Projects pane chooses between grouped and chronological views", () => {
  // The old Recent section is replaced by a persisted display mode.
  assert.doesNotMatch(source, /recent-sessions|sidebar-recent-section|hasTodaySessions|recentSessions/);
  assert.match(source, /const \[projectViewMode, setProjectViewMode\] = useState<ProjectViewMode>\(loadProjectViewMode\)/);
  assert.match(source, /setPref\(APP_PREF_KEYS\.projectViewMode, mode\)/);
  assert.match(
    source,
    /projectViewMode === "timeline"\s*\? renderTimeline\(\)\s*: activeProjects\.map\(\(group\) => renderProjectGroup\(group\)\)/,
  );
});

test("the chronological view lists session families by activity with project labels", () => {
  assert.match(source, /const timelineFamilies = projectViewMode === "timeline"/);
  assert.match(source, /sessionFamilies\.filter\(\(family\) =>/);
  assert.match(source, /\.sort\(\(a, b\) => b\.root\.modified\.localeCompare\(a\.root\.modified\)\)/);
  assert.match(source, /buildSessionTree\(\[family\.root, \.\.\.family\.subagents\]\)/);
  assert.match(source, /className="sidebar-project-timeline"/);
  assert.match(source, /subtitle=\{projectName\}/);
});

test("the Projects menu keeps grouped/timeline choices and collapse controls", async () => {
  const menuSource = await readFile(new URL("./ProjectViewMenu.tsx", import.meta.url), "utf8");
  assert.match(menuSource, /role="menuitemradio"/);
  assert.match(menuSource, /sidebar\.projectViewGrouped/);
  assert.match(menuSource, /sidebar\.projectViewTimeline/);
  assert.match(menuSource, /sidebar\.collapseAllProjects/);
  assert.match(menuSource, /sidebar\.expandAllProjects/);
  assert.match(source, /canUseNativeMenu\(\)[\s\S]*?showNativeMenu\(entries, menuPointBelow\(anchor, "right"\)\)/);
});

test("the row menu shows the compaction count only when the session was compacted", () => {
  assert.match(
    sessionItemSource,
    /\{\(session\.compactionCount \?\? 0\) > 0 && \(\s*<div>\{t\("sidebar\.compactionCount", \{ count: session\.compactionCount \?\? 0 \}\)\}<\/div>/,
  );
});

test("a project's sessions are pinned through the server's state, not this browser (S2)", async () => {
  // A pin is pi-web's state in <agentDir>/pi-web-session-state.json, so a
  // session pinned in Safari is pinned in Edge, on the phone, and in the
  // desktop shell too. Nothing of the sidebar's pins lives in localStorage.
  assert.match(source, /import \{ useSidebarPins \} from "@\/hooks\/useSidebarPins";/);
  assert.match(source, /const pins = useSidebarPins\(reportPinFailure\);/);
  assert.match(source, /const pinnedSessions = pins\.pinnedIds;/);
  assert.doesNotMatch(source, /APP_PREF_KEYS\.pinned/);
  assert.doesNotMatch(source, /setPinnedSessions|setPinnedChats|setPinnedProjects/);
  assert.match(source, /pinned: pinnedSessions\.has\(id\),\s*onTogglePin: \(\) => \{ void pins\.toggleSessionPin\(id\); \},/);
  assert.match(
    source,
    /const groupTree = pinnedThenRunning\(unarchivedGroupTree, rowIsPinned, rowIsRunning\);/,
  );
  // A running family (its own session, or a run nested under it) leads the list
  // under the pins, and the preview window keeps all of them visible.
  assert.match(source, /const rowIsRunning = \(node: SessionTreeNode\) => treeHasRunningSession\(node, group\.runningIds\);/);
  assert.match(source, /const alwaysVisibleRoots = unarchivedGroupTree\.filter\(\(node\) => rowIsPinned\(node\) \|\| rowIsRunning\(node\)\)\.length;/);
  assert.match(
    source,
    /const visibleSessionLimit = Math\.max\(MAX_VISIBLE_PROJECT_SESSIONS \* \(extraPages \+ 1\), alwaysVisibleRoots\);/,
  );
  // A pin made in another window arrives: the running frames carry the state's
  // revision, and the sidebar hands it to the hook.
  assert.match(source, /noteRevision\(data\.sessionUiStateRevision\);/);
  assert.match(source, /\}, \[loadSessions, noteRevision\]\);/);
  // The server refused a pin: the user hears it in their own language.
  assert.match(source, /appNotify\.error\(\{ message: t\("sidebar\.uiStateFailed", \{ error: message \}\) \}\);/);
  // The native menu and the DOM menu both offer it. The row marks a pin by
  // its title's ink: a session row has no pin glyph of its own, and the
  // state stays in the title's tooltip.
  assert.match(source, /\.\.\.\(pin\s*\? \[\{ label: t\(pin\.pinned \? "sidebar\.unpinChat" : "sidebar\.pinChat"\), onSelect: pin\.onTogglePin \}\]/);
  assert.match(source, /className=\{`session-item-title\$\{pin\?\.pinned \|\| pinnedInk \? " is-pinned" : ""\}`\}/);
  assert.match(source, /pin\?\.pinned \? t\("sidebar\.pinned"\) : null/);
  assert.doesNotMatch(source, /session-item-pin/);
  const theme = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  // A pinned title keeps the row's full-contrast ink (its inline var(--text)) and
  // gains one weight notch; the unpinned ones step back a quarter tone. No pin
  // yellow on a session title: that hue belongs to a pinned project's folder icon.
  assert.match(theme, /\.session-item-title:not\(\.is-pinned\) \{\s*color: color-mix\(in srgb, var\(--text\) 76%, transparent\) !important;/);
  assert.match(theme, /\.session-item-title\.is-pinned \{\s*font-weight: var\(--fw-medium\) !important;\s*\}/);
  assert.doesNotMatch(theme, /\.session-item-title[^{]*\{[^}]*#cdc12c/);
  assert.doesNotMatch(theme, /\.session-item-pin \{/);
});

test("a subagent run's row wears its parent's pin — title, glyph and weight together", async () => {
  // The rows nested under a session (its delegated runs, its side chats) are its
  // work, not rows of their own, so the family's pin is theirs:
  //  - pinned parent: every nested row reads at the parent's ink, so a pinned
  //    family is one block and not one bright row over two faint ones;
  //  - unpinned parent: they step back a step FURTHER than a plain row, and
  //    their leading glyph (the robot / the side-chat bubble) takes that same
  //    ink — in this theme --accent IS --text, so an accent glyph was the
  //    hardest thing on a stepped-back row.
  // `pinnedInk` starts at the pinned set of the family's root and is inherited
  // down the tree, so a run under a run follows the same ink.
  assert.match(source, /className=\{`session-item\$\{isSelected \? " is-selected" : ""\}\$\{isRunning \? " is-running" : ""\}\$\{isUnread \? " is-unread" : ""\}\$\{isSubagentChild \? " is-subagent-child" : ""\}\$\{isSideChat \? " is-side-chat" : ""\}\$\{pinnedInk \? " is-pinned" : ""\}`\}/);
  assert.match(source, /pinnedInk=\{pinnedInk\}/, "the tree hands the family's ink to every row below");
  assert.match(source, /pinnedInk=\{pinnedChats\.has\(id\)\}/, "the chats list starts it from the pinned set");
  assert.match(source, /pinnedInk=\{pinnedSessions\.has\(node\.session\.id\)\}/, "the project tree does too");
  assert.match(source, /pinnedInk=\{pinnedSessions\.has\(family\.root\.id\)\}/, "and the chronological view");
  // The child glyphs are drawn in currentColor, never in the theme's accent.
  const glyphs = sessionItemSource.slice(sessionItemSource.indexOf("isSideChat ? ("), sessionItemSource.indexOf("isFork && ("));
  assert.match(glyphs, /<SideChatPlusIcon size=\{12\} stroke="currentColor" className="session-item-child-glyph"/);
  assert.match(glyphs, /className="session-item-child-glyph"[\s\S]*?stroke="currentColor"/);
  assert.doesNotMatch(glyphs, /stroke="var\(--accent\)"/);
  const theme = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  // One --child-ink carries the row: 64% unpinned (a step past the plain 76%),
  // full var(--text) under a pinned parent.
  assert.match(theme, /\.session-item\.is-subagent-child,\s*\.session-item\.is-side-chat \{\s*--child-ink: color-mix\(in srgb, var\(--text\) 64%, transparent\);\s*\}/);
  assert.match(theme, /\.session-item\.is-subagent-child\.is-pinned,\s*\.session-item\.is-side-chat\.is-pinned \{\s*--child-ink: var\(--text\);\s*\}/);
  // Both rules are three classes deep, so they outrank `.session-item-title:not(.is-pinned)`.
  assert.match(theme, /\.session-item\.is-subagent-child \.session-item-title,\s*\.session-item\.is-side-chat \.session-item-title \{\s*color: var\(--child-ink\) !important;/);
  assert.match(theme, /\.session-item\.is-subagent-child \.session-item-child-glyph,\s*\.session-item\.is-side-chat \.session-item-child-glyph \{\s*color: var\(--child-ink\);\s*\}/);
});

test("projects can be pinned above the others from both project menus (S2)", async () => {
  assert.match(source, /const pinnedProjects = pins\.pinnedProjectRoots;/);
  assert.match(source, /void pins\.toggleProjectPin\(root\);/);
  assert.match(source, /onSelect: \(\) => \{ void pins\.toggleProjectPin\(projectRoot\); \} \},/);
  assert.match(source, /const activeProjects = pinnedFirst\(\s*allProjects\.filter\(\(group\) => !archivedProjectRoots\.has\(group\.projectRoot\)\),\s*\(group\) => pinnedProjects\.has\(group\.projectRoot\),\s*\);/);
  const nativeMenu = source.slice(source.indexOf("const showNativeProjectMenu = useCallback"));
  assert.match(nativeMenu.slice(0, 4000), /sidebar\.unpinProject" : "sidebar\.pinProject"/);
  assert.match(source, /pinned=\{pinnedProjects\.has\(shownProjectMenu\.root\)\}/);
  const menu = (await readFile(new URL("./ProjectContextMenu.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(menu, /t\(pinned \? "sidebar\.unpinProject" : "sidebar\.pinProject"\)/);
});

test("a project's sessions can all be deleted, keeping the running ones (S6)", async () => {
  const helper = source.slice(source.indexOf("const projectSessionsToDelete = useCallback"), source.indexOf("const restoreProject = useCallback"));
  // Subagent runs go with their parent; scheduled runs and chats are not the project's list.
  assert.match(helper, /session\.relation\?\.kind === "subagent" \|\| session\.relation\?\.kind === "scheduled"/);
  assert.match(helper, /if \(runningSessionIds\.has\(session\.id\)\) kept \+= 1;\s*else ids\.push\(session\.id\);/);
  // One by one through the session delete route, then the list reloads.
  assert.match(helper, /for \(const id of target\.ids\)[\s\S]*?fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(id\)\}`, \{ method: "DELETE" \}\)/);
  assert.match(helper, /void loadSessions\(\);/);
  // A confirmation first, naming the running sessions it keeps.
  assert.match(source, /title=\{t\("sidebar\.deleteProjectSessionsHeading", \{ name: projectSessionsDelete\.name \}\)\}/);
  assert.match(source, /t\("sidebar\.deleteProjectSessionsRunning", \{ count: projectSessionsDelete\.kept \}\)/);
  const nativeMenu = source.slice(source.indexOf("const showNativeProjectMenu = useCallback"));
  assert.match(nativeMenu.slice(0, 4000), /onSelect: \(\) => requestProjectSessionsDelete\(projectRoot\)/);
  assert.match(source, /deleteSessionsCount=\{projectSessionsToDelete\(shownProjectMenu\.root\)\.ids\.length\}/);
});

test("a project session's row menus offer Fork, which opens the copy (S4)", () => {
  const fork = source.slice(source.indexOf("const forkSession = useCallback"), source.indexOf("const restoreProject = useCallback"));
  assert.match(fork, /fetch\(`\/api\/sessions\/\$\{encodeURIComponent\(source\.id\)\}\/fork`, \{\s*method: "POST",/);
  assert.match(fork, /forkFailureMessage\(data\.code, /);
  assert.match(fork, /handleSelectSessionFromList\(forked\);/);
  // Project rows only (chats own a folder), and only a family's top row.
  assert.equal((source.match(/onFork=\{forkSession\}/g) ?? []).length, 3);
  assert.match(source, /onFork=\{depth === 0 \? onFork : undefined\}/);
  assert.match(sessionItemSource, /\.\.\.\(onFork \? \[\{ label: t\("sidebar\.fork"\), onSelect: \(\) => onFork\(session\) \}\] : \[\]\),/);
  assert.match(sessionItemSource, /onClick=\{\(\) => \{ setMenuOpen\(false\); onFork\(session\); \}\}/);
});

test("a side chat row carries the composer's side-chat glyph", () => {
  // The row is labelled "Side chat 2" by the server's title; the glyph that says
  // "this run hangs off the session above" is the composer's own side-chat mark.
  assert.match(source, /isSideChat=\{node\.session\.relation\?\.kind === "side"\}/,
    "the row knows it is a side chat");
  const icons = sessionItemSource.slice(
    sessionItemSource.indexOf("{isRunning ? ("),
    sessionItemSource.indexOf(") : isFork ? (") > -1 ? sessionItemSource.indexOf(") : isFork ? (") : sessionItemSource.indexOf("{title}</span>"),
  );
  assert.ok(icons.includes(") : isSideChat ? ("), "the side-chat case is in the leading-icon chain");
  assert.ok(icons.indexOf("isSideChat ? (") < icons.indexOf("isSubagentChild ? ("),
    "a side chat is read before the subagent glyph, not as a fallback bubble");
  assert.match(icons, /isSideChat \? \(\s*<SideChatPlusIcon size=\{12\} stroke="currentColor" className="session-item-child-glyph"/,
    "the app's shared side-chat bubble, at row size, in the row's own ink (--child-ink: the family's pin) — never in the theme's accent, which on a stepped-back row is the brightest thing in it");
  assert.match(source, /import \{ SideChatPlusIcon \} from "\.\/SideChatIcon";/,
    "drawn by the shared glyph, not by a copy in this file");
  // The glyph is decoration; the row's tip and label carry the words.
  assert.match(sessionItemSource, /isSideChat \? t\("sideChat\.title"\) : null,/,
    "the row's tip says which row is a side chat");
});

test("a sidebar menu is not closed by a scroll that leaves its button where it is", () => {
  // On a running session page the chat pane scrolls itself on every streamed chunk. The
  // menus' window-wide capture listener heard that scroll and shut the Projects "..."
  // menu about a second after every open, and the Chats menu and a row's menu with it.
  for (const [trigger, label] of [
    ["projectViewMenuButtonRef", "the Projects header's menu"],
    ["chatsMenuButtonRef", "the Chats header's menu"],
    ["menuButtonRef", "a session row's menu"],
  ]) {
    assert.match(source, new RegExp(`scrollMovesAnchor\\([a-z]+\\.target, ${trigger}\\.current\\)`),
      `${label} keeps its menu open for a foreign scroll`);
  }
  assert.doesNotMatch(source, /addEventListener\("scroll", (close|closeOnViewportChange|onScrollOrResize), true\)/,
    "no menu listens to every scroll in the window any more");
});
