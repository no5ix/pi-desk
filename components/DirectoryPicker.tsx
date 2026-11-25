"use client";

import { type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { isImeComposing } from "@/lib/ime";
import { AppSelect } from "./AppSelect";
import { APP_PREF_KEYS, type AppPrefKey, getPrefJson, getPref, setPrefJson, setPref } from "@/lib/app-prefs";

interface DirectoryEntry {
  name: string;
  path: string;
  mtime?: number;
}

interface BrowseResponse {
  path?: string;
  parentPath?: string | null;
  directories?: DirectoryEntry[];
  drives?: DirectoryEntry[];
  error?: string;
}

interface CreateDirectoryResponse {
  success?: boolean;
  path?: string;
  error?: string;
}

/** One standard folder on this computer, as the server reads it now. */
interface PlaceEntry {
  id: string;
  path: string;
  exists: boolean;
  readable: boolean;
}

/** A folder the panel remembers, reported as of now. */
interface ReportedDirectory {
  path: string;
  exists: boolean;
  readable: boolean;
}

interface PlacesResponse {
  places?: PlaceEntry[];
  directories?: ReportedDirectory[];
  error?: string;
}

/* The folder window carries no hairlines at all: the shadow is its edge over the scrim,
   the blocks are told apart by tone, and a control is a filled chip, never an outlined box. */
const panelSurfaceStyle: CSSProperties = {
  overflow: "hidden",
  background: "var(--bg)",
  border: 0,
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-dialog)",
};

const textInputStyle: CSSProperties = {
  height: 36,
  padding: "0 10px",
  border: 0,
  borderRadius: "var(--radius-sm)",
  outline: "none",
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  fontSize: "var(--fs-caption)",
};

const actionButtonStyle: CSSProperties = {
  padding: "6px 16px",
  borderRadius: "var(--radius-sm)",
  fontSize: "var(--fs-body)",
};

const primaryActionStyle: CSSProperties = {
  ...actionButtonStyle,
  border: 0,
  background: "var(--accent)",
  color: "var(--accent-contrast)",
  fontWeight: "var(--fw-semibold)",
};

/* The background of a footer button is its only affordance now that nothing is outlined,
   so it lives in app/native-theme.css (`.is-secondary` / `.is-emphasis`), where the hover
   and focus states can reach it — an inline background would beat every :hover rule. */
const secondaryActionStyle: CSSProperties = {
  ...actionButtonStyle,
  border: 0,
};

/** How the list is ordered, remembered across pickers. */
type SortMode = "name" | "date";
const SORT_MODES: SortMode[] = ["name", "date"];

const FAVOURITES_MAX = 12;
const RECENT_MAX = 8;

const PLACE_LABEL_KEYS: Record<string, string> = {
  home: "directoryPicker.place.home",
  documents: "directoryPicker.place.documents",
  desktop: "directoryPicker.place.desktop",
  downloads: "directoryPicker.place.downloads",
};

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function basenameOf(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed || directory;
}

function readStringList(key: AppPrefKey): string[] {
  const stored = getPrefJson<string[]>(key);
  return Array.isArray(stored) ? stored.filter((item) => typeof item === "string" && item) : [];
}

async function loadDirectories(directory?: string): Promise<BrowseResponse> {
  const query = directory ? `?path=${encodeURIComponent(directory)}` : "";
  const response = await fetch(`/api/cwd/browse${query}`);
  const data = await response.json() as BrowseResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function loadPlaces(remembered: string[]): Promise<PlacesResponse> {
  const params = new URLSearchParams();
  for (const item of remembered) params.append("path", item);
  const query = params.toString();
  const response = await fetch(`/api/cwd/places${query ? `?${query}` : ""}`);
  const data = await response.json() as PlacesResponse;
  if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

async function createDirectory(parentPath: string, name: string): Promise<string> {
  const response = await fetch("/api/cwd/browse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: parentPath, name }),
  });
  const data = await response.json() as CreateDirectoryResponse;
  if (!response.ok || data.error || !data.path) {
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  return data.path;
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M1.5 3h4l1.5 2h7.5v7.5h-13z" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 9h12" />
      <circle cx="11.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 7.5 8 2.5l6 5" />
      <path d="M3.5 7v6.5h9V7" />
    </svg>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 2 1.8 3.7 4 .5-2.9 2.8.7 4L8 11.1 4.4 13l.7-4-2.9-2.8 4-.5z" />
    </svg>
  );
}

function isWindowsDriveRoot(directory: string): boolean {
  return /^[a-zA-Z]:[\\/]?$/.test(directory);
}

/**
 * How long the window stays mounted after a dismissal, matching the panel's fade-out in
 * app/native-theme.css (`--dur-base`). The window is the app's own — overlay, panel and
 * animation — so it leaves the way it arrived instead of vanishing between paints.
 */
export const DIRECTORY_PICKER_CLOSE_MS = 180;

interface Props {
  onCancel: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  busy?: boolean;
  error?: string | null;
  /** The window's title; the folder chooser for "Add project" says "Choose folder". */
  title?: string;
}

/**
 * The app's folder window, and the answer to a question the web platform cannot
 * ask the OS: a browser page has no filesystem paths, and a session needs one,
 * so this reads the server's own folders (`/api/cwd/browse`, `/api/cwd/places`).
 *
 * It is built to be used like a native panel: a rail of places (Home, Documents,
 * Desktop, Downloads, the folders pinned here, the folders picked here), a list
 * of folders, a filter, ordering by name or by last change, hidden folders on
 * and off, a path field (`Cmd+Shift+G`), and arrow keys / Enter / `Cmd+Enter` /
 * Backspace over the rows. A folder is only adopted through `onSelect` after
 * `/api/cwd/validate` has taken it, so nothing is trusted on the window's word.
 */
export function DirectoryPicker({ onCancel, onSelect, initialPath, busy = false, error, title }: Props) {
  const { t } = useI18n();
  // Dismissal fades the window out, then tells the parent. Choosing a folder is reported
  // straight away — the parent adopts it and closes the window, and a fade after a choice
  // would only delay the project appearing in the tree.
  const requestClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onCancel(), DIRECTORY_PICKER_CLOSE_MS);
  }, [onCancel]);
  const [closing, setClosing] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [currentPath, setCurrentPath] = useState("");
  const [parentDirectory, setParentDirectory] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [drives, setDrives] = useState<DirectoryEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [directoryName, setDirectoryName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [places, setPlaces] = useState<PlaceEntry[]>([]);
  const [remembered, setRemembered] = useState<ReportedDirectory[]>([]);
  const [favourites, setFavourites] = useState<string[]>(() => readStringList(APP_PREF_KEYS.directoryPickerFavourites));
  const [recent, setRecent] = useState<string[]>(() => readStringList(APP_PREF_KEYS.directoryPickerRecent));
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = getPref(APP_PREF_KEYS.directoryPickerSort);
    return SORT_MODES.includes(stored as SortMode) ? (stored as SortMode) : "name";
  });
  const [showHidden, setShowHidden] = useState(() => getPref(APP_PREF_KEYS.directoryPickerHidden) === "1");
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const pathInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buffer: "", at: 0 });

  const navigateTo = useCallback(async (directory?: string) => {
    setLoading(true);
    setLoadError(null);
    setFilter("");
    setActiveIndex(0);
    // A folder opens at its first row: the list is the window's scroll pane, and a
    // subfolder must not open scrolled to where its parent was left.
    if (listRef.current) listRef.current.scrollTop = 0;
    try {
      const data = await loadDirectories(directory);
      const nextPath = data.path ?? directory ?? "/";
      setCurrentPath(nextPath);
      setParentDirectory(data.parentPath ?? null);
      setPathInput(nextPath);
      setDirectories(data.directories ?? []);
      setDrives(data.drives ?? null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPortalTarget(document.body);
    void navigateTo(initialPath || undefined);
  }, [initialPath, navigateTo]);

  // The rail and the remembered rows are read once per open: favourites and recents
  // live in this browser, and the server answers which of them are still there.
  useEffect(() => {
    void (async () => {
      try {
        const data = await loadPlaces([...favourites, ...recent]);
        setPlaces(data.places ?? []);
        setRemembered(data.directories ?? []);
      } catch {
        // A rail that cannot be read is a rail left empty; the path field still works.
      }
    })();
    // Favourites and recents change only inside this open window, so the lists
    // are read as they stand when the window opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rememberedByPath = useMemo(
    () => new Map(remembered.map((item) => [item.path, item])),
    [remembered],
  );

  const visibleDirectories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const base = directories.filter((entry) =>
      (showHidden || !isHiddenName(entry.name)) && (!needle || entry.name.toLowerCase().includes(needle)));
    if (sortMode === "date") {
      return [...base].sort((left, right) => (right.mtime ?? 0) - (left.mtime ?? 0) || left.name.localeCompare(right.name));
    }
    return base;
  }, [directories, filter, showHidden, sortMode]);

  // A filter that empties the list, or a hidden toggle, must not leave the caret
  // past the last row.
  const activeRow = visibleDirectories.length > 0 ? Math.min(activeIndex, visibleDirectories.length - 1) : 0;

  // The list scrolls, so a keyboard move keeps its row in view, as a native listbox does.
  // Only while the list itself has the keys: a mouse crossing the edge of the last visible
  // row must not shove the list around.
  useEffect(() => {
    const list = listRef.current;
    if (!list || document.activeElement !== list) return;
    list.querySelector(`#directory-row-${activeRow}`)?.scrollIntoView({ block: "nearest" });
  }, [activeRow]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigateTo(candidate);
  };

  const closeCreateDialog = () => {
    if (creating) return;
    setCreateOpen(false);
    setDirectoryName("");
    setCreateError(null);
  };

  // Open the new directory rather than selecting it, so "Select this folder" stays the
  // picker's only commit point and nested folders can be created the same way.
  const handleCreateDirectory = async () => {
    const name = directoryName.trim();
    if (!currentPath || !name || creating) return;

    setCreating(true);
    setCreateError(null);
    try {
      const createdPath = await createDirectory(currentPath, name);
      setCreateOpen(false);
      setDirectoryName("");
      await navigateTo(createdPath);
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };

  const commitFavourites = useCallback((next: string[]) => {
    setFavourites(next);
    setPrefJson(APP_PREF_KEYS.directoryPickerFavourites, next);
  }, []);

  const isCurrentFavourite = Boolean(currentPath) && favourites.includes(currentPath);

  const toggleCurrentFavourite = useCallback(() => {
    if (!currentPath) return;
    if (favourites.includes(currentPath)) {
      commitFavourites(favourites.filter((item) => item !== currentPath));
      return;
    }
    commitFavourites([currentPath, ...favourites].slice(0, FAVOURITES_MAX));
    setRemembered((current) => [...current.filter((item) => item.path !== currentPath), { path: currentPath, exists: true, readable: true }]);
  }, [commitFavourites, currentPath, favourites]);

  const forgetFavourite = useCallback((path: string) => {
    commitFavourites(favourites.filter((item) => item !== path));
  }, [commitFavourites, favourites]);

  const chooseFolder = useCallback((path: string) => {
    // Remember what was taken, so the next open starts where projects live.
    const nextRecent = [path, ...recent.filter((item) => item !== path)].slice(0, RECENT_MAX);
    setRecent(nextRecent);
    setPrefJson(APP_PREF_KEYS.directoryPickerRecent, nextRecent);
    onSelect(path);
  }, [onSelect, recent]);

  const changeSort = useCallback((next: string) => {
    const mode = (SORT_MODES as string[]).includes(next) ? (next as SortMode) : "name";
    setSortMode(mode);
    setPref(APP_PREF_KEYS.directoryPickerSort, mode);
  }, []);

  const toggleHidden = useCallback(() => {
    setShowHidden((current) => {
      const next = !current;
      setPref(APP_PREF_KEYS.directoryPickerHidden, next ? "1" : "0");
      return next;
    });
  }, []);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event)) return;
    const rows = visibleDirectories;
    const move = (next: number) => {
      if (rows.length === 0) return;
      setActiveIndex(Math.max(0, Math.min(rows.length - 1, next)));
      event.preventDefault();
    };
    if (event.key === "ArrowDown") return move(activeRow + 1);
    if (event.key === "ArrowUp") return move(activeRow - 1);
    if (event.key === "Home") return move(0);
    if (event.key === "End") return move(rows.length - 1);
    if (event.key === "PageDown") return move(activeRow + 10);
    if (event.key === "PageUp") return move(activeRow - 10);
    if (event.key === "Enter") {
      if (rows.length === 0) return;
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) {
        if (canSelect) chooseFolder(currentPath);
        return;
      }
      void navigateTo(rows[activeRow].path);
      return;
    }
    if (event.key === "Backspace") {
      if (canNavigateUp) {
        event.preventDefault();
        void navigateTo(parentDirectory ?? undefined);
      }
      return;
    }
    // Type ahead: a few letters jump to the folder they name.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && rows.length > 0) {
      const now = Date.now();
      typeahead.current = now - typeahead.current.at > 900 ? { buffer: event.key, at: now } : { buffer: typeahead.current.buffer + event.key, at: now };
      const needle = typeahead.current.buffer.toLowerCase();
      const hit = rows.findIndex((entry) => entry.name.toLowerCase().startsWith(needle));
      if (hit >= 0) {
        setActiveIndex(hit);
        event.preventDefault();
      }
    }
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (isImeComposing(event)) return;
    if (event.key === "Escape" && !busy && !closing && !isImeComposing(event)) requestClose();
    // Cmd/Ctrl+Shift+G: the path field, the way a native panel jumps to a folder.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "g") {
      event.preventDefault();
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSelect) {
      event.preventDefault();
      chooseFolder(currentPath);
    }
  };

  const hasUncommittedPath = pathInput.trim() !== currentPath;
  const canSelect = Boolean(currentPath) && !hasUncommittedPath && !busy;
  const canCreate = canSelect && !loading;
  const canNavigateUp = Boolean(parentDirectory) || isWindowsDriveRoot(currentPath);

  const railRow = (label: string, path: string, options: { icon: ReactNode; enabled: boolean; key: string; trailing?: ReactNode }) => (
    <div className="directory-picker-rail-row" key={options.key}>
      <button
        type="button"
        className="directory-picker-rail-link"
        onClick={() => void navigateTo(path)}
        disabled={!options.enabled || loading}
        title={path}
        style={{ opacity: options.enabled ? 1 : 0.45 }}
      >
        <span className="directory-picker-rail-icon">{options.icon}</span>
        <span className="directory-picker-rail-label">{label}</span>
      </button>
      {options.trailing}
    </div>
  );

  if (!portalTarget) return null;

  return createPortal(
    <div
      className={`directory-picker-backdrop${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? t("directoryPicker.selectDirectory")}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy && !closing) requestClose();
      }}
      onKeyDown={onPanelKeyDown}
      style={{ position: "fixed", inset: 0, zIndex: "var(--z-modal)", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.35)" }}
    >
      <div className={`directory-picker-panel${closing ? " is-closing" : ""}`} style={{ ...panelSurfaceStyle, position: "relative", width: 760, maxWidth: "calc(100vw - 16px)", height: "min(620px, calc(100dvh - 16px))", maxHeight: "calc(100dvh - 16px)", display: "flex", flexDirection: "column" }}>
        <div className="directory-picker-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, padding: "12px 18px" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "var(--text)", fontWeight: "var(--fw-bold)", fontSize: "var(--fs-title)" }}>{title ?? t("directoryPicker.selectDirectory")}</div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            disabled={busy || closing}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
            style={{ padding: "2px 6px", border: 0, background: "none", color: "var(--text-muted)", fontSize: 20, lineHeight: 1, cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1 }}
          >
            ×
          </button>
        </div>

        <form className="directory-picker-pathbar" onSubmit={handlePathSubmit} style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 14px" }}>
          <button className="directory-picker-back" type="button" onClick={() => void navigateTo(parentDirectory ?? undefined)} disabled={loading || !canNavigateUp} title={t("directoryPicker.goToParent")} aria-label={t("directoryPicker.goToParent")} style={{ width: 36, height: 36, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: 0, borderRadius: "var(--radius-sm)", cursor: canNavigateUp ? "pointer" : "default", opacity: canNavigateUp ? 1 : 0.45 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <label htmlFor="directory-path" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
            {t("directoryPicker.directoryPath")}
          </label>
          <input
            className="directory-picker-path"
            id="directory-path"
            ref={pathInputRef}
            type="text"
            value={pathInput}
            placeholder="/path/to/project or ~/project"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPathInput(event.target.value);
              setLoadError(null);
            }}
            style={{ ...textInputStyle, minWidth: 0, flex: 1 }}
          />
          <button
            className="directory-picker-action"
            type="submit"
            disabled={loading || !pathInput.trim()}
            title={t("directoryPicker.goToDirectory")}
            style={{ minWidth: 58, height: 36, padding: "0 12px", border: 0, borderRadius: "var(--radius-sm)", cursor: loading || !pathInput.trim() ? "default" : "pointer", opacity: loading || !pathInput.trim() ? 0.6 : 1 }}
          >
            {t("directoryPicker.go")}
          </button>
        </form>

        <div className="directory-picker-body">
          <nav className="directory-picker-rail" aria-label={t("directoryPicker.places")}>
            <div className="directory-picker-rail-heading">{t("directoryPicker.places")}</div>
            {places.map((place) => railRow(
              PLACE_LABEL_KEYS[place.id] ? t(PLACE_LABEL_KEYS[place.id]) : basenameOf(place.path),
              place.path,
              {
                key: place.id,
                icon: place.id === "home" ? <HomeIcon /> : <FolderIcon />,
                enabled: place.exists && place.readable,
              },
            ))}

            <div className="directory-picker-rail-heading">
              <span>{t("directoryPicker.favourites")}</span>
              <button
                type="button"
                className="directory-picker-pin"
                onClick={toggleCurrentFavourite}
                disabled={!currentPath}
                aria-pressed={isCurrentFavourite}
                title={isCurrentFavourite ? t("directoryPicker.unpin") : t("directoryPicker.pin")}
                aria-label={isCurrentFavourite ? t("directoryPicker.unpin") : t("directoryPicker.pin")}
              >
                <StarIcon filled={isCurrentFavourite} />
              </button>
            </div>
            {favourites.length === 0 && <div className="directory-picker-rail-empty">{t("directoryPicker.noFavourites")}</div>}
            {favourites.map((path) => {
              const state = rememberedByPath.get(path);
              return railRow(basenameOf(path), path, {
                key: path,
                icon: <StarIcon filled />,
                enabled: state ? state.exists && state.readable : true,
                trailing: (
                  <button
                    type="button"
                    className="directory-picker-forget"
                    onClick={() => forgetFavourite(path)}
                    title={t("directoryPicker.unpin")}
                    aria-label={`${t("directoryPicker.unpin")}: ${basenameOf(path)}`}
                  >
                    ×
                  </button>
                ),
              });
            })}

            {recent.length > 0 && <div className="directory-picker-rail-heading">{t("directoryPicker.recent")}</div>}
            {recent.map((path) => {
              const state = rememberedByPath.get(path);
              return railRow(basenameOf(path), path, {
                key: `recent-${path}`,
                icon: <FolderIcon />,
                enabled: state ? state.exists && state.readable : true,
              });
            })}
          </nav>

          <div className="directory-picker-main">
            <div className="directory-picker-toolbar">
              <input
                type="search"
                className="directory-picker-filter"
                value={filter}
                placeholder={t("directoryPicker.filterPlaceholder")}
                aria-label={t("directoryPicker.filter")}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setActiveIndex(0);
                }}
              />
              <AppSelect
                value={sortMode}
                onValueChange={changeSort}
                aria-label={t("directoryPicker.sortBy")}
                options={SORT_MODES.map((mode) => ({
                  value: mode,
                  label: mode === "name" ? t("directoryPicker.sort.name") : t("directoryPicker.sort.date"),
                }))}
              />
              <button
                type="button"
                className="directory-picker-toggle"
                onClick={toggleHidden}
                aria-pressed={showHidden}
                title={t("directoryPicker.showHidden")}
              >
                {t("directoryPicker.showHidden")}
              </button>
            </div>

            <div
              ref={listRef}
              className="directory-picker-list"
              role={drives === null ? "listbox" : undefined}
              tabIndex={0}
              aria-label={t("directoryPicker.directories")}
              aria-busy={loading}
              aria-activedescendant={visibleDirectories.length > 0 ? `directory-row-${activeRow}` : undefined}
              onKeyDown={onListKeyDown}
            >
              {loading ? (
                <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{t("directoryPicker.loadingDirectories")}</div>
              ) : drives !== null ? (
                <>
                  {drives.length > 0 ? (
                    drives.map((drive) => (
                      <button
                        key={drive.path}
                        className="directory-picker-entry"
                        type="button"
                        onClick={() => void navigateTo(drive.path)}
                        title={drive.path}
                        style={{ width: "100%", minHeight: 34, display: "flex", alignItems: "center", gap: 7, padding: "6px 8px", border: 0, borderRadius: "var(--radius-sm)", background: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}
                      >
                        <DriveIcon />
                        <span>{drive.name}</span>
                      </button>
                    ))
                  ) : (
                    <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{t("directoryPicker.noDrives")}</div>
                  )}
                </>
              ) : visibleDirectories.length > 0 ? (
                visibleDirectories.map((entry, index) => (
                  <button
                    key={entry.path}
                    id={`directory-row-${index}`}
                    className={`directory-picker-entry${index === activeRow ? " is-active" : ""}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeRow}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      setActiveIndex(index);
                      void navigateTo(entry.path);
                    }}
                    title={entry.path}
                  >
                    <FolderIcon />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                    {isHiddenName(entry.name) && <span className="directory-picker-hidden-tag">{t("directoryPicker.hiddenTag")}</span>}
                  </button>
                ))
              ) : directories.length > 0 && filter.trim() ? (
                <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{t("directoryPicker.noMatches")}</div>
              ) : (
                <div style={{ padding: 8, color: "var(--text-dim)", fontSize: "var(--fs-micro)" }}>{t("directoryPicker.noSubdirectories")}</div>
              )}
              {(loadError || error) && <div style={{ padding: "8px", color: "var(--danger)", fontSize: "var(--fs-micro)" }}>{loadError ?? error}</div>}
            </div>
          </div>
        </div>

        <div className="directory-picker-footer" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexShrink: 0, padding: "10px 18px" }}>
          <button
            className="directory-picker-action is-emphasis"
            type="button"
            onClick={() => {
              setCreateOpen(true);
              setCreateError(null);
            }}
            disabled={!canCreate}
            style={{ ...secondaryActionStyle, marginRight: "auto", opacity: canCreate ? 1 : 0.6, cursor: canCreate ? "pointer" : "default" }}
          >
            {t("directoryPicker.newDirectory")}
          </button>
          <button className="directory-picker-action is-secondary" type="button" onClick={requestClose} disabled={busy || closing} style={{ ...secondaryActionStyle, cursor: busy ? "default" : "pointer" }}>{t("i18n.cancel")}</button>
          <button
            className="directory-picker-action"
            type="button"
            onClick={() => chooseFolder(currentPath)}
            disabled={!canSelect}
            title={hasUncommittedPath ? t("directoryPicker.openBeforeSelecting") : t("directoryPicker.selectCurrentDirectory")}
            style={{ ...primaryActionStyle, opacity: canSelect ? 1 : 0.6, cursor: canSelect ? "pointer" : "default" }}
          >
            {busy ? t("i18n.checking") : t("directoryPicker.selectThisFolder")}
          </button>
        </div>

        {createOpen && (
          <div
            style={{ position: "absolute", inset: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 12, background: "rgba(0,0,0,0.35)" }}
            onClick={(event) => {
              if (event.target === event.currentTarget) closeCreateDialog();
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") closeCreateDialog();
            }}
          >
            <form
              role="dialog"
              aria-modal="true"
              aria-label={t("directoryPicker.createDirectory")}
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateDirectory();
              }}
              style={{ ...panelSurfaceStyle, background: "var(--surface-elevated)", width: 400, maxWidth: "100%" }}
            >
              <div className="directory-picker-sheet-header" style={{ padding: "12px 18px", color: "var(--text)", fontSize: "var(--fs-title)", fontWeight: "var(--fw-bold)" }}>
                {t("directoryPicker.createDirectory")}
              </div>
              <div style={{ padding: "12px 18px" }}>
                <label htmlFor="new-directory-name" style={{ display: "block", marginBottom: 6, color: "var(--text-muted)", fontSize: "var(--fs-micro)" }}>
                  {t("directoryPicker.directoryName")}
                </label>
                <input
                  id="new-directory-name"
                  value={directoryName}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("directoryPicker.directoryNamePlaceholder")}
                  onChange={(event) => {
                    setDirectoryName(event.target.value);
                    setCreateError(null);
                  }}
                  disabled={creating}
                  className="directory-picker-path"
                  style={{ ...textInputStyle, width: "100%", boxSizing: "border-box" }}
                />
                {createError && <div style={{ marginTop: 7, color: "var(--danger)", fontSize: "var(--fs-micro)", lineHeight: 1.35 }}>{createError}</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button
                    className="directory-picker-action"
                    type="submit"
                    disabled={creating || !directoryName.trim()}
                    style={{ ...primaryActionStyle, flex: 1, opacity: creating ? 0.65 : 1, cursor: creating || !directoryName.trim() ? "default" : "pointer" }}
                  >
                    {creating ? t("directoryPicker.creating") : t("directoryPicker.create")}
                  </button>
                  <button
                    className="directory-picker-action is-secondary"
                    type="button"
                    onClick={closeCreateDialog}
                    disabled={creating}
                    style={{ ...secondaryActionStyle, flex: 1, cursor: creating ? "default" : "pointer" }}
                  >
                    {t("i18n.cancel")}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    portalTarget,
  );
}
