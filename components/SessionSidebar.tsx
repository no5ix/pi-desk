"use client";

import { Fragment, useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { SessionInfo, SessionWorkspaceKind } from "@/lib/types";
import { listSessionFamilies, sideChatTitle } from "@/lib/session-family";
import {
  buildSessionTree,
  countRunningSubagentRuns,
  countTreeDescendants,
  sessionRowTitle,
  treeContainsSession,
  treeHasRunningSession,
  treeHasUnreadSession,
  type SessionTreeNode,
} from "@/lib/sidebar-session-nodes";
import {
  readExpandedSubagentRows,
  serverExpandedSubagentRows,
  setSubagentRowExpanded,
  subscribeExpandedSubagentRows,
} from "@/lib/sidebar-subagent-expansion";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { openSharedEventStreamHandle } from "@/lib/scheduled-tasks/shared-stream";
import { RUNNING_SESSIONS_STREAM_NAME } from "@/lib/running-sessions-stream";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import { useSidebarPins } from "@/hooks/useSidebarPins";
import { useI18n } from "@/hooks/useI18n";
import { formatCompactRelativeTime, formatRelativeTime } from "@/lib/i18n/format";
import { createPortal } from "react-dom";
import { ProjectPicker, selectProjectDirectoryNative } from "./ProjectPicker";
import { DirectoryPicker } from "./DirectoryPicker";
import { chooseProjectDirectory } from "@/lib/project-directory-pick";
import { ProjectContextMenu, type WorktreeEntry } from "./ProjectContextMenu";
import { getRecentProjects, PathLabel } from "./path-ui";
import { APP_PREF_KEYS, getPref, getPrefJson, removePref, setPref, setPrefJson } from "@/lib/app-prefs";
import { groupByProject } from "@/lib/project-group";
import { getProjectDisplayName, getProjectDisplayNames } from "@/lib/project-display";
import { notifyDesktop } from "@/lib/desktop-notify";
import { revealItemInDirNative } from "@/lib/desktop-native";
import { isTauriDesktop } from "@/lib/desktop-updater";
import {
  canUseNativeMenu,
  menuPointBelow,
  showNativeMenu,
  type NativeMenuEntry,
  type NativeMenuPoint,
} from "@/lib/desktop-menu";
import { getDesktopPlatform, type DesktopPlatform } from "@/lib/desktop-window";
import { useWindowDrag } from "./desktop";
import { ChatConfirmDialog } from "./ChatConfirmDialog";
import { SessionSearch } from "./SessionSearch";
import { ProjectViewMenu, type ProjectViewMode } from "./ProjectViewMenu";
import { applySidebarFold, useProjectFold } from "@/lib/sidebar-fold-motion";
import { ChatsSectionMenu } from "./ChatsSectionMenu";
import {
  orderChatFamilies,
  toggleId,
  pinnedFirst,
  previewOrder,
  previewRowIsAlwaysVisible,
  chatFamilyPredicates,
  familyHasRunningSession,
  familyHasUnreadSession,
  type PreviewPredicates,
} from "@/lib/chat-groups";
import { ArchivedProjectsSection } from "./ArchivedProjectsSection";
import { ScheduledSidebarRow } from "./scheduled/ScheduledSidebarRow";
import { ArtifactsSidebarRow } from "./artifacts/ArtifactsSidebarRow";
import { TasksSidebarRow } from "./tasks/TasksSidebarRow";
import { isScheduledRunSession } from "@/hooks/useScheduledTasks";
import { prefetchSessionData } from "@/lib/session-data-cache";
import { isImeComposing } from "@/lib/ime";
import { appNotify } from "@/lib/notification-store";
import { shortenPath } from "@/lib/display-path";
import { forkFailureMessage } from "@/lib/session-fork-client";
import {
  archiveProjectRoot,
  restoreProjectRoot,
  setArchiveExpanded,
  useArchiveExpanded,
  useArchivedProjects,
} from "@/lib/archived-projects";
import { useMenuPlacement } from "@/hooks/useMenuPlacement";
import { usePopTransition, useShownWhileClosing } from "@/hooks/usePopTransition";
import { SideChatPlusIcon } from "./SideChatIcon";
import { scrollMovesAnchor, type MenuAnchor } from "@/lib/menu-placement";

function sessionListUrl(summary: boolean, force: boolean): string {
  if (summary) return "/api/sessions?summary=1";
  if (force) return "/api/sessions?force=1";
  return "/api/sessions";
}
interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => void;
  onNewSession?: (sessionId: string, cwd: string, workspaceKind?: SessionWorkspaceKind) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
    workspaceKind?: SessionWorkspaceKind,
  ) => void;
  onChatWorkspaceCwdChange?: (cwd: string | null) => void;
  onOpenTerminal?: (cwd: string) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
  onProjectsChange?: (projectRoots: string[]) => void;
  headerControls?: ReactNode;
  /** Opens the Scheduled page; the row under New Session is absent without it. */
  onOpenScheduled?: () => void;
  scheduledOpen?: boolean;
  /** Opens the Artifacts page; the row under Scheduled is absent without it. */
  onOpenArtifacts?: () => void;
  artifactsOpen?: boolean;
  onOpenTasks?: () => void;
  tasksOpen?: boolean;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
  kind: SessionWorkspaceKind;
}

// Server error codes with a translation; any other code is shown verbatim.
const FILE_MANAGER_ERROR_KEYS: Record<string, string> = {
  remote: "sidebar.openInExplorerRemoteOnly",
  "unsupported-platform": "sidebar.openInExplorerUnsupported",
};

const SESSION_DETAILS_HYDRATION_DELAY_MS = 750;

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  const parsed = getPrefJson<unknown>(APP_PREF_KEYS.unreadSessionIds);
  if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
  return new Set();
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  if (ids.size === 0) removePref(APP_PREF_KEYS.unreadSessionIds);
  else setPrefJson(APP_PREF_KEYS.unreadSessionIds, [...ids]);
}

function loadProjectViewMode(): ProjectViewMode {
  return getPref(APP_PREF_KEYS.projectViewMode) === "timeline" ? "timeline" : "grouped";
}




const MAX_VISIBLE_PROJECT_SESSIONS = 5;
const MAX_VISIBLE_CHAT_SESSIONS = 5;

const SESSION_LIST_ITEM_HEIGHT = 54;

function focusSidebarTreeRow(current: HTMLElement, offset: number | "first" | "last") {
  const rows = Array.from(
    current.closest(".sidebar-project-tree")?.querySelectorAll<HTMLElement>("[data-sidebar-tree-row]") ?? [],
  )
    // A closing fold keeps its rows mounted for one animation length, and the row walk
    // must never land on a row that is on its way out.
    .filter((row) => !row.closest("[data-fold=\"closing\"]"));
  if (rows.length === 0) return;
  const index = rows.indexOf(current);
  const next = offset === "first" || index < 0
    ? rows[0]
    : offset === "last"
      ? rows[rows.length - 1]
      : rows[Math.max(0, Math.min(rows.length - 1, index + offset))];
  next.focus();
}

function handleSidebarTreeKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  handlers: {
    activate?: () => void;
    expand?: () => void;
    collapse?: () => void;
    rename?: () => void;
    requestDelete?: () => void;
  },
) {
  if (event.target !== event.currentTarget || isImeComposing(event)) return;
  const current = event.currentTarget;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusSidebarTreeRow(current, 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      focusSidebarTreeRow(current, -1);
      break;
    case "Home":
      event.preventDefault();
      focusSidebarTreeRow(current, "first");
      break;
    case "End":
      event.preventDefault();
      focusSidebarTreeRow(current, "last");
      break;
    case "ArrowRight":
      event.preventDefault();
      handlers.expand?.();
      break;
    case "ArrowLeft":
      event.preventDefault();
      handlers.collapse?.();
      break;
    case "Enter":
    case " ":
      event.preventDefault();
      handlers.activate?.();
      break;
    case "F2":
      event.preventDefault();
      handlers.rename?.();
      break;
    case "Delete":
      event.preventDefault();
      handlers.requestDelete?.();
      break;
  }
}

// The Chats fold lives in localStorage, which the server cannot read. Reading it
// in a useState initializer made the first client render differ from the
// server HTML (hydration error on the Chats header); useSyncExternalStore
// hydrates with the server value and then switches to the stored one.
const chatsCollapsedListeners = new Set<() => void>();
function subscribeChatsCollapsed(cb: () => void): () => void {
  chatsCollapsedListeners.add(cb);
  return () => { chatsCollapsedListeners.delete(cb); };
}
const readChatsCollapsed = () => getPref(APP_PREF_KEYS.collapsedChats) === "1";
const serverChatsCollapsed = () => false;
function writeChatsCollapsed(collapsed: boolean): void {
  if (collapsed) setPref(APP_PREF_KEYS.collapsedChats, "1");
  else removePref(APP_PREF_KEYS.collapsedChats);
  chatsCollapsedListeners.forEach((cb) => cb());
}

// Keep this section preference separate from per-project folds and archive
// visibility. Like Chats, hydrate with the server snapshot before reading the
// stored value so a collapsed list never causes a hydration mismatch.
const projectsSectionListeners = new Set<() => void>();
// null = not read yet. Once storage or a click sets it, this value is the
// snapshot, so a failed localStorage write cannot make the fold unresponsive.
let projectsSectionCollapsedMemory: boolean | null = null;
function subscribeProjectsSectionCollapsed(cb: () => void): () => void {
  projectsSectionListeners.add(cb);
  return () => { projectsSectionListeners.delete(cb); };
}
function readProjectsSectionCollapsed(): boolean {
  if (projectsSectionCollapsedMemory === null) {
    projectsSectionCollapsedMemory = getPref(APP_PREF_KEYS.collapsedProjectsSection) === "1";
  }
  return projectsSectionCollapsedMemory;
}
const serverProjectsSectionCollapsed = () => false;
function writeProjectsSectionCollapsed(collapsed: boolean): void {
  // Update the snapshot first: setPref/removePref swallow quota/private-mode
  // errors, and the toggle must still work for this session.
  projectsSectionCollapsedMemory = collapsed;
  if (collapsed) setPref(APP_PREF_KEYS.collapsedProjectsSection, "1");
  else removePref(APP_PREF_KEYS.collapsedProjectsSection);
  projectsSectionListeners.forEach((cb) => cb());
}

function readIdSetPref(key: Parameters<typeof getPrefJson>[0]): Set<string> {
  const stored = getPrefJson<unknown>(key);
  return Array.isArray(stored)
    ? new Set(stored.filter((id): id is string => typeof id === "string"))
    : new Set();
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onChatWorkspaceCwdChange, onProjectsChange, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange, headerControls, onOpenTerminal, onOpenScheduled, scheduledOpen = false, onOpenArtifacts, artifactsOpen = false, onOpenTasks, tasksOpen = false }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [chatWorkspaceCwd, setChatWorkspaceCwd] = useState<string | null>(null);
  // Same fold model as a project: folding drops the extra pages, so the next
  // unfold starts again from the first five chats.
  const chatsCollapsed = useSyncExternalStore(subscribeChatsCollapsed, readChatsCollapsed, serverChatsCollapsed);
  const projectsSectionCollapsed = useSyncExternalStore(
    subscribeProjectsSectionCollapsed, readProjectsSectionCollapsed, serverProjectsSectionCollapsed,
  );
  const [chatSessionPages, setChatSessionPages] = useState(() => {
    const stored = getPrefJson<unknown>(APP_PREF_KEYS.chatSessionPages);
    return typeof stored === "number" && Number.isInteger(stored) && stored > 0 ? stored : 0;
  });
  const [archivedChats, setArchivedChats] = useState<Set<string>>(() => readIdSetPref(APP_PREF_KEYS.archivedChats));
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  // Project sessions archived one by one (#200). They leave their project's
  // list for a "Show archived" fold at its end; a search still finds them.
  const [archivedSessions, setArchivedSessions] = useState<Set<string>>(() => readIdSetPref(APP_PREF_KEYS.archivedSessions));
  // Pins are the server's, not the browser's (`lib/sidebar-pins.ts`,
  // `<agentDir>/pi-web-session-state.json`): one server serves Safari, Edge, the
  // desktop shell and a phone, and a pin made in any of them shows in all. A
  // running frame's `sessionUiStateRevision` carries a pin made elsewhere into
  // this window. Chats and project sessions share one set of family root ids;
  // a project pins by its root, the key `groupByProject` groups by.
  const reportPinFailure = useCallback((message: string) => {
    appNotify.error({ message: t("sidebar.uiStateFailed", { error: message }) });
  }, [t]);
  const pins = useSidebarPins(reportPinFailure);
  const { noteRevision } = pins;
  const pinnedChats = pins.pinnedIds;
  const pinnedSessions = pins.pinnedIds;
  // S2: pinned projects sit above the others.
  const pinnedProjects = pins.pinnedProjectRoots;
  // S6: the project whose sessions the confirmation would delete.
  const [projectSessionsDelete, setProjectSessionsDelete] = useState<{ root: string; name: string; ids: string[]; kept: number } | null>(null);
  const [projectSessionsDeleting, setProjectSessionsDeleting] = useState(false);
  const [projectSessionsDeleteError, setProjectSessionsDeleteError] = useState<string | null>(null);
  const [projectsShowingArchived, setProjectsShowingArchived] = useState<Set<string>>(() => new Set());
  const [chatsMenuOpen, setChatsMenuOpen] = useState(false);
  const [chatsMenuPos, setChatsMenuPos] = useState<{ top: number; left: number } | null>(null);
  // The sidebar's menus are mounted on the click that opens them. Held for the shared exit
  // animation (hooks/usePopTransition.ts), they leave the way they came; the spot a menu
  // opened at is kept for the length of the exit, so the closing menu sits where the open
  // one was. Every outside-click handler below stays keyed on the open state.
  const chatsMenuPop = usePopTransition(chatsMenuOpen);
  const shownChatsMenuPos = useShownWhileClosing(chatsMenuPos, chatsMenuPop.closing);
  const chatsMenuRef = useRef<HTMLDivElement>(null);
  const chatsMenuButtonRef = useRef<HTMLButtonElement>(null);
  // Tracked in a ref only: the version is compared against the polled value to
  // decide whether the list needs reloading, and no render reads it.
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // On macOS the native traffic lights float over this header. The mac-inset
  // class keeps its control row 48px tall so it shares the lights' centre line.
  const [desktopPlatform, setDesktopPlatform] = useState<DesktopPlatform>(null);
  useEffect(() => {
    if (isTauriDesktop()) setDesktopPlatform(getDesktopPlatform());
  }, []);
  const windowDrag = useWindowDrag();
  const [sessionQuery, setSessionQuery] = useState("");
  // Content search (server-side, across every session) vs. the default title
  // filter over the loaded project tree. Enter engages it; clearing the box
  // (Escape or the clear button) drops back to the title filter.
  const [contentSearch, setContentSearch] = useState(false);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const lastNotifiedProjectRef = useRef<{
    cwd: string | null;
    key: string | null;
    kind: SessionWorkspaceKind;
  } | null>(null);

  // The checked-out worktree for the current selection (falls back to the
  // project's main worktree when the selection is not itself a worktree).
  // Prefers the server-resolved currentWorktreePath: the browser cannot apply
  // Node path rules, so a raw comparison misses on Windows.
  const currentWorktree = worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined;

  /** Chat detection always comes from server-provided identity or the exact
   *  chat cwd the server returned. The browser never derives the hidden path. */
  const isChatCwd = useCallback((cwd: string | null): boolean => {
    if (!cwd) return false;
    if (chatWorkspaceCwd && cwd === chatWorkspaceCwd) return true;
    return allSessions.some((session) => session.workspaceKind === "chat" && session.cwd === cwd);
  }, [allSessions, chatWorkspaceCwd]);
  const selectedCwdIsChat = selectedCwd ? isChatCwd(selectedCwd) : false;

  /** Resolve the project root for a cwd from the freshest data available */
  const projectRootFor = useCallback((cwd: string | null): string | null => {
    if (!cwd) return null;
    if (isChatCwd(cwd)) return null;
    if (worktreeState && worktreeState.forCwd === cwd) return worktreeState.projectRoot;
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    // Only for a top-level checkout: a repo subfolder's list also holds the
    // parent repo, which keeps its own project identity.
    if (worktreeState?.isTopLevel && worktreeState.worktrees.some((w) => w.path === cwd)) return worktreeState.projectRoot;
    const match = allSessions.find((s) => s.cwd === cwd);
    return match?.projectRoot ?? cwd;
  }, [allSessions, isChatCwd, worktreeState]);
  // Ticked by the poll/focus effect below so the worktree row reflects
  // branches checked out outside pi (terminal, IDE) without a manual reload.
  const [wtPollTick, setWtPollTick] = useState(0);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    const stored = getPrefJson<unknown>(APP_PREF_KEYS.collapsedProjects);
    return Array.isArray(stored)
      ? new Set(stored.filter((root): root is string => typeof root === "string"))
      : new Set();
  });
  const [projectSessionPages, setProjectSessionPages] = useState<Record<string, number>>(() => {
    const stored = getPrefJson<unknown>(APP_PREF_KEYS.expandedProjects);
    if (Array.isArray(stored)) {
      // Older builds stored a set of fully expanded projects. Start those at
      // one extra page instead of restoring the unbounded list.
      return Object.fromEntries(
        stored
          .filter((root): root is string => typeof root === "string")
          .map((root) => [root, 1]),
      );
    }
    if (!stored || typeof stored !== "object") return {};
    return Object.fromEntries(
      Object.entries(stored).flatMap(([root, pages]) => (
        typeof pages === "number" && Number.isFinite(pages) && pages > 0
          ? [[root, Math.floor(pages)]]
          : []
      )),
    );
  });
  const archivedProjectRoots = useArchivedProjects();
  const archiveExpanded = useArchiveExpanded();
  // Archived projects open folded; this holds the ones unfolded this visit.
  const [expandedArchivedProjects, setExpandedArchivedProjects] = useState<Set<string>>(() => new Set());
  const [projectViewMode, setProjectViewMode] = useState<ProjectViewMode>(loadProjectViewMode);
  const [projectViewMenuOpen, setProjectViewMenuOpen] = useState(false);
  const [projectViewMenuPos, setProjectViewMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [projectViewMenuAnchor, setProjectViewMenuAnchor] = useState<MenuAnchor | null>(null);
  // Held for the shared exit animation (hooks/usePopTransition.ts), with the spot the menu
  // opened at kept for the length of the exit.
  const projectViewMenuPop = usePopTransition(projectViewMenuOpen);
  const shownProjectViewMenuPos = useShownWhileClosing(projectViewMenuPos, projectViewMenuPop.closing);
  const projectViewMenuRef = useRef<HTMLDivElement>(null);
  const projectViewMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [projectMenu, setProjectMenu] = useState<{ root: string; archived?: boolean } | null>(null);
  const [projectMenuPos, setProjectMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [projectPathHint, setProjectPathHint] = useState<{ root: string; top: number; left: number; height: number } | null>(null);
  const projectPathHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideProjectPathHint = useCallback(() => {
    if (projectPathHintTimerRef.current !== null) clearTimeout(projectPathHintTimerRef.current);
    projectPathHintTimerRef.current = null;
    setProjectPathHint(null);
  }, []);
  const scheduleProjectPathHint = useCallback((target: HTMLElement, root: string) => {
    hideProjectPathHint();
    if (projectMenu) return;
    projectPathHintTimerRef.current = setTimeout(() => {
      projectPathHintTimerRef.current = null;
      if (!target.isConnected) return;
      const row = target.closest<HTMLElement>(".sidebar-project-tree-row");
      const sidebar = target.closest<HTMLElement>(".session-sidebar");
      if (!row || !sidebar) return;
      const rowRect = row.getBoundingClientRect();
      setProjectPathHint({ root, top: rowRect.top, left: sidebar.getBoundingClientRect().right, height: rowRect.height });
    }, 350);
  }, [hideProjectPathHint, projectMenu]);
  useEffect(() => {
    window.addEventListener("scroll", hideProjectPathHint, true);
    window.addEventListener("resize", hideProjectPathHint);
    window.addEventListener("pointerdown", hideProjectPathHint, true);
    return () => {
      window.removeEventListener("scroll", hideProjectPathHint, true);
      window.removeEventListener("resize", hideProjectPathHint);
      window.removeEventListener("pointerdown", hideProjectPathHint, true);
      if (projectPathHintTimerRef.current !== null) clearTimeout(projectPathHintTimerRef.current);
    };
  }, [hideProjectPathHint]);
  const [projectMenuAnchor, setProjectMenuAnchor] = useState<MenuAnchor | null>(null);
  // The project "…" menu is mounted on the click that opens it and unmounted on the one
  // that closes it. It is held for the shared exit animation, and for its length the panel,
  // the spot and the anchor it opened at are kept: a closing menu that has lost its project
  // animates an empty box, not a menu. On the desktop shell the menu is a native popup, for
  // which `projectMenuPos` stays null, so nothing is mounted and nothing animates.
  const projectMenuPop = usePopTransition(Boolean(projectMenu) && Boolean(projectMenuPos));
  const shownProjectMenu = useShownWhileClosing(projectMenu, projectMenuPop.closing);
  const shownProjectMenuPos = useShownWhileClosing(projectMenuPos, projectMenuPop.closing);
  const shownProjectMenuAnchor = useShownWhileClosing(projectMenuAnchor, projectMenuPop.closing);
  // "Open in file manager" on a project row. Only the server can raise a
  // file-manager window, and only when the browser runs on that same machine,
  // so the browser asks once and the menu shows the entry only where it works;
  // the desktop shell reveals natively through revealItemInDirNative instead.
  const [fileManagerAvailability, setFileManagerAvailability] = useState<{ supported: boolean; reason: string | null; platform: string } | null>(null);
  const [projectRevealError, setProjectRevealError] = useState<string | null>(null);
  useEffect(() => {
    if (isTauriDesktop()) return;
    let cancelled = false;
    fetch("/api/open-in-explorer")
      .then((res) => res.ok ? res.json() as Promise<{ supported: boolean; reason: string | null; platform: string }> : null)
      .then((data) => { if (!cancelled && data) setFileManagerAvailability(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const revealProjectInFileManager = useCallback(async (root: string) => {
    setProjectRevealError(null);
    if (isTauriDesktop()) {
      try {
        await revealItemInDirNative(root);
        setProjectMenu(null);
      } catch (e) {
        setProjectRevealError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      const res = await fetch("/api/open-in-explorer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: root }),
      });
      if (res.ok) {
        setProjectMenu(null);
        return;
      }
      const data = await res.json().catch(() => ({})) as { error?: string };
      const key = FILE_MANAGER_ERROR_KEYS[data.error ?? ""];
      setProjectRevealError(key ? t(key) : (data.error ?? `HTTP ${res.status}`));
    } catch (e) {
      setProjectRevealError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);
  const fileManagerPlatform = isTauriDesktop()
    ? (desktopPlatform === "macos" ? "darwin" : desktopPlatform === "windows" ? "win32" : "linux")
    : fileManagerAvailability?.platform;
  const revealProjectLabel = t(
    fileManagerPlatform === "darwin"
      ? "sidebar.openInFinder"
      : fileManagerPlatform === "win32"
        ? "sidebar.openInExplorer"
        : "sidebar.openInFileManager",
  );
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  // "Add project" in a browser opens the app's own folder window — components/DirectoryPicker,
  // the same window the project picker's browse uses: the app's overlay, the app's modal
  // animation, folders only, and a path this computer really has. The path is validated
  // before it is adopted, and a refusal is shown inside the window so the user can go up a
  // level and choose again.
  const [projectFolderOpen, setProjectFolderOpen] = useState(false);
  const [projectPickBusy, setProjectPickBusy] = useState(false);
  const [projectPickError, setProjectPickError] = useState<string | null>(null);
  // The chat whose conversation is being copied into a project (the picker is open for it).
  const [continueChat, setContinueChat] = useState<SessionInfo | null>(null);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const sseAuthoritativeRef = useRef(false);
  const detailsHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Overlay-style scrollbar: `is-scrolling` shows the thumb only while the
  // project tree is actually scrolling.
  const listScrollHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    e.currentTarget.classList.add("is-scrolling");
    if (listScrollHideTimerRef.current) clearTimeout(listScrollHideTimerRef.current);
    listScrollHideTimerRef.current = setTimeout(() => {
      listScrollRef.current?.classList.remove("is-scrolling");
      listScrollHideTimerRef.current = null;
    }, 800);
  }, []);
  useEffect(() => () => {
    if (listScrollHideTimerRef.current) clearTimeout(listScrollHideTimerRef.current);
  }, []);

  const loadSessions = useCallback(async (showLoading = false, force = false, summary = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(sessionListUrl(summary, force), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        completionNotificationSuppressedSessionIds?: string[];
        chatWorkspaceCwd?: string | null;
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      setAllSessions(data.sessions);
      setChatWorkspaceCwd(data.chatWorkspaceCwd ?? null);
      // Treat the fetched running set as an initial fallback only. Once the
      // live SSE stream is connected, a slow session-list fetch cannot overwrite it.
      if (!sseAuthoritativeRef.current) {
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The server always returns the hidden cwd. Do not publish the initial
    // null before the first list load, or it would overwrite the shell's
    // earlier /api/chat-workspace answer.
    if (chatWorkspaceCwd) onChatWorkspaceCwdChange?.(chatWorkspaceCwd);
  }, [chatWorkspaceCwd, onChatWorkspaceCwdChange]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    let active = true;

    if (isFirst) {
      // Header/stat metadata is enough to select the URL session and paint the
      // sidebar. Hydrate exact counts, names, and first messages once the
      // selected chat has had a chance to start loading.
      void loadSessions(true, false, true).then(() => {
        if (!active) return;
        detailsHydrationTimerRef.current = setTimeout(() => {
          detailsHydrationTimerRef.current = null;
          if (active) void loadSessions(false, true);
        }, SESSION_DETAILS_HYDRATION_DELAY_MS);
      });
    } else {
      void loadSessions(false, true);
    }

    return () => {
      active = false;
      if (detailsHydrationTimerRef.current) {
        clearTimeout(detailsHydrationTimerRef.current);
        detailsHydrationTimerRef.current = null;
      }
    };
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  useEffect(() => {
    if (collapsedProjects.size === 0) removePref(APP_PREF_KEYS.collapsedProjects);
    else setPrefJson(APP_PREF_KEYS.collapsedProjects, [...collapsedProjects]);
  }, [collapsedProjects]);

  // A fold animates in both directions, and a closing one needs its rows mounted for the
  // length of the animation. lib/sidebar-fold-motion.ts keeps them mounted for exactly
  // that: the keyboard row walk, the project counts and the flat-list virtualization all
  // treat a folded project as having no rows, so nothing longer may stay mounted.
  const projectFold = useProjectFold(collapsedProjects);

  useEffect(() => {
    if (archivedChats.size === 0) removePref(APP_PREF_KEYS.archivedChats);
    else setPrefJson(APP_PREF_KEYS.archivedChats, [...archivedChats]);
  }, [archivedChats]);

  useEffect(() => {
    if (archivedSessions.size === 0) removePref(APP_PREF_KEYS.archivedSessions);
    else setPrefJson(APP_PREF_KEYS.archivedSessions, [...archivedSessions]);
  }, [archivedSessions]);

  useEffect(() => {
    if (chatSessionPages === 0) removePref(APP_PREF_KEYS.chatSessionPages);
    else setPrefJson(APP_PREF_KEYS.chatSessionPages, chatSessionPages);
  }, [chatSessionPages]);

  useEffect(() => {
    if (Object.keys(projectSessionPages).length === 0) removePref(APP_PREF_KEYS.expandedProjects);
    else setPrefJson(APP_PREF_KEYS.expandedProjects, projectSessionPages);
  }, [projectSessionPages]);

  useEffect(() => {
    // Live running status via SSE — no polling. The server pushes the current set of
    // running session ids whenever any session starts/stops working, and the whole browser
    // reads it from ONE stream: the tabs elect a leader
    // (lib/scheduled-tasks/shared-stream.ts), because the browser's handful of HTTP/1.1
    // connections per host is what a page load competes with (e2e/offline-navigation.mjs).
    type RunningFrame = { type?: string; runningSessionIds?: string[]; sessionListVersion?: number; sessionUiStateRevision?: number | null };
    const applyFrame = async (data: RunningFrame) => {
      // A pin, an archive or a project move is no run, so it comes as its own
      // frame (and rides along in every running frame): re-read the sidebar's
      // state when the server's revision is not the one this window shows.
      noteRevision(data.sessionUiStateRevision);
      if (data.type === "running") {
        sseAuthoritativeRef.current = true;
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      if (typeof data.sessionListVersion === "number"
        && data.sessionListVersion !== sessionListVersionRef.current) {
        // Another window/process changed the list; reuse the invalidated
        // server cache instead of forcing a fresh scan.
        await loadSessions();
      }
    };

    const stream = openSharedEventStreamHandle<RunningFrame>({
      url: "/api/agent/running/events",
      name: RUNNING_SESSIONS_STREAM_NAME,
      onEvent: (data) => { void applyFrame(data); },
    });

    // Force a fresh connection after prolonged failures: an EventSource alone can stall
    // after local server restarts in the desktop shell. Only the leader has a connection
    // to reopen; a stalled leader is retried by the shared stream itself.
    const onVisible = () => {
      if (document.visibilityState === "visible") stream.reconnect();
    };
    const onOnline = () => stream.reconnect();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      stream.stop();
    };
  }, [loadSessions, noteRevision]);

  useEffect(() => {
    if (!projectMenu) return;
    const handler = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenu(null);
        setProjectMenuPos(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [projectMenu]);

  useEffect(() => {
    if (!projectViewMenuOpen || !projectViewMenuPos) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (projectViewMenuRef.current?.contains(target)) return;
      if (projectViewMenuButtonRef.current?.contains(target)) return;
      setProjectViewMenuOpen(false);
      setProjectViewMenuPos(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isImeComposing(event)) {
        setProjectViewMenuOpen(false);
        setProjectViewMenuPos(null);
      }
    };
    const closeOnViewportChange = () => {
      setProjectViewMenuOpen(false);
      setProjectViewMenuPos(null);
    };
    // Only a scroller that carries the button away closes the menu. On a running session
    // page the chat scrolls itself on every streamed chunk, and this window-wide listener
    // cut the Projects "…" menu off about a second after every open.
    const onScroll = (event: Event) => {
      if (scrollMovesAnchor(event.target, projectViewMenuButtonRef.current)) closeOnViewportChange();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [projectViewMenuOpen, projectViewMenuPos]);

  useEffect(() => {
    if (!chatsMenuOpen || !chatsMenuPos) return;
    const close = () => {
      setChatsMenuOpen(false);
      setChatsMenuPos(null);
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (chatsMenuRef.current?.contains(target)) return;
      if (chatsMenuButtonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isImeComposing(event)) close();
    };
    // A scroll closes the menu only when it carries the button away — the chat scrolls
    // itself while a session runs, and that is not news for a menu in the sidebar.
    const onScroll = (event: Event) => {
      if (scrollMovesAnchor(event.target, chatsMenuButtonRef.current)) close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [chatsMenuOpen, chatsMenuPos]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    // A scheduled run says how it ended (and what failed) through its own notification.
    const knownScheduledIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "scheduled")
        .map((session) => session.id),
    );
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id)
        && !knownSubagentIds.has(id)
        && !knownScheduledIds.has(id)
        && !isScheduledRunSession(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedWithNotifications.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedWithNotifications.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
      const sessionName = (id: string) => {
        const session = allSessions.find((item) => item.id === id);
        return session?.name || session?.firstMessage || id.slice(0, 8);
      };
      for (const id of completedWithNotifications) {
        void notifyDesktop({
          title: "Pi Agent",
          body: `Finished: ${sessionName(id)}`,
        });
      }
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
  }, [runningSessionIds, selectedSessionId, loadSessions, allSessions, onBackgroundTaskDone]);

  // A session that just started running has no row yet: pi had not flushed it
  // to disk when the list was last fetched. /api/sessions merges live runs, so
  // one refetch per unknown id is enough to make it appear mid-stream instead
  // of only when the turn ends.
  const refetchedRunningIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const known = new Set(allSessions.map((s) => s.id));
    const missing = [...runningSessionIds].filter(
      (id) => !known.has(id) && !refetchedRunningIdsRef.current.has(id),
    );
    if (missing.length === 0) return;
    missing.forEach((id) => refetchedRunningIdsRef.current.add(id));
    void loadSessions(false);
  }, [runningSessionIds, allSessions, loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string, kind: SessionWorkspaceKind = "project"): ProjectSelection => ({
    root,
    key,
    kind,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    if (isChatCwd(cwd)) return projectSelection(cwd, cwd, "chat");
    // Custom-path identity validation lives in ProjectPicker (the extraction
    // boundary this file's sentinel test guards); identity here resolves from
    // server-provided worktree and session data only.
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    // Only for a top-level checkout: a repo subfolder's list also holds the
    // parent repo, which keeps its own project identity.
    if (worktreeState?.isTopLevel && worktreeState.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    if (match?.workspaceKind === "chat") {
      return projectSelection(match.cwd, match.cwd, "chat");
    }
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [worktreeState, allSessions, isChatCwd, projectSelection]);

  // Selecting a directory is also the explicit "add project" action. If the
  // project was previously removed from the sidebar, make it visible again
  // without touching any of the session files discovered for that directory.
  const activateProject = useCallback((cwd: string) => {
    restoreProjectRoot(projectRootFor(cwd) ?? cwd);
    setSelectedCwd(cwd);
  }, [projectRootFor]);

  // Notify parent only when the effective cwd actually changes (not when
  // projectRootFor identity changes due to session/worktree refreshes).
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    const kind = project?.kind ?? "project";
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null) && previous.kind === kind) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null, kind };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
      project?.kind,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  useLayoutEffect(() => {
    if (!selectedCwd || selectedCwdIsChat) {
      setWorktreeState(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) setWorktreeState(null);
      });
    return () => { cancelled = true; };
  }, [selectedCwd, selectedCwdIsChat, refreshKey, wtPollTick]);

  // Keep the worktree/branch display honest when branches are switched outside
  // pi (terminal, IDE, another client): poll while the tab is visible and
  // refresh on window focus. `git worktree list` is a cheap local op.
  useEffect(() => {
    const bump = () => setWtPollTick((t) => t + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    const id = setInterval(onVisible, 10_000);
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Most-recent projects, deduped by projectRoot, used to pick the default
  // cwd when no session is selected yet.
  const recentProjects = getRecentProjects(allSessions);
  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (loading || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = recentProjects;
      if (projects.length > 0) setSelectedCwd(projects[0]);
      else if (chatWorkspaceCwd) setSelectedCwd(chatWorkspaceCwd);
    }
  }, [allSessions, chatWorkspaceCwd, loading, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone, recentProjects]);

  // The worktree behind the active project's branch subtitle; falls back to
  // the main worktree while worktreeState catches up with a new selection.
  const currentWt = currentWorktree ?? null;

  const closeProjectMenu = useCallback(() => {
    setProjectMenu(null);
    setProjectMenuPos(null);
    setProjectMenuAnchor(null);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex);
  }, [onSelectSession]);

  const continueChatInProject = useCallback(async (chat: SessionInfo, cwd: string) => {
    setContinueChat(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(chat.id)}/continue-in-project`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const data = await res.json().catch(() => ({})) as { sessionId?: string; path?: string | null; cwd?: string; chatFolder?: string | null; error?: string };
      if (!res.ok || !data.sessionId) throw new Error(data.error ?? `HTTP ${res.status}`);
      // The project session starts without the files the chat made; say where they are.
      if (data.chatFolder) appNotify.info({ message: t("sidebar.continueInProjectFolderNote", { path: data.chatFolder }) });
      const now = new Date().toISOString();
      activateProject(cwd);
      handleSelectSessionFromList({
        ...chat,
        id: data.sessionId,
        path: data.path ?? "",
        cwd: data.cwd ?? cwd,
        workspaceKind: "project",
        projectRoot: projectRootFor(cwd) ?? cwd,
        created: now,
        modified: now,
        parentSessionId: chat.id,
      });
      void loadSessions(false, true);
    } catch (e) {
      appNotify.error({ message: t("sidebar.continueInProjectFailed", { error: e instanceof Error ? e.message : String(e) }) });
    }
  }, [activateProject, handleSelectSessionFromList, loadSessions, projectRootFor, t]);

  const handleNewSession = useCallback((cwdOverride?: string, workspaceKindOverride?: SessionWorkspaceKind) => {
    const cwd = cwdOverride ?? selectedCwd ?? chatWorkspaceCwd;
    if (!cwd) return;
    const workspaceKind = workspaceKindOverride ?? (isChatCwd(cwd) ? "chat" : "project");
    // An archived project's sessions stay readable, but a new one needs the
    // project restored to the list first (its row menu, or "Add project").
    if (workspaceKind === "project") {
      const projectRoot = projectRootFor(cwd) ?? cwd;
      if (archivedProjectRoots.has(projectRoot)) {
        appNotify.info({ message: t("sidebar.projectArchivedNewSession", { name: getProjectDisplayName(projectRoot, [projectRoot]) }) });
        return;
      }
    }
    if (cwd !== selectedCwd) setSelectedCwd(cwd);
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, cwd, workspaceKind);
  }, [selectedCwd, chatWorkspaceCwd, archivedProjectRoots, onNewSession, projectRootFor, isChatCwd, t]);

  const handleAddProject = useCallback(() => {
    if (!isTauriDesktop()) {
      // The app's own window, opened at once. A browser tab has nothing better: the file
      // input's panel is a file chooser (macOS titles it "Choose Files to Upload", lists
      // files, and a page cannot retitle it) and reports only the files inside a folder,
      // never its path; an AppleScript panel is not the browser's window either (Finder's
      // activates Finder, one owned by osascript is not the key window).
      setProjectPickError(null);
      setProjectFolderOpen(true);
      return;
    }

    void (async () => {
      try {
        const cwd = await selectProjectDirectoryNative(selectedCwd, homeDir);
        if (cwd) activateProject(cwd);
      } catch (error) {
        console.error("Failed to select project folder:", error);
      }
    })();
  }, [activateProject, homeDir, selectedCwd]);

  /** The window's "Choose this folder": validate it, then adopt it. */
  const handleProjectFolderSelect = useCallback(async (cwd: string) => {
    setProjectPickBusy(true);
    setProjectPickError(null);
    try {
      const picked = await chooseProjectDirectory(cwd);
      if (picked.status === "picked") {
        setProjectFolderOpen(false);
        setProjectPickError(null);
        activateProject(picked.cwd);
        return;
      }
      // Keep the window open: a refused folder (macOS TCC denies Desktop, Documents,
      // Downloads) is answered by going up a level, not by a toast over the chat.
      setProjectPickError(picked.reason);
    } finally {
      setProjectPickBusy(false);
    }
  }, [activateProject]);

  const archiveProject = useCallback((projectRoot: string) => {
    archiveProjectRoot(projectRoot);
    closeProjectMenu();
    // The selection must not stay on an archived project, or the next "New
    // session" would land there. Move to the most recent project still listed.
    if (selectedCwd && !isChatCwd(selectedCwd) && (projectRootFor(selectedCwd) ?? selectedCwd) === projectRoot) {
      const next = recentProjects.find((root) => root !== projectRoot && !archivedProjectRoots.has(root));
      setSelectedCwd(next ?? chatWorkspaceCwd ?? null);
    }
  }, [archivedProjectRoots, chatWorkspaceCwd, closeProjectMenu, isChatCwd, projectRootFor, recentProjects, selectedCwd]);

  // S6: a project's top-level sessions (subagent runs go with their parent), split
  // into those a delete may remove and those running now, which it keeps.
  const projectSessionsToDelete = useCallback((projectRoot: string): { ids: string[]; kept: number } => {
    const ids: string[] = [];
    let kept = 0;
    for (const session of allSessions) {
      if (session.transient || session.relation?.kind === "subagent" || session.relation?.kind === "scheduled") continue;
      if (session.workspaceKind === "chat" || isChatCwd(session.cwd)) continue;
      if ((session.projectRoot || session.cwd) !== projectRoot) continue;
      if (runningSessionIds.has(session.id)) kept += 1;
      else ids.push(session.id);
    }
    return { ids, kept };
  }, [allSessions, isChatCwd, runningSessionIds]);

  const requestProjectSessionsDelete = useCallback((projectRoot: string) => {
    const { ids, kept } = projectSessionsToDelete(projectRoot);
    if (ids.length === 0) return;
    setProjectSessionsDeleteError(null);
    setProjectSessionsDelete({ root: projectRoot, name: getProjectDisplayNames([projectRoot]).get(projectRoot) ?? projectRoot, ids, kept });
  }, [projectSessionsToDelete]);

  const performProjectSessionsDelete = useCallback(async () => {
    const target = projectSessionsDelete;
    if (!target) return;
    setProjectSessionsDeleting(true);
    setProjectSessionsDeleteError(null);
    let failure: string | null = null;
    // One at a time: each delete rewrites the session index the next one reads.
    for (const id of target.ids) {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok && res.status !== 404) {
          const d = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(d.error ?? `HTTP ${res.status}`);
        }
        onSessionDeleted?.(id);
      } catch (e) {
        failure = t("sidebar.deleteFailed", { error: e instanceof Error ? e.message : String(e) });
        break;
      }
    }
    setProjectSessionsDeleting(false);
    void loadSessions();
    if (failure) setProjectSessionsDeleteError(failure);
    else setProjectSessionsDelete(null);
  }, [loadSessions, onSessionDeleted, projectSessionsDelete, t]);

  // S4: Fork copies a session's current branch into a new session beside it
  // (POST /api/sessions/[id]/fork) and opens the copy; the source is untouched.
  // One request per source at a time.
  const forkingIdsRef = useRef(new Set<string>());
  const forkSession = useCallback(async (source: SessionInfo) => {
    if (source.transient || forkingIdsRef.current.has(source.id)) return;
    forkingIdsRef.current.add(source.id);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(source.id)}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({})) as { session?: SessionInfo; code?: string; error?: string };
      if (!res.ok || !data.session) {
        const { key, params } = forkFailureMessage(data.code, data.error ?? `HTTP ${res.status}`);
        appNotify.error({ message: t(key, params) });
        return;
      }
      const forked = data.session;
      handleSelectSessionFromList(forked);
      appNotify.success({ message: t("sidebar.forkedToast", { title: forked.name || forked.firstMessage || forked.id }) });
      void loadSessions();
    } catch (error) {
      appNotify.error({ message: t("sidebar.forkFailed", { error: error instanceof Error ? error.message : String(error) }) });
    } finally {
      forkingIdsRef.current.delete(source.id);
    }
  }, [handleSelectSessionFromList, loadSessions, t]);

  const restoreProject = useCallback((projectRoot: string) => {
    restoreProjectRoot(projectRoot);
    closeProjectMenu();
    setExpandedArchivedProjects((prev) => {
      if (!prev.has(projectRoot)) return prev;
      const next = new Set(prev);
      next.delete(projectRoot);
      return next;
    });
  }, [closeProjectMenu]);

  // Desktop shell: the project menu as a native popup. `projectMenu` stays set
  // while it is up (it keeps the row's "…" visible) but `projectMenuPos` stays
  // null, so the DOM menu never renders.
  const showNativeProjectMenu = useCallback(async (projectRoot: string, at: NativeMenuPoint, archived = false): Promise<boolean> => {
    setProjectMenu({ root: projectRoot, archived });
    setProjectMenuPos(null);
    setProjectRevealError(null);
    const shown = await showNativeMenu(archived ? [
      { label: t("sidebar.restoreProject"), onSelect: () => restoreProject(projectRoot) },
      { label: revealProjectLabel, onSelect: () => void revealProjectInFileManager(projectRoot) },
    ] : [
      ...(onOpenTerminal
        ? [{ label: t("sidebar.openTerminalHere"), onSelect: () => onOpenTerminal(projectRoot) }]
        : []),
      { label: revealProjectLabel, onSelect: () => void revealProjectInFileManager(projectRoot) },
      { kind: "separator" as const },
      { label: t(pinnedProjects.has(projectRoot) ? "sidebar.unpinProject" : "sidebar.pinProject"), onSelect: () => { void pins.toggleProjectPin(projectRoot); } },
      { label: t("sidebar.archiveProject"), onSelect: () => archiveProject(projectRoot) },
      ...(projectSessionsToDelete(projectRoot).ids.length > 0
        ? [{ label: t("sidebar.deleteProjectSessions", { count: projectSessionsToDelete(projectRoot).ids.length }), onSelect: () => requestProjectSessionsDelete(projectRoot) }]
        : []),
    ], at);
    setProjectMenu((current) => (current?.root === projectRoot ? null : current));
    return shown;
  }, [archiveProject, onOpenTerminal, pinnedProjects, pins, projectSessionsToDelete, requestProjectSessionsDelete, restoreProject, revealProjectInFileManager, revealProjectLabel, t]);

  /** "…" opens the menu under the button; a right-click opens it at the cursor. */
  const openProjectMenu = useCallback((e: React.MouseEvent<HTMLElement>, projectRoot: string, archived = false) => {
    hideProjectPathHint();
    const atCursor = e.type === "contextmenu";
    if (atCursor) e.preventDefault();
    e.stopPropagation();
    if (canUseNativeMenu()) {
      void showNativeProjectMenu(projectRoot, atCursor ? { x: e.clientX, y: e.clientY } : menuPointBelow(e.currentTarget), archived);
      return;
    }
    if (projectMenu?.root === projectRoot && !atCursor) {
      closeProjectMenu();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 168;
    const anchor = atCursor
      ? { top: e.clientY, bottom: e.clientY, right: e.clientX + menuWidth }
      : { top: rect.top, bottom: rect.bottom, right: rect.right };
    const left = Math.max(8, Math.min(anchor.right - menuWidth, window.innerWidth - menuWidth - 8));
    setProjectMenu({ root: projectRoot, archived });
    setProjectMenuPos({ top: anchor.bottom + 4, left });
    // The menu measures its own height and flips above the row when the space
    // below is too small, so the last items stay reachable.
    setProjectMenuAnchor(anchor);
    setProjectRevealError(null);
  }, [closeProjectMenu, hideProjectPathHint, projectMenu, showNativeProjectMenu]);

  // Phase A: project tree — groups sessions by project root. Sorting is
  const trimmedSessionQuery = sessionQuery.trim().toLowerCase();
  // Runs of scheduled tasks live under Scheduled, not in the project tree: an
  // hourly task would otherwise bury the sessions the user started themselves.
  const treeSessions = allSessions.filter((session) => session.relation?.kind !== "scheduled");
  const filteredSessions = trimmedSessionQuery
    ? treeSessions.filter((session) =>
        (session.name ?? "").toLowerCase().includes(trimmedSessionQuery)
        || session.firstMessage.toLowerCase().includes(trimmedSessionQuery))
    : treeSessions;
  const chatSessions = filteredSessions
    .filter((session) => session.workspaceKind === "chat" || isChatCwd(session.cwd))
    .sort((a, b) => b.modified.localeCompare(a.modified));
  const projectSessions = filteredSessions.filter(
    (session) => session.workspaceKind !== "chat" && !isChatCwd(session.cwd),
  );
  const allChatFamilies = listSessionFamilies(chatSessions);
  // Pins first, then the unread results, then the running chats, then recency. Archived chats
  // leave the list unless a search is looking for them.
  const chatPreviewState = { pinnedIds: pinnedChats, unreadIds: unreadSessionIds, runningIds: runningSessionIds };
  const chatPreviewPredicates = chatFamilyPredicates(chatPreviewState);
  const orderedChatFamilies = orderChatFamilies(allChatFamilies, chatPreviewState);
  const chatFamilies = trimmedSessionQuery
    ? orderedChatFamilies
    : orderedChatFamilies.filter((family) => !archivedChats.has(family.root.id));
  const archivedChatFamilies = trimmedSessionQuery
    ? []
    : orderedChatFamilies.filter((family) => archivedChats.has(family.root.id));
  const sessionFamilies = listSessionFamilies(projectSessions);
  const sessionsById = useMemo(() => new Map(allSessions.map((session) => [session.id, session])), [allSessions]);
  const allProjects = groupByProject(projectSessions, { runningIds: runningSessionIds, unreadIds: unreadSessionIds });
  const activeProjects = pinnedFirst(
    allProjects.filter((group) => !archivedProjectRoots.has(group.projectRoot)),
    (group) => pinnedProjects.has(group.projectRoot),
  );
  const activeProjectRoots = activeProjects.map((group) => group.projectRoot);
  const projectDisplayNames = getProjectDisplayNames(activeProjectRoots);
  // A search looks inside the archive too, and unfolds it to show the matches.
  const archivedProjects = allProjects.filter((group) => archivedProjectRoots.has(group.projectRoot));
  const archivedDisplayNames = getProjectDisplayNames(archivedProjects.map((group) => group.projectRoot));
  const archiveShown = archiveExpanded || Boolean(trimmedSessionQuery);
  const canCollapseAllProjects = activeProjects.some((group) => !collapsedProjects.has(group.projectRoot));
  const canExpandAllProjects = activeProjects.some((group) => collapsedProjects.has(group.projectRoot));
  const timelineFamilies = projectViewMode === "timeline"
    ? sessionFamilies.filter((family) => (trimmedSessionQuery || !archivedSessions.has(family.root.id)) && (
        !archivedProjectRoots.has(family.root.projectRoot ?? family.root.cwd)
      )).sort((a, b) => b.root.modified.localeCompare(a.root.modified))
    : [];
  const timelineRootNodes = new Map<string, SessionTreeNode>();
  for (const family of timelineFamilies) {
    const [rootNode] = buildSessionTree([family.root, ...family.subagents]);
    if (rootNode) timelineRootNodes.set(family.root.id, rootNode);
  }
  useEffect(() => {
    const projectRoots = activeProjects.map((group) => group.projectRoot);
    onProjectsChange?.(projectRoots);
  }, [activeProjects, onProjectsChange]);
  // Sessions of every worktree in the selected project are shown together
  const selectedProjectObject = projectFor(selectedCwd);
  const selectedProjectRoot = selectedProjectObject?.kind === "project"
    ? selectedProjectObject.root
    : null;
  // A search always lists every match, folded or not.
  const chatsFolded = !trimmedSessionQuery && chatsCollapsed;
  // Search reveals both active and archived matches without overwriting folds.
  const projectsSectionFolded = !trimmedSessionQuery && projectsSectionCollapsed;
  // Every pinned, unread and running chat stays in the preview window; the usual five rows of
  // recency fill in below them.
  const alwaysVisibleChatFamilies = chatFamilies.filter((family) => (
    previewRowIsAlwaysVisible(family, chatPreviewPredicates)
  )).length;
  let visibleChatFamilies = trimmedSessionQuery
    ? chatFamilies
    : chatFamilies.slice(0, Math.max(MAX_VISIBLE_CHAT_SESSIONS * (chatSessionPages + 1), alwaysVisibleChatFamilies));
  if (!trimmedSessionQuery && selectedSessionId) {
    const selectedFamily = chatFamilies.find((family) => (
      family.root.id === selectedSessionId
      || family.subagents.some((session) => session.id === selectedSessionId)
    ));
    if (selectedFamily && !visibleChatFamilies.includes(selectedFamily)) {
      visibleChatFamilies = [...visibleChatFamilies.slice(0, -1), selectedFamily];
    }
  }
  const hiddenChatFamilyCount = chatFamilies.length - visibleChatFamilies.length;
  const chatRunningCount = chatFamilies.filter((family) => (
    familyHasRunningSession(family, runningSessionIds)
  )).length;
  const chatUnreadCount = chatFamilies.filter((family) => (
    familyHasUnreadSession(family, unreadSessionIds)
  )).length;
  const setChatsFolded = (folded: boolean) => {
    writeChatsCollapsed(folded);
    if (folded) setChatSessionPages(0);
  };

  const renderChatFamily = (family: (typeof chatFamilies)[number]) => {
    const [node] = buildSessionTree([family.root, ...family.subagents]);
    if (!node) return null;
    const id = family.root.id;
    return (
      <SessionFamilyItem
        sessionsById={sessionsById}
        node={node}
        familySessions={[family.root, ...family.subagents]}
        pinnedInk={pinnedChats.has(id)}
        selectedSessionId={selectedSessionId}
        runningSessionIds={runningSessionIds}
        unreadSessionIds={unreadSessionIds}
        onSelectSession={handleSelectSessionFromList}
        onRenamed={loadSessions}
        onContinueInProject={setContinueChat}
        chatActions={{
          pinned: pinnedChats.has(id),
          archived: archivedChats.has(id),
          onTogglePin: () => { void pins.toggleSessionPin(id); },
          onToggleArchive: () => setArchivedChats((current) => toggleId(current, id)),
        }}
        onSessionDeleted={(deletedId) => {
          onSessionDeleted?.(deletedId);
          loadSessions();
        }}
      />
    );
  };

  const sessionArchiveActions = (id: string): SessionArchiveActions => ({
    archived: archivedSessions.has(id),
    onToggleArchive: () => setArchivedSessions((current) => toggleId(current, id)),
    pinned: pinnedSessions.has(id),
    onTogglePin: () => { void pins.toggleSessionPin(id); },
  });

  const renderProjectGroup = (group: ReturnType<typeof groupByProject>[number], archived = false) => {
    // Archived projects open folded and unfold only for this visit.
    const isCollapsed = !trimmedSessionQuery && (archived
      ? !expandedArchivedProjects.has(group.projectRoot)
      : collapsedProjects.has(group.projectRoot));
    const isActive = group.projectRoot === projectRootFor(selectedCwd);
    const runningCount = group.runningIds.size;
    const unreadCount = group.unreadIds.size;
    const fullGroupTree = buildSessionTree(group.sessions);
    const archivedGroupTree = trimmedSessionQuery
      ? []
      : fullGroupTree.filter((node) => archivedSessions.has(node.session.id));
    const unarchivedGroupTree = archivedGroupTree.length > 0
      ? fullGroupTree.filter((node) => !archivedSessions.has(node.session.id))
      : fullGroupTree;
    // Pins first, then the unread results, then every running family, each part keeping its
    // recency order (S2).
    const previewPredicates: PreviewPredicates<SessionTreeNode> = {
      isPinned: (node) => pinnedSessions.has(node.session.id),
      isUnread: (node) => treeHasUnreadSession(node, group.unreadIds),
      isRunning: (node) => treeHasRunningSession(node, group.runningIds),
    };
    const groupTree = previewOrder(unarchivedGroupTree, previewPredicates);
    const showingArchived = projectsShowingArchived.has(group.projectRoot);
    const extraPages = projectSessionPages[group.projectRoot] ?? 0;
    // The preview window never buries what the user cares about: every pinned row, every unread
    // result and every running family stays visible, and the usual five rows of recency fill in
    // below them.
    const alwaysVisibleRoots = unarchivedGroupTree
      .filter((node) => previewRowIsAlwaysVisible(node, previewPredicates))
      .length;
    const visibleSessionLimit = Math.max(MAX_VISIBLE_PROJECT_SESSIONS * (extraPages + 1), alwaysVisibleRoots);
    let visibleGroupTree = trimmedSessionQuery
      ? groupTree
      : groupTree.slice(0, visibleSessionLimit);
    // Keep the selected session reachable even when it is older than the
    // collapsed preview window.
    if (!trimmedSessionQuery && selectedSessionId) {
      const selectedRoot = groupTree.find((node) => treeContainsSession(node, selectedSessionId));
      if (selectedRoot && !visibleGroupTree.includes(selectedRoot)) {
        visibleGroupTree = [...visibleGroupTree.slice(0, -1), selectedRoot];
      }
    }
    const hiddenSessionCount = groupTree.length - visibleGroupTree.length;
    const branchSubtitle = isActive && currentWt?.branch
      ? currentWt.branch
      : group.branches.length === 1
        ? group.branches[0]
        : group.branches.length > 1
          ? `${group.branches[0]} +${group.branches.length - 1}`
          : null;
    const toggleCollapse = () => {
      // Unfolding an archived project only shows its sessions: selecting it
      // would open a new-session composer there.
      if (archived) {
        setExpandedArchivedProjects((prev) => toggleId(prev, group.projectRoot));
        return;
      }
      setCollapsedProjects((prev) => {
        const next = new Set(prev);
        if (next.has(group.projectRoot)) next.delete(group.projectRoot);
        else next.add(group.projectRoot);
        return next;
      });
      setProjectSessionPages((prev) => {
        if (!(group.projectRoot in prev)) return prev;
        const next = { ...prev };
        delete next[group.projectRoot];
        return next;
      });
      if (!isActive) setSelectedCwd(group.projectRoot);
    };

    const isMenuOpen = projectMenu?.root === group.projectRoot;
    const rowTitle = branchSubtitle ? `${group.projectRoot} · ${branchSubtitle}` : group.projectRoot;
    const displayName = (archived ? archivedDisplayNames : projectDisplayNames).get(group.projectRoot) ?? group.displayName;

    const pinned = !archived && pinnedProjects.has(group.projectRoot);
    return (
      <div key={group.projectRoot} className={`sidebar-project-tree-group${isCollapsed ? " is-collapsed" : ""}${isActive ? " is-active" : ""}${archived ? " is-archived" : ""}`}>
        <div
          className={`sidebar-project-tree-row${isMenuOpen ? " is-menu-open" : ""}${pinned ? " is-pinned" : ""}`}
          onContextMenu={(e) => openProjectMenu(e, group.projectRoot, archived)}
        >
          <button
            type="button"
            className="sidebar-project-tree-row-main"
            data-sidebar-tree-row
            tabIndex={0}
            role="treeitem"
            aria-selected={isActive}
            onClick={toggleCollapse}
            aria-expanded={!isCollapsed}
            aria-label={`${displayName}${pinned ? ` · ${t("sidebar.pinnedProject")}` : ""} · ${rowTitle}`}
            onMouseEnter={(e) => scheduleProjectPathHint(e.currentTarget, group.projectRoot)}
            onMouseLeave={hideProjectPathHint}
            onClickCapture={hideProjectPathHint}
            onKeyDown={(e) => handleSidebarTreeKeyDown(e, {
              activate: toggleCollapse,
              expand: () => {
                if (isCollapsed) toggleCollapse();
              },
              collapse: () => {
                if (!isCollapsed) toggleCollapse();
              },
            })}
          >
            <span className="sidebar-project-tree-folder" aria-hidden="true">
              {/* Closed folder vs. folder with its flap lifted; the closed one
                  carries a faint fill so the pair reads as shut / open. */}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                {isCollapsed ? (
                  <path
                    d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
                    fill="currentColor"
                    fillOpacity="0.1"
                  />
                ) : (
                  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
                )}
              </svg>
            </span>
            <span className="sidebar-project-tree-name">
              {displayName}
            </span>
            {/* The header carries the group's numbers all the time: a folded project hides
                its rows, and an open one keeps the running and unread counts — which the
                rows alone do not add up to — readable in one place. */}
            <span className="sidebar-project-tree-count" title={t("sidebar.sessionCount", { count: groupTree.length })}>
              ({groupTree.length})
            </span>
            <span className="sidebar-project-tree-meta">
              {runningCount > 0 && (
                <span className="sidebar-project-tree-chip is-running" title={t("sidebar.runningCount", { count: runningCount })}>
                  {runningCount}
                </span>
              )}
              {unreadCount > 0 && (
                <span className="sidebar-project-tree-chip is-unread" title={t("sidebar.unreadCount", { count: unreadCount })}>
                  {unreadCount}
                </span>
              )}
            </span>
          </button>
          {/* A pinned project is marked by its own folder icon turning orange — no glyph
              to click, no extra column to fit: the row is dense and its trailing edge is
              the hover-only "＋"/"…". Unpinning lives in the "…" menu. */}
          {/* Hover-only overlay at the row's trailing edge: it covers the tail of a
              long name instead of reserving width the rest of the time. */}
          <div className="sidebar-project-tree-row-actions" data-no-drag>
            {/* No new session in an archived project until it is restored. */}
            {!archived && (
            <button
              type="button"
              className="sidebar-project-tree-action"
              onClick={() => handleNewSession(group.projectRoot)}
              title={t("sidebar.newSessionTitle", { path: group.projectRoot })}
              aria-label={t("sidebar.newSessionTitle", { path: group.projectRoot })}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            )}
              <button
              type="button"
              className="sidebar-project-tree-action sidebar-project-tree-more"
              onClick={(e) => openProjectMenu(e, group.projectRoot, archived)}
              title={t("sidebar.moreActions")}
              aria-label={t("sidebar.moreActions")}
                aria-haspopup="menu"
              aria-expanded={isMenuOpen}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
          </div>
        </div>
        {!isCollapsed || projectFold.closing.has(group.projectRoot) ? (
          <div
            className="sidebar-project-tree-children"
            data-fold={isCollapsed ? "closing" : "opening"}
            // The fold's height is measured and animated here (lib/sidebar-fold-motion.ts):
            // a height transition is what moves the projects below continuously, and the
            // closing rows unmount when the height reaches zero, not on a timer.
            ref={(element) => {
              if (!element) return;
              applySidebarFold(element, {
                closed: isCollapsed,
                animateOpen: projectFold.opening.has(group.projectRoot),
                onSettled: () => projectFold.settle(group.projectRoot),
              });
            }}
          >
            {visibleGroupTree.map((node) => {
              const nodeFamily = sessionFamilies.find(
                (family) => family.root.id === node.session.id,
              );
              return (
              <SessionFamilyItem
                sessionsById={sessionsById}
                key={node.session.id}
                node={node}
                familySessions={nodeFamily ? [nodeFamily.root, ...nodeFamily.subagents] : undefined}
                pinnedInk={pinnedSessions.has(node.session.id)}
                selectedSessionId={selectedSessionId}
                runningSessionIds={runningSessionIds}
                unreadSessionIds={unreadSessionIds}
                onSelectSession={handleSelectSessionFromList}
                onRenamed={loadSessions}
                archiveActions={sessionArchiveActions(node.session.id)}
                onFork={forkSession}
                onSessionDeleted={(id) => {
                  onSessionDeleted?.(id);
                  loadSessions();
                }}
              />
              );
            })}
            {hiddenSessionCount > 0 && (
              <button
                type="button"
                className="sidebar-project-tree-show-more"
                onClick={() => setProjectSessionPages((prev) => ({
                  ...prev,
                  [group.projectRoot]: (prev[group.projectRoot] ?? 0) + 1,
                }))}
              >
                {t("sidebar.showMoreSessions", {
                  count: Math.min(MAX_VISIBLE_PROJECT_SESSIONS, hiddenSessionCount),
                })}
              </button>
            )}
            {archivedGroupTree.length > 0 && (
              <button
                type="button"
                className="sidebar-project-tree-show-more sidebar-chats-archived-toggle"
                aria-expanded={showingArchived}
                onClick={() => setProjectsShowingArchived((current) => toggleId(current, group.projectRoot))}
              >
                {t(showingArchived ? "sidebar.hideArchivedChats" : "sidebar.showArchivedChats", {
                  count: archivedGroupTree.length,
                })}
              </button>
            )}
            {showingArchived && archivedGroupTree
              // The selected session is already listed above when it is archived.
              .filter((node) => !visibleGroupTree.includes(node))
              .map((node) => {
                const nodeFamily = sessionFamilies.find((family) => family.root.id === node.session.id);
                return (
                  <div key={node.session.id} className="sidebar-chats-archived-row">
                    <SessionFamilyItem
                      sessionsById={sessionsById}
                      node={node}
                      familySessions={nodeFamily ? [nodeFamily.root, ...nodeFamily.subagents] : undefined}
                      pinnedInk={pinnedSessions.has(node.session.id)}
                      selectedSessionId={selectedSessionId}
                      runningSessionIds={runningSessionIds}
                      unreadSessionIds={unreadSessionIds}
                      onSelectSession={handleSelectSessionFromList}
                      onRenamed={loadSessions}
                      archiveActions={sessionArchiveActions(node.session.id)}
                      onFork={forkSession}
                      onSessionDeleted={(id) => {
                        onSessionDeleted?.(id);
                        loadSessions();
                      }}
                    />
                  </div>
                );
              })}
          </div>
        ) : null}
      </div>
    );
  };

  const renderTimeline = () => (
    <div className="sidebar-project-timeline">
      {timelineFamilies.map((family) => {
        const node = timelineRootNodes.get(family.root.id);
        if (!node) return null;
        const projectRoot = family.root.projectRoot ?? family.root.cwd;
        const projectName = projectDisplayNames.get(projectRoot)
          ?? getProjectDisplayName(projectRoot, activeProjectRoots);
        const familySessions = [family.root, ...family.subagents];
        return (
          <SessionFamilyItem
            sessionsById={sessionsById}
            key={family.root.id}
            node={node}
            familySessions={familySessions}
            pinnedInk={pinnedSessions.has(family.root.id)}
            subtitle={projectName}
            archiveActions={sessionArchiveActions(family.root.id)}
            onFork={forkSession}
            selectedSessionId={selectedSessionId}
            runningSessionIds={runningSessionIds}
            unreadSessionIds={unreadSessionIds}
            onSelectSession={handleSelectSessionFromList}
            onRenamed={loadSessions}
            onSessionDeleted={(id) => {
              onSessionDeleted?.(id);
              loadSessions();
            }}
          />
        );
      })}
    </div>
  );

  const closeProjectViewMenu = () => {
    setProjectViewMenuOpen(false);
    setProjectViewMenuPos(null);
    setProjectViewMenuAnchor(null);
  };

  const changeProjectViewMode = (mode: ProjectViewMode) => {
    setProjectViewMode(mode);
    setPref(APP_PREF_KEYS.projectViewMode, mode);
    closeProjectViewMenu();
  };

  const collapseAllProjects = () => {
    setCollapsedProjects(new Set(activeProjectRoots));
    setProjectSessionPages({});
    closeProjectViewMenu();
  };

  const expandAllProjects = () => {
    setCollapsedProjects(new Set());
    closeProjectViewMenu();
  };

  const closeChatsMenu = () => {
    setChatsMenuOpen(false);
    setChatsMenuPos(null);
  };

  const openChatsDomMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = 216;
    const estimatedHeight = 96;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    const top = rect.bottom + 4 + estimatedHeight > window.innerHeight - 8
      ? Math.max(8, rect.top - estimatedHeight - 4)
      : rect.bottom + 4;
    setChatsMenuPos({ top, left });
    setChatsMenuOpen(true);
  };

  const toggleChatsMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (chatsMenuOpen && chatsMenuPos) {
      closeChatsMenu();
      return;
    }
    if (chatsMenuOpen) return;
    closeProjectViewMenu();
    const anchor = event.currentTarget;
    if (!canUseNativeMenu()) {
      openChatsDomMenu(anchor);
      return;
    }
    const entries: NativeMenuEntry[] = [
      {
        label: t("sidebar.collapseChats"),
        disabled: chatsCollapsed,
        onSelect: () => setChatsFolded(true),
      },
      {
        label: t("sidebar.expandChats"),
        disabled: !chatsCollapsed,
        onSelect: () => setChatsFolded(false),
      },
    ];
    setChatsMenuOpen(true);
    setChatsMenuPos(null);
    void showNativeMenu(entries, menuPointBelow(anchor, "right")).then((shown) => {
      if (shown) {
        setChatsMenuOpen(false);
        return;
      }
      openChatsDomMenu(anchor);
    });
  };

  const openProjectViewDomMenu = (anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const width = 216;
    const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    setProjectViewMenuPos({ top: rect.bottom + 4, left });
    setProjectViewMenuAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
    setProjectViewMenuOpen(true);
  };

  const toggleProjectViewMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (projectViewMenuOpen && projectViewMenuPos) {
      closeProjectViewMenu();
      return;
    }
    if (projectViewMenuOpen) return;
    closeChatsMenu();
    setProjectMenu(null);
    setProjectMenuPos(null);
    const anchor = event.currentTarget;
    const controlsDisabled = projectViewMode !== "grouped";
    if (!canUseNativeMenu()) {
      openProjectViewDomMenu(anchor);
      return;
    }
    const entries: NativeMenuEntry[] = [
      {
        label: t("sidebar.projectViewGrouped"),
        checked: projectViewMode === "grouped",
        onSelect: () => changeProjectViewMode("grouped"),
      },
      {
        label: t("sidebar.projectViewTimeline"),
        checked: projectViewMode === "timeline",
        onSelect: () => changeProjectViewMode("timeline"),
      },
      { kind: "separator" },
      {
        label: t("sidebar.collapseAllProjects"),
        disabled: controlsDisabled || !canCollapseAllProjects,
        onSelect: collapseAllProjects,
      },
      {
        label: t("sidebar.expandAllProjects"),
        disabled: controlsDisabled || !canExpandAllProjects,
        onSelect: expandAllProjects,
      },
    ];
    setProjectViewMenuOpen(true);
    setProjectViewMenuPos(null);
    void showNativeMenu(entries, menuPointBelow(anchor, "right")).then((shown) => {
      if (shown) {
        setProjectViewMenuOpen(false);
        return;
      }
      openProjectViewDomMenu(anchor);
    });
  };

  return (
    <div className="session-sidebar" style={{ display: "flex", flexDirection: "column", flex: "1 1 0%", minHeight: 0, height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        className={`session-sidebar-header${desktopPlatform === "macos" ? " session-sidebar-header--mac-inset" : ""}`}
        data-tauri-drag-region={desktopPlatform ? "deep" : undefined}
        {...windowDrag}
        style={{
          padding: "12px 10px 10px",
          borderBottom: "var(--hairline) solid var(--border)",
          flexShrink: 0,
        }}
      >
        {/* Window-chrome controls row: right-aligned (theme + collapse). On
            macOS the native traffic lights share the row's 48px centre line. */}
        {headerControls && (
          <div className="sidebar-controls-row">
            {headerControls}
          </div>
        )}

        {/* Row 1: New Session — full-width flat row, Claude Desktop style */}
        <button
          className="sidebar-header-row sidebar-new-row"
          onClick={() => handleNewSession()}
          disabled={!selectedCwd && !chatWorkspaceCwd}
          title={
            selectedCwd
              ? `${selectedCwdIsChat
                ? t("sidebar.newChatTitle")
                : t("sidebar.newSessionTitle", { path: selectedCwd })} (⌘/Ctrl+N)`
              : chatWorkspaceCwd
                ? t("sidebar.newChatTitle")
                : t("sidebar.selectProject")
          }
        >
          <span className="sidebar-new-plus" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="1.5" x2="6" y2="10.5" />
              <line x1="1.5" y1="6" x2="10.5" y2="6" />
            </svg>
          </span>
          {t("sidebar.newChat")}
        </button>

        {onOpenTasks && <TasksSidebarRow active={tasksOpen} runningCount={runningSessionIds.size} onOpen={onOpenTasks} />}
        {onOpenScheduled && <ScheduledSidebarRow active={scheduledOpen} onOpen={onOpenScheduled} />}
        {onOpenArtifacts && <ArtifactsSidebarRow active={artifactsOpen} onOpen={onOpenArtifacts} />}
      </div>
{/* Session search — keeps the original sidebar search styling and
          narrows the project tree to matching titles / first messages. Enter is
          the confirmation for the server-side content search across every
          session; there is no mode button, so Escape (or the clear button) is
          the way back to the title filter. */}
      <div className="sidebar-search-wrap" data-no-drag data-tauri-drag-region={desktopPlatform ? "false" : undefined}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sidebar-search-icon">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          className="sidebar-search-input"
          value={sessionQuery}
          onChange={(e) => setSessionQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // Committing an IME candidate must not fire the search.
              if (isImeComposing(e) || !sessionQuery.trim()) return;
              e.preventDefault();
              setContentSearch(true);
              return;
            }
            if (e.key === "Escape" && !isImeComposing(e)) {
              e.stopPropagation();
              // Content results first, then the query, then the field itself.
              if (contentSearch) setContentSearch(false);
              else if (sessionQuery) setSessionQuery("");
              else e.currentTarget.blur();
            }
          }}
          title={t("sidebar.searchAllHint")}
          placeholder={t("sidebar.searchSessions")}
          aria-label={t("sidebar.searchSessions")}
        />
        {sessionQuery && (
          <button
            type="button"
            className="sidebar-search-clear"
            onClick={() => {
              setSessionQuery("");
              setContentSearch(false);
            }}
            title={t("sidebar.clearSearch")}
            aria-label={t("sidebar.clearSearch")}
          >
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <line x1="2" y1="2" x2="8" y2="8" />
              <line x1="8" y1="2" x2="2" y2="8" />
            </svg>
          </button>
        )}
      </div>
      {/* Chats sit beside Projects: the same session model and event stream,
          but a model-only workspace that never enters project grouping. */}
      <SessionSearch
        open={contentSearch}
        query={sessionQuery}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSessionFromList}
      >
      <div
        ref={listScrollRef}
        className="sidebar-project-tree"
        role="tree"
        aria-label={`${t("sidebar.chats")} / ${t("sidebar.projects")}`}
        onScroll={handleListScroll}
      >
        <div className={`sidebar-project-tree-header sidebar-chats-header${chatsMenuOpen ? " is-menu-open" : ""}`}>
          <button
            type="button"
            className="sidebar-chats-title"
            data-sidebar-tree-row
            aria-expanded={!chatsFolded}
            title={t(chatsFolded ? "sidebar.expandChats" : "sidebar.collapseChats")}
            onClick={() => setChatsFolded(!chatsCollapsed)}
          >
            <span className="sidebar-project-tree-title">{t("sidebar.chats")}</span>
            {/* A folded section hides its rows, so the count and any running or
                unread chips stay readable on the header, like a project's. */}
            {chatFamilies.length > 0 && (
              <span className="sidebar-project-tree-count" title={t("sidebar.sessionCount", { count: chatFamilies.length })}>
                ({chatFamilies.length})
              </span>
            )}
            <span className="sidebar-project-tree-meta">
              {chatRunningCount > 0 && (
                <span className="sidebar-project-tree-chip is-running" title={t("sidebar.runningCount", { count: chatRunningCount })}>
                  {chatRunningCount}
                </span>
              )}
              {chatUnreadCount > 0 && (
                <span className="sidebar-project-tree-chip is-unread" title={t("sidebar.unreadCount", { count: chatUnreadCount })}>
                  {chatUnreadCount}
                </span>
              )}
            </span>
          </button>
          <div className="sidebar-project-tree-tools">
            <button
              ref={chatsMenuButtonRef}
              type="button"
              className={`sidebar-project-tree-menu${chatsMenuOpen ? " is-open" : ""}`}
              title={t("sidebar.chatsMenu")}
              aria-label={t("sidebar.chatsMenu")}
              aria-haspopup="menu"
              aria-expanded={chatsMenuOpen}
              onClick={toggleChatsMenu}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
            <button
              type="button"
              className="sidebar-project-tree-add"
              onClick={() => handleNewSession(chatWorkspaceCwd ?? undefined, "chat")}
              disabled={!chatWorkspaceCwd}
              title={t("sidebar.newChatTitle")}
              aria-label={t("sidebar.newChatTitle")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>
        {!chatsFolded && (
        <div className="sidebar-project-tree-children sidebar-chats-list">
          {visibleChatFamilies.map((family) => (
            <Fragment key={family.root.id}>{renderChatFamily(family)}</Fragment>
          ))}
          {!loading && !error && chatFamilies.length === 0 && (
            <div className="sidebar-chats-empty">
              {trimmedSessionQuery ? t("sidebar.noMatchingSessions") : t("sidebar.noChats")}
            </div>
          )}
          {hiddenChatFamilyCount > 0 && (
            <button
              type="button"
              className="sidebar-project-tree-show-more"
              onClick={() => setChatSessionPages((pages) => pages + 1)}
            >
              {t("sidebar.showMoreSessions", {
                count: Math.min(MAX_VISIBLE_CHAT_SESSIONS, hiddenChatFamilyCount),
              })}
            </button>
          )}
          {archivedChatFamilies.length > 0 && (
            <button
              type="button"
              className="sidebar-project-tree-show-more sidebar-chats-archived-toggle"
              aria-expanded={showArchivedChats}
              onClick={() => setShowArchivedChats((open) => !open)}
            >
              {t(showArchivedChats ? "sidebar.hideArchivedChats" : "sidebar.showArchivedChats", {
                count: archivedChatFamilies.length,
              })}
            </button>
          )}
          {showArchivedChats && archivedChatFamilies.map((family) => (
            <div key={family.root.id} className="sidebar-chats-archived-row">
              {renderChatFamily(family)}
            </div>
          ))}
        </div>
        )}

        <div className={`sidebar-project-tree-header${projectViewMenuOpen ? " is-menu-open" : ""}`}>
          <button
            type="button"
            className="sidebar-chats-title"
            data-sidebar-tree-row
            aria-expanded={!projectsSectionFolded}
            title={t(projectsSectionFolded ? "sidebar.expandProjectsSection" : "sidebar.collapseProjectsSection")}
            onClick={() => writeProjectsSectionCollapsed(!projectsSectionCollapsed)}
          >
            <span className="sidebar-project-tree-title">{t("sidebar.projects")}</span>
            {/* Count active project groups, not sessions or archived projects. */}
            <span className="sidebar-project-tree-count">({activeProjects.length})</span>
          </button>
          <div className="sidebar-project-tree-tools">
            <button
              ref={projectViewMenuButtonRef}
              type="button"
              className={`sidebar-project-tree-menu${projectViewMenuOpen ? " is-open" : ""}`}
              title={t("sidebar.projectViewMenu")}
              aria-label={t("sidebar.projectViewMenu")}
              aria-haspopup="menu"
              aria-expanded={projectViewMenuOpen}
              onClick={toggleProjectViewMenu}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
            <button
              type="button"
              className={`sidebar-project-tree-add${projectPickBusy ? " is-busy" : ""}`}
              onClick={() => handleAddProject()}
              disabled={projectPickBusy}
              aria-busy={projectPickBusy}
              title={t(projectPickBusy ? "sidebar.checkingFolder" : "sidebar.addProject")}
              aria-label={t("sidebar.addProject")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
        </div>
        {!projectsSectionFolded && (activeProjects.length === 0 && !(trimmedSessionQuery && archivedProjects.length > 0) ? (
          <div className="sidebar-project-tree-empty">
            {loading
              ? t("sidebar.loading")
              : error
                ? (
                  // A failed list load must not read as "no projects": that
                  // offers "Add project" as if the user's sessions were gone.
                  <div className="sidebar-empty-action" role="alert">
                    <span className="sidebar-empty-text" title={error}>{t("sidebar.loadFailed")}</span>
                    <button
                      type="button"
                      className="sidebar-empty-add"
                      onClick={() => void loadSessions(true, true)}
                    >
                      <span>{t("common.retry")}</span>
                    </button>
                  </div>
                )
              : trimmedSessionQuery
                ? t("sidebar.noMatchingSessions")
                : (
                  <div className="sidebar-empty-action">
                    <span className="sidebar-empty-text">{t("sidebar.noProjects")}</span>
                    <button
                      type="button"
                      className={`sidebar-empty-add${projectPickBusy ? " is-busy" : ""}`}
                      onClick={() => handleAddProject()}
                      disabled={projectPickBusy}
                      aria-busy={projectPickBusy}
                      title={t(projectPickBusy ? "sidebar.checkingFolder" : "sidebar.addProject")}
                      aria-label={t("sidebar.addProject")}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>{t("sidebar.addProject")}</span>
                    </button>
                  </div>
                )}
          </div>
        ) : projectViewMode === "timeline"
          ? renderTimeline()
          : activeProjects.map((group) => renderProjectGroup(group)))}
        {!projectsSectionFolded && archivedProjects.length > 0 && (
          <ArchivedProjectsSection
            count={archivedProjects.length}
            expanded={archiveShown}
            runningCount={archivedProjects.reduce((sum, group) => sum + group.runningIds.size, 0)}
            unreadCount={archivedProjects.reduce((sum, group) => sum + group.unreadIds.size, 0)}
            onToggle={() => setArchiveExpanded(!archiveExpanded)}
            t={t}
          >
            {archivedProjects.map((group) => renderProjectGroup(group, true))}
          </ArchivedProjectsSection>
        )}
      </div>
      </SessionSearch>
      {chatsMenuPop.mounted && shownChatsMenuPos && (
        <ChatsSectionMenu
          menuRef={chatsMenuRef}
          pos={shownChatsMenuPos}
          closing={chatsMenuPop.closing}
          onClose={closeChatsMenu}
          canCollapse={!chatsCollapsed}
          canExpand={chatsCollapsed}
          onCollapse={() => {
            setChatsFolded(true);
            closeChatsMenu();
          }}
          onExpand={() => {
            setChatsFolded(false);
            closeChatsMenu();
          }}
        />
      )}
      {projectViewMenuPop.mounted && shownProjectViewMenuPos && (
        <ProjectViewMenu
          menuRef={projectViewMenuRef}
          pos={shownProjectViewMenuPos}
          anchor={projectViewMenuAnchor}
          closing={projectViewMenuPop.closing}
          mode={projectViewMode}
          canCollapseAll={canCollapseAllProjects}
          canExpandAll={canExpandAllProjects}
          controlsDisabled={projectViewMode !== "grouped"}
          onModeChange={changeProjectViewMode}
          onCollapseAll={collapseAllProjects}
          onExpandAll={expandAllProjects}
          onClose={() => setProjectViewMenuPos(null)}
        />
      )}
      {projectPathHint && createPortal(
        <div
          className="sidebar-project-path-hint"
          aria-hidden="true"
          style={{ top: projectPathHint.top, left: projectPathHint.left, height: projectPathHint.height, maxWidth: `min(60vw, 640px, ${Math.max(0, window.innerWidth - projectPathHint.left - 8)}px)` }}
        >
          <PathLabel text={projectPathHint.root} style={{ lineHeight: 1 }} />
        </div>,
        document.body,
      )}
      {projectSessionsDelete && createPortal(
        <ChatConfirmDialog
          title={t("sidebar.deleteProjectSessionsHeading", { name: projectSessionsDelete.name })}
          subject={shortenPath(projectSessionsDelete.root)}
          body={projectSessionsDelete.kept > 0
            ? `${t("sidebar.deleteProjectSessionsMessage")} ${t("sidebar.deleteProjectSessionsRunning", { count: projectSessionsDelete.kept })}`
            : t("sidebar.deleteProjectSessionsMessage")}
          confirmLabel={t("sidebar.delete")}
          cancelLabel={t("sidebar.cancel")}
          danger
          busy={projectSessionsDeleting}
          error={projectSessionsDeleteError}
          onCancel={() => {
            if (projectSessionsDeleting) return;
            setProjectSessionsDelete(null);
            setProjectSessionsDeleteError(null);
          }}
          onConfirm={() => { void performProjectSessionsDelete(); }}
        />,
        document.body,
      )}
      {projectMenuPop.mounted && shownProjectMenu && shownProjectMenuPos && (
        <ProjectContextMenu
          menuRef={projectMenuRef}
          projectRoot={shownProjectMenu.root}
          pos={shownProjectMenuPos}
          anchor={shownProjectMenuAnchor}
          closing={projectMenuPop.closing}
          canReveal={isTauriDesktop() || fileManagerAvailability?.supported === true}
          revealLabel={revealProjectLabel}
          projectRevealError={projectRevealError}
          t={t}
          onClose={closeProjectMenu}
          onOpenTerminal={onOpenTerminal ? () => {
            const cwd = shownProjectMenu.root;
            closeProjectMenu();
            onOpenTerminal(cwd);
          } : undefined}
          onReveal={() => void revealProjectInFileManager(shownProjectMenu.root)}
          archived={shownProjectMenu.archived === true}
          onArchive={() => archiveProject(shownProjectMenu.root)}
          onRestore={() => restoreProject(shownProjectMenu.root)}
          pinned={pinnedProjects.has(shownProjectMenu.root)}
          onTogglePin={() => {
            const root = shownProjectMenu.root;
            closeProjectMenu();
            void pins.toggleProjectPin(root);
          }}
          deleteSessionsCount={projectSessionsToDelete(shownProjectMenu.root).ids.length}
          onDeleteSessions={() => {
            const root = shownProjectMenu.root;
            closeProjectMenu();
            requestProjectSessionsDelete(root);
          }}
        />
      )}
      {continueChat && (
        <div className="project-picker-modal-overlay" role="dialog" aria-modal="true" aria-label={t("sidebar.continueInProject")} onClick={() => setContinueChat(null)}>
          <div className="project-picker-modal-shell" onClick={(e) => e.stopPropagation()}>
            <ProjectPicker
              recentProjects={recentProjects}
              selectedCwd={null}
              selectedProject={null}
              homeDir={homeDir}
              onSelectCwd={(cwd) => void continueChatInProject(continueChat, cwd)}
              variant="block"
            />
          </div>
        </div>
      )}
      {/*
     * The web "Add project" window: the app's overlay and panel, animated by the shared
     * modal keyframes in app/native-theme.css, listing folders only (a project is a
     * folder), starting at the current project, and answering with a path on this
     * computer. Cancel fades the window out and adopts nothing.
     */}
    {projectFolderOpen && (
      <DirectoryPicker
        title={t("sidebar.chooseFolderTitle")}
        initialPath={selectedCwd || homeDir || undefined}
        busy={projectPickBusy}
        error={projectPickError}
        onSelect={(cwd) => void handleProjectFolderSelect(cwd)}
        onCancel={() => {
          setProjectFolderOpen(false);
          setProjectPickError(null);
        }}
      />
    )}

    {projectPickerOpen && (
        <div className="project-picker-modal-overlay" role="dialog" aria-modal="true" onClick={() => setProjectPickerOpen(false)}>
          <div className="project-picker-modal-shell" onClick={(e) => e.stopPropagation()}>
            <ProjectPicker
              recentProjects={recentProjects}
              selectedCwd={selectedCwdProp && !isChatCwd(selectedCwdProp) ? selectedCwdProp : null}
              selectedProject={selectedProjectRoot}
              homeDir={homeDir}
              onSelectCwd={(cwd) => {
                activateProject(cwd);
                setProjectPickerOpen(false);
              }}
              variant="block"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SessionFamilyItem({
  node,
  depth = 0,
  selectedSessionId,
  runningSessionIds,
  unreadSessionIds,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onContinueInProject,
  chatActions,
  archiveActions,
  onFork,
  familySessions,
  sideFamily,
  subtitle,
  sessionsById,
  pinnedInk = false,
}: {
  node: SessionTreeNode;
  familySessions?: SessionInfo[];
  /** The family's root is pinned. A subagent run or a side chat is its parent's
   *  work, not a row of its own, so every row under a pinned parent wears the
   *  parent's pinned ink; under an unpinned parent they step back a step further
   *  than a plain row. Set from the pinned set at the root and inherited below. */
  pinnedInk?: boolean;
  /** Every listed session, to name a fork's source in its row's tooltip (#237). */
  sessionsById?: ReadonlyMap<string, SessionInfo>;
  /** C1: the family a side chat row is numbered in, as its tab and the Agents panel number it. */
  sideFamily?: SessionInfo[];
  depth?: number;
  selectedSessionId: string | null;
  runningSessionIds: Set<string>;
  unreadSessionIds: Set<string>;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  /** Chats only: copy the conversation into a project. */
  onContinueInProject?: (session: SessionInfo) => void;
  /** Chats only: pin and archive, which the row menu offers beside the other actions. */
  chatActions?: ChatRowActions;
  /** Project sessions: archive or restore this session (#200). */
  archiveActions?: SessionArchiveActions;
  /** Project sessions: copy the current branch into a new session (S4). */
  onFork?: (session: SessionInfo) => void;
  /** Cross-project context, shown by the chronological sidebar view. */
  subtitle?: string;
}) {
  const { t } = useI18n();
  // Subagent runs and side chats start folded under their row; the rows the
  // user unfolds are remembered (#237). Folded, the row still carries their
  // running and selected state (familySessions) and shows how many there are.
  const expandedRows = useSyncExternalStore(subscribeExpandedSubagentRows, readExpandedSubagentRows, serverExpandedSubagentRows);
  const hasChildren = node.children.length > 0;
  const collapsed = hasChildren && !expandedRows.has(node.session.id);
  const childCount = hasChildren ? countTreeDescendants(node) : 0;
  // A delegated run of this row's family that is live right now: the row's fold
  // toggle breathes with the header's running bucket, while a live side chat (a
  // conversation the user drives) keeps the glyph at rest.
  const runningChildren = hasChildren ? countRunningSubagentRuns(node, runningSessionIds) : 0;
  const selectedInChildren = Boolean(selectedSessionId)
    && node.session.id !== selectedSessionId
    && treeContainsSession(node, selectedSessionId!);
  // A selected subagent (opened from the Agents panel, a link, a restore) must
  // be visible in the tree: unfold the rows above it.
  useEffect(() => {
    if (collapsed && selectedInChildren) setSubagentRowExpanded(node.session.id, true);
  }, [collapsed, node.session.id, selectedInChildren]);
  const forkOriginId = node.session.relation?.kind === "fork"
    ? node.session.relation.originSessionId ?? node.session.parentSessionId
    : undefined;
  const forkOrigin = forkOriginId ? sessionsById?.get(forkOriginId) : undefined;

  return (
    <div
      className="session-tree-item"
      data-session-depth={depth}
      aria-level={depth + 1}
      style={depth > 0 ? { marginLeft: depth * 30 } : undefined}
    >
      <div style={{ position: "relative" }}>
        <SessionItem
          session={node.session}
          isSubagentChild={Boolean(node.session.relation?.kind === "subagent")}
          isSideChat={node.session.relation?.kind === "side"}
          pinnedInk={pinnedInk}
          isSelected={familySessions
            ? familySessions.some((session) => session.id === selectedSessionId)
            : node.session.id === selectedSessionId}
          isRunning={familySessions
            ? familySessions.some((session) => runningSessionIds.has(session.id))
            : runningSessionIds.has(node.session.id)}
          isUnread={unreadSessionIds.has(node.session.id)}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          onContinueInProject={depth === 0 ? onContinueInProject : undefined}
          chatActions={depth === 0 ? chatActions : undefined}
          archiveActions={depth === 0 ? archiveActions : undefined}
          onFork={depth === 0 ? onFork : undefined}
          sideTitle={node.session.relation?.kind === "side" ? sideChatTitle(node.session, t("sideChat.title"), sideFamily ?? familySessions ?? []) : undefined}
          hasChildren={hasChildren}
          childCount={childCount}
          childrenRunningCount={runningChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setSubagentRowExpanded(node.session.id, collapsed)}
          isFork={node.session.relation?.kind === "fork"}
          forkSourceTitle={forkOrigin ? sessionRowTitle(forkOrigin) : undefined}
          subtitle={subtitle}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionFamilyItem
              key={child.session.id}
              node={child}
              depth={depth + 1}
              selectedSessionId={selectedSessionId}
              runningSessionIds={runningSessionIds}
              unreadSessionIds={unreadSessionIds}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              sideFamily={sideFamily ?? familySessions}
              subtitle={subtitle}
              sessionsById={sessionsById}
              pinnedInk={pinnedInk}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg className="session-running-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <path
          d="M21 12a9 9 0 1 1-3.8-7.4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle className="session-unread-ring" cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" opacity="0.32" />
      </svg>
    </span>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: "var(--fs-micro)", fontFamily: "var(--font-mono)" }}
        >
          <svg className="session-running-spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
            <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0891b2", fontSize: "var(--fs-micro)", fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

interface SessionArchiveActions {
  archived: boolean;
  onToggleArchive: () => void;
  /** S2: a project session can be pinned like a chat; absent where a row offers no pin. */
  pinned?: boolean;
  onTogglePin?: () => void;
}

interface ChatRowActions extends SessionArchiveActions {
  pinned: boolean;
  onTogglePin: () => void;
}

function SessionItem({
  session,
  isSelected,
  isRunning,
  isUnread,
  onClick,
  onRenamed,
  onDeleted,
  onContinueInProject,
  chatActions,
  archiveActions,
  onFork,
  sideTitle,
  hasChildren = false,
  childCount = 0,
  childrenRunningCount = 0,
  collapsed = false,
  onToggleCollapse,
  isSubagentChild = false,
  isSideChat = false,
  pinnedInk = false,
  isFork = false,
  forkSourceTitle,
  subtitle,
}: {
  session: SessionInfo;
  isSelected: boolean;
  isRunning?: boolean;
  isUnread?: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  onContinueInProject?: (session: SessionInfo) => void;
  chatActions?: ChatRowActions;
  archiveActions?: SessionArchiveActions;
  onFork?: (session: SessionInfo) => void;
  /** C1: a side chat's numbered name ("Side chat 2") while it has none of its own. */
  sideTitle?: string;
  hasChildren?: boolean;
  /** Subagent runs and side chats below this row, shown beside its fold toggle. */
  childCount?: number;
  /** How many of those are live subagent runs: the toggle's head breathes with the
   *  header's running bucket, and its tooltip says how many. */
  childrenRunningCount?: number;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  isSubagentChild?: boolean;
  /** A side chat forked off a session: the composer's side-chat glyph, not the
   *  plain chat bubble, so the numbered "Side chat 2" row is recognisable. */
  isSideChat?: boolean;
  /** This row wears the pinned ink — its own pin, or a pinned parent's (a
   *  subagent run is pinned with the session that delegated it). */
  pinnedInk?: boolean;
  /** A fork: a row of its own, with the fork glyph instead of the chat bubble. */
  isFork?: boolean;
  /** The fork's source session, named in the row's tooltip when it is listed. */
  forkSourceTitle?: string;
  /** Cross-project context; omitted inside the project tree where the group already names it. */
  subtitle?: string;
}) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  // Coarse pointers have no hover: the "…" action menu must be permanently
  // visible there, otherwise rename/delete are unreachable on touch.
  const [touchMode, setTouchMode] = useState(false);
  // Downstream hook (extensions/desktop) may claim the row's context menu;
  // when it handles the event the built-in menu never opens.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Folder-owning chats add the optional Trash checkbox to the shared confirmation.
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  // The row's "…" menu is held for the shared exit animation (hooks/usePopTransition.ts),
  // at the spot it opened at, so it leaves the way it came.
  const menuPop = usePopTransition(menuOpen);
  const shownMenuPos = useShownWhileClosing(menuPos, menuPop.closing);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [treeFocused, setTreeFocused] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  useEffect(() => {
    setTouchMode(window.matchMedia?.("(hover: none)").matches ?? false);
  }, []);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = sideTitle ?? (session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));

  const startRename = useCallback(() => {
    if (session.transient) return;
    setRenameValue(session.name ?? "");
    setRenaming(true);
  }, [session.name, session.transient]);

  const beginDeleteConfirmation = useCallback(() => {
    if (session.transient) return;
    setDeleteError(null);
    if (session.chatFolder) setFolderDeleteOpen(true);
    else setConfirmDelete(true);
  }, [session.chatFolder, session.transient]);

  const reportActionError = useCallback((message: string) => {
    appNotify.error({ message });
  }, []);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      onRenamed?.();
    } catch (e) {
      reportActionError(t("sidebar.renameFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  }, [renameValue, session.id, session.name, onRenamed, reportActionError, t, title]);

  const performDelete = useCallback(async (trashChatFolder = false) => {
    if (session.transient) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(session.id)}${trashChatFolder ? "?chatFolder=trash" : ""}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setConfirmDelete(false);
      setFolderDeleteOpen(false);
      onDeleted?.(session.id);
    } catch (e) {
      setDeleting(false);
      const message = t("sidebar.deleteFailed", { error: e instanceof Error ? e.message : String(e) });
      if (confirmDelete || folderDeleteOpen) setDeleteError(message);
      else reportActionError(message);
    }
  }, [session.id, session.transient, onDeleted, reportActionError, t, confirmDelete, folderDeleteOpen]);

  const archive: SessionArchiveActions | undefined = chatActions ?? archiveActions;
  // Chats always offer a pin; a project session does when its list passes one (S2).
  const pin = useMemo(
    () => (archive?.onTogglePin ? { pinned: archive.pinned === true, onTogglePin: archive.onTogglePin } : undefined),
    [archive],
  );

  // "…" menu: fixed-position portal so the sidebar's overflow/backdrop-filter can't clip it
  const MENU_WIDTH = 190;
  // Desktop shell: the same actions as the DOM menu below, as a native popup.
  // `menuOpen` stays true while it is up so the trailing "…" button does not
  // swap back to the timestamp; `menuPos` stays null, so no DOM menu renders.
  const showNativeSessionMenu = useCallback(async (at: NativeMenuPoint): Promise<boolean> => {
    if (session.transient || !canUseNativeMenu()) return false;
    setMenuOpen(true);
    const shown = await showNativeMenu([
      { label: t("sidebar.rename"), onSelect: startRename },
      ...(onFork ? [{ label: t("sidebar.fork"), onSelect: () => onFork(session) }] : []),
      ...(pin
        ? [{ label: t(pin.pinned ? "sidebar.unpinChat" : "sidebar.pinChat"), onSelect: pin.onTogglePin }]
        : []),
      ...(onContinueInProject
        ? [{ label: t("sidebar.continueInProject"), onSelect: () => onContinueInProject(session) }]
        : []),
      ...(archive
        ? [{ label: t(archive.archived ? "sidebar.unarchiveChat" : "sidebar.archiveChat"), onSelect: archive.onToggleArchive }]
        : []),
      { label: t("sidebar.delete"), onSelect: beginDeleteConfirmation },
      { kind: "separator" },
      {
        label: `${formatRelativeTime(session.modified, locale)} · ${t("sidebar.messagesCount", { count: session.messageCount })}`,
        disabled: true,
      },
      ...((session.compactionCount ?? 0) > 0
        ? [{ label: t("sidebar.compactionCount", { count: session.compactionCount ?? 0 }), disabled: true }]
        : []),
      ...(session.worktreeBranch ? [{ label: session.worktreeBranch, disabled: true }] : []),
    ], at);
    setMenuOpen(false);
    return shown;
  }, [archive, beginDeleteConfirmation, onContinueInProject, onFork, pin, session, locale, startRename, t]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Replace the webview's own context menu (Reload / Inspect) with the row's actions.
    if (isTauriDesktop() && !session.transient) {
      // Suppresses the webview menu (Reload / Inspect); the row actions open
      // natively only while native popups are on, otherwise via the "…" button.
      e.preventDefault();
      e.stopPropagation();
      void showNativeSessionMenu({ x: e.clientX, y: e.clientY });
    }
  }, [onRenamed, session.cwd, session.id, session.name, session.path, session.transient, showNativeSessionMenu]);

  const toggleMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (menuOpen) { setMenuOpen(false); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const openDomMenu = () => {
      const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
      setMenuPos({ top: rect.bottom + 4, left });
      // The menu measures itself and flips above the row when the space below
      // is too small, so the delete entry stays reachable.
      setMenuAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
      setMenuOpen(true);
    };
    if (canUseNativeMenu()) {
      void showNativeSessionMenu(menuPointBelow(e.currentTarget)).then((shown) => {
        if (!shown) openDomMenu();
      });
      return;
    }
    openDomMenu();
  }, [menuOpen, showNativeSessionMenu]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (menuButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !isImeComposing(ev)) setMenuOpen(false); };
    // A row's menu is anchored inside the sidebar's own scroll pane, so that pane moving
    // detaches it. The chat pane streaming is not: it closed this menu a second after open.
    const onScroll = (ev: Event) => {
      if (scrollMovesAnchor(ev.target, menuButtonRef.current)) setMenuOpen(false);
    };
    const onScrollOrResize = () => setMenuOpen(false);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [menuOpen]);

  // The menu's real height decides whether it opens downward or upward.
  // Keyed to the mounted flag, so the closing menu keeps the spot it was placed in.
  const placedMenuPos = useMenuPlacement(menuPop.mounted ? menuAnchor : null, menuRef);

  // The fold toggle's name: the count it folds, plus how many of them are live, so a
  // breathing head is also said to a screen reader.
  const childToggleLabel = [
    t(collapsed ? "sidebar.expandSubagentsCount" : "sidebar.collapseSubagentsCount", { count: childCount }),
    childrenRunningCount > 0 ? t("chat.subagentsRunning", { running: childrenRunningCount }) : null,
  ].filter(Boolean).join(" · ");


  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <div
      ref={rowRef}
      className={`session-item${isSelected ? " is-selected" : ""}${isRunning ? " is-running" : ""}${isUnread ? " is-unread" : ""}${isSubagentChild ? " is-subagent-child" : ""}${isSideChat ? " is-side-chat" : ""}${pinnedInk ? " is-pinned" : ""}`}
      data-sidebar-tree-row
      tabIndex={0}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={hasChildren ? !collapsed : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setTreeFocused(false);
      }}
      onClick={confirmDelete || renaming ? undefined : onClick}
      onKeyDown={(e) => handleSidebarTreeKeyDown(e, {
        activate: () => {
          if (!confirmDelete && !renaming) onClick();
        },
        expand: () => {
          if (hasChildren && collapsed) onToggleCollapse?.();
        },
        collapse: () => {
          if (hasChildren && !collapsed) onToggleCollapse?.();
        },
        rename: startRename,
        requestDelete: beginDeleteConfirmation,
      })}
      onContextMenu={confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => {
        setHovered(true);
        if (!isRunning && !isSelected) prefetchSessionData(session.id);
      }}
      onPointerDown={() => {
        if (!isRunning && !isSelected) prefetchSessionData(session.id);
      }}
      onFocus={() => setTreeFocused(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: SESSION_LIST_ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: 11,
        paddingRight: 8,
        cursor: renaming ? "default" : "pointer",
        background: isSelected ? "var(--bg-selected)" : (hovered || treeFocused || menuOpen) ? "var(--bg-hover)" : "transparent",
        borderLeft: isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background var(--dur-fast) var(--ease-native)",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (isImeComposing(e)) return;
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: "var(--fs-caption)",
            padding: "3px 8px",
            border: "var(--hairline) solid var(--accent)",
            borderRadius: "var(--radius-sm)",
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 26,
          }}
        />
      ) : (
        /* ── Normal view: single line — leading icon + title + "…" menu ── */
        <>
          {/* Leading icon: running / unread, falling back to the standard
              chat-bubble glyph for every session. Subagent child rows carry
              the robot glyph, side chats the app's side-chat bubble (a square
              bubble with a plus, its tail at the left) — the same mark the
              composer's own side-chat button uses, from
              components/SideChatIcon.tsx. */}
          {isRunning ? (
            <RunningSessionIndicator />
          ) : isUnread ? (
            <UnreadSessionIndicator />
          ) : isSideChat ? (
            <SideChatPlusIcon size={12} stroke="currentColor" className="session-item-child-glyph" style={{ flexShrink: 0 }} />
          ) : isSubagentChild ? (
            /* The child row's own mark, in currentColor: this theme's --accent IS
               its --text, so an accent glyph on a stepped-back row is the hardest
               thing in it. `--child-ink` (app/native-theme.css) colours the glyph
               and the title together. */
            <svg className="session-item-child-glyph" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <rect x="5" y="7" width="14" height="11" rx="2" />
              <path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
            </svg>
          ) : (
            <svg className="session-item-glyph" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          )}
          {/* A pinned session is marked by its title's ink and by nothing else:
              the row's trailing edge already carries the fork mark, the children
              count and the hover "…". A nested row has no pin of its own, so it
              wears the family's: `pinnedInk` is set for every row under a pinned
              parent, and the row's leading glyph takes the same ink. */}
          <span
            className={`session-item-title${pin?.pinned || pinnedInk ? " is-pinned" : ""}`}
            title={[
              subtitle ? `${title} · ${subtitle}` : title,
              pin?.pinned ? t("sidebar.pinned") : null,
              isSideChat ? t("sideChat.title") : null,
              isFork ? (forkSourceTitle ? t("sidebar.forkedFrom", { title: forkSourceTitle }) : t("sidebar.forkRow")) : null,
            ].filter(Boolean).join("\n")}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "var(--fs-body)",
              fontWeight: "var(--fw-regular)",
              lineHeight: 1.4,
              color: "var(--text)",
            }}
          >
            {title}
          </span>
          {subtitle && (
            <span className="session-item-project" title={subtitle}>
              {subtitle}
            </span>
          )}

          {/* A fork is marked at the row's end, just left of the subagent count it
              sits under — the row's left edge stays the plain chat bubble, so a
              fork reads as a session that branched, not a different kind of row.
              The title tooltip keeps naming the source session. */}
          {isFork && (
            <svg
              className="session-item-glyph session-item-fork-glyph"
              aria-label={t("sidebar.forkRow")}
              role="img"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="6" cy="5" r="2" />
              <circle cx="18" cy="5" r="2" />
              <circle cx="12" cy="19" r="2" />
              <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
            </svg>
          )}

          {/* Fold toggle for the subagent runs and side chats below: folded
              by default, with their count so a folded row says what it holds (#237).
              While a delegated run of this family is live, its head breathes — the
              same 1.6s cycle the header's running bucket and the composer's Stop use
              (`.agent-status-icon--pulse`), so "the family has work going" moves the
              same way in all three places. */}
          {hasChildren && (
            <button
              type="button"
              className={`session-item-children-toggle${collapsed ? " is-collapsed" : ""}${childrenRunningCount > 0 ? " is-running" : ""}`}
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={childToggleLabel}
              aria-label={childToggleLabel}
              aria-expanded={!collapsed}
            >
              {/* The family's head, at the row's icon scale: 14px, the same size a plain
                  row's leading bubble is. At 11px it was a smudge at the end of the
                  title — the count next to it read bigger than the mark. */}
              <svg className={`session-item-children-glyph${childrenRunningCount > 0 ? " agent-status-icon--pulse" : ""}`} aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="7" width="14" height="11" rx="2" />
                <path d="M9 11h.01M15 11h.01M12 7V4" />
              </svg>
              <span className="session-item-children-count">{childCount}</span>
              <svg className="session-item-children-chevron" aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Trailing slot: the row's last-activity time at rest, swapped in
              place for the "…" action button on hover (always the button on
              touch devices, which have no hover, and while its menu is open,
              since the pointer then sits on the portal). Transient runtime
              rows expose no disk-backed actions and have no reliable time.
              The time and the button share one grid cell and the time stays
              laid out (hidden) under the button, so the slot is as wide as the
              wider of the two: a long label ("19小时") never spills over the
              title, and the title never reflows on hover. */}
          {!session.transient && (
            <div
              className="session-item-trailing"
            >
              <span
                className="session-item-time"
                title={formatRelativeTime(session.modified, locale)}
                aria-hidden={hovered || treeFocused || touchMode || menuOpen ? true : undefined}
                style={{
                  fontSize: "var(--fs-micro)", lineHeight: 1, color: "var(--text-dim)",
                  whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                  paddingRight: 2,
                  visibility: hovered || treeFocused || touchMode || menuOpen ? "hidden" : undefined,
                }}
              >
                {formatCompactRelativeTime(session.modified, locale)}
              </span>
              {hovered || treeFocused || touchMode || menuOpen ? (
                <button
                  ref={menuButtonRef}
                  onClick={toggleMenu}
                  title={t("sidebar.moreActions")}
                  aria-label={t("sidebar.moreActions")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className={`session-item-more${menuOpen ? " is-open" : ""}`}
                >
                  <span className="session-item-more-icon" aria-hidden="true">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.7" />
                      <circle cx="12" cy="12" r="1.7" />
                      <circle cx="19" cy="12" r="1.7" />
                    </svg>
                  </span>
                </button>
              ) : null}
            </div>
          )}

          {menuPop.mounted && shownMenuPos && createPortal(
            <div
              ref={menuRef}
              className={`native-popover app-menu session-item-menu${menuPop.className}`}
              role="menu"
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                top: (placedMenuPos ?? shownMenuPos).top,
                left: (placedMenuPos ?? shownMenuPos).left,
                width: MENU_WIDTH, zIndex: 800, padding: 5,
                display: "flex", flexDirection: "column", gap: 1,
              }}
            >
              <button
                role="menuitem"
                onClick={() => { setMenuOpen(false); startRename(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", height: 30, padding: "0 8px",
                  background: "transparent", border: 0, borderRadius: "var(--radius-md)",
                  color: "var(--text)", cursor: "pointer",
                  fontSize: "var(--fs-body)", textAlign: "left",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
                {t("sidebar.rename")}
              </button>
              {onFork && (
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onFork(session); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", height: 30, padding: "0 8px",
                    background: "transparent", border: 0, borderRadius: "var(--radius-md)",
                    color: "var(--text)", cursor: "pointer",
                    fontSize: "var(--fs-body)", textAlign: "left",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" />
                    <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
                  </svg>
                  {t("sidebar.fork")}
                </button>
              )}
              {pin && (
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); pin.onTogglePin(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", height: 30, padding: "0 8px",
                    background: "transparent", border: 0, borderRadius: "var(--radius-md)",
                    color: "var(--text)", cursor: "pointer",
                    fontSize: "var(--fs-body)", textAlign: "left",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z" />
                  </svg>
                  {t(pin.pinned ? "sidebar.unpinChat" : "sidebar.pinChat")}
                </button>
              )}
              {onContinueInProject && (
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onContinueInProject(session); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", height: 30, padding: "0 8px",
                    background: "transparent", border: 0, borderRadius: "var(--radius-md)",
                    color: "var(--text)", cursor: "pointer",
                    fontSize: "var(--fs-body)", textAlign: "left",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
                  </svg>
                  {t("sidebar.continueInProject")}
                </button>
              )}
              {archive && (
                <button
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); archive.onToggleArchive(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", height: 30, padding: "0 8px",
                    background: "transparent", border: 0, borderRadius: "var(--radius-md)",
                    color: "var(--text)", cursor: "pointer",
                    fontSize: "var(--fs-body)", textAlign: "left",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <rect x="3" y="4" width="18" height="4" rx="1" />
                    <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
                  </svg>
                  {t(archive.archived ? "sidebar.unarchiveChat" : "sidebar.archiveChat")}
                </button>
              )}
              <button
                role="menuitem"
                className="is-danger"
                title={t("sidebar.deleteWithShiftClick")}
                onClick={(e) => {
                  setMenuOpen(false);
                  if (e.shiftKey) void performDelete();
                  else beginDeleteConfirmation();
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", height: 30, padding: "0 8px",
                  background: "transparent", border: 0, borderRadius: "var(--radius-md)",
                  color: "var(--danger)", cursor: "pointer",
                  fontSize: "var(--fs-body)", textAlign: "left",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
                {t("sidebar.delete")}
              </button>
              <div style={{ height: 1, margin: "4px 3px", background: "var(--border)" }} />
              <div style={{ padding: "3px 8px 5px", color: "var(--text-dim)", fontSize: "var(--fs-micro)", lineHeight: 1.6 }}>
                <div title={session.created}>
                  {formatRelativeTime(session.modified, locale)} · {t("sidebar.messagesCount", { count: session.messageCount })}
                </div>
                {(session.compactionCount ?? 0) > 0 && (
                  <div>{t("sidebar.compactionCount", { count: session.compactionCount ?? 0 })}</div>
                )}
                {session.worktreeBranch && (
                  <div title={`Worktree: ${session.cwd}`} style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--accent)", minWidth: 0 }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.worktreeBranch}</span>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )}

        </>
      )}
      {(confirmDelete || folderDeleteOpen) && createPortal(
        <ChatConfirmDialog
          title={t("sidebar.deleteChatTitle")}
          subject={title}
          body={t("sidebar.deleteChatBody")}
          checkboxLabel={folderDeleteOpen ? t("sidebar.deleteChatFolder") : undefined}
          checkboxDefault
          confirmLabel={t("sidebar.delete")}
          cancelLabel={t("sidebar.cancel")}
          danger
          busy={deleting}
          error={deleteError}
          onCancel={() => {
            setConfirmDelete(false);
            setFolderDeleteOpen(false);
            setDeleteError(null);
            rowRef.current?.focus({ preventScroll: true });
          }}
          onConfirm={(trashFolder) => {
            void performDelete(folderDeleteOpen && trashFolder);
          }}
        />,
        document.body,
      )}
    </div>
  );
}
