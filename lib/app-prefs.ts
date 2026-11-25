/**
 * Unified app preference storage. Backed by localStorage in both the web UI
 * and the Tauri WebView so prefs survive reloads. Theme is additionally mirrored
 * into the desktop app config dir (see `set_ui_theme`) so cold starts keep the
 * choice even if the local server port / origin changes.
 */

export const APP_PREF_KEYS = {
  theme: "pi-theme",
  fonts: "pi-fonts",
  locale: "pi-locale",
  soundEnabled: "pi-sound-enabled",
  quoteSelectionEnabled: "pi-quote-selection-enabled",
  sidebarWidth: "pi-sidebar-width",
  rightPanelWidth: "pi-right-panel-width",
  unreadSessionIds: "pi-web:unread-session-ids",
  /** Project roots moved to the sidebar's Archive group (see lib/archived-projects.ts). */
  archivedProjects: "pi-web:archived-projects",
  /** "1" while the sidebar Archive group is unfolded; folded by default. */
  archiveExpanded: "pi-web:archive-expanded",
  /** Sidebar Projects pane layout: grouped project tree or chronological sessions. */
  projectViewMode: "pi-web:project-view-mode",
  /** Project roots whose session list is folded in the sidebar tree. */
  collapsedProjects: "pi-web:collapsed-projects",
  /** Project root -> additional five-session pages shown past the preview cap. */
  expandedProjects: "pi-web:expanded-projects",
  /** "1" while the sidebar Chats section is folded. */
  collapsedChats: "pi-web:collapsed-chats",
  /** Session ids whose subagent / side chat rows the user unfolded (folded by default, #237). */
  expandedSubagentRows: "pi-web:expanded-subagent-rows",
  /** Projects header fold; independent of individual project/archive folds. */
  collapsedProjectsSection: "pi-web:collapsed-projects-section",
  /** Additional five-chat pages shown past the Chats preview cap. */
  chatSessionPages: "pi-web:chat-session-pages",
  /**
   * Migration source only, and nothing since: pins live on the server
   * (`lib/session-ui-state.ts`, read by `lib/sidebar-pins.ts`) so every browser
   * and device shows the same ones. The first sync pushes what an older build
   * kept here and deletes these keys (`hooks/useSidebarPins.ts`).
   */
  pinnedChats: "pi-web:pinned-chats",
  pinnedSessions: "pi-web:pinned-sessions",
  pinnedProjects: "pi-web:pinned-projects",
  /** "1" once this browser has pushed (or had nothing to push) its local pins. */
  pinsMigratedToServer: "pi-web:pins-migrated-to-server",
  /** "tree" shows the Git changes as folders (F2); anything else is the flat list. */
  changesViewMode: "pi-web:sidebar-changes-view-mode",
  /** Chat session ids hidden from the Chats section until "Show archived". */
  archivedChats: "pi-web:archived-chats",
  /** Project session ids hidden from their project until "Show archived" (#200). */
  archivedSessions: "pi-web:archived-sessions",
  updateSnooze: "pi-web:update-snooze",
  closeQuits: "pi-desktop-close-quits",
  notifyOnComplete: "pi-desktop-notify-on-complete",
  chatDrafts: "pi-chat-drafts-v1",
  /**
   * This browser's device id and the write tokens the composer-copy store handed
   * it (`lib/device-identity.ts`). The id is what makes two browsers on one Mac
   * two devices, and a token is the only thing that lets a device write its own
   * copy — it is never sent to another device.
   */
  deviceCopyIdentity: "pi-web:device-copy-identity",
  diffViewMode: "pi-diff-view-mode",
  /** Tasks page layout: "calendar" or the list (anything else). */
  tasksMode: "pi-web:tasks-mode",
  /** Tasks calendar range: "week" or "month". */
  tasksCalendarView: "pi-web:tasks-calendar-view",
  /** Tasks calendar filter: project keys and `type:*` keys switched off. */
  tasksCalendarHidden: "pi-web:tasks-calendar-hidden",
  /** The folder picker's remembered state: order, hidden folders, favourites, recents. */
  directoryPickerSort: "pi-web:directory-picker-sort",
  directoryPickerHidden: "pi-web:directory-picker-hidden",
  directoryPickerFavourites: "pi-web:directory-picker-favourites",
  directoryPickerRecent: "pi-web:directory-picker-recent",
  /** Last open session / cwd / file tabs for desktop cold-start restore. */
  workspace: "pi-workspace-v1",
} as const;

export type AppPrefKey = (typeof APP_PREF_KEYS)[keyof typeof APP_PREF_KEYS];

export function getPref(key: AppPrefKey): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setPref(key: AppPrefKey, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / quota
  }
}

export function removePref(key: AppPrefKey): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function getPrefBool(key: AppPrefKey, fallback: boolean): boolean {
  const raw = getPref(key);
  if (raw === null) return fallback;
  return raw === "true";
}

export function setPrefBool(key: AppPrefKey, value: boolean): void {
  setPref(key, String(value));
}

export function getPrefJson<T>(key: AppPrefKey): T | null {
  const raw = getPref(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setPrefJson(key: AppPrefKey, value: unknown): void {
  try {
    setPref(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}
