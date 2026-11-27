"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { BranchInfo, CherryPickState, MergeState, RemoteBranchGroup } from "@/lib/git/types";
import { BranchSidebar, type GitRefIdentity } from "./git/branch/BranchSidebar";
import { remoteBranchNames } from "./git/branch/remote-rows";
import { LogPanel } from "./git/log/LogPanel";
import { CommitPanel } from "./git/commit/CommitPanel";
import { BlameDialog, CompareDialog, ConflictDialog, PushDialog } from "./git/dialogs/GitDialogs";
import { fetchGitRepos, gitCommand, useGitEvents, useGitQuery, type GitRepoList, type GitTarget } from "./git/git-api";
import { GitIconButton, GitState, GitTabs } from "./git/git-ui";

/**
 * The right panel's Git view: Branchshift's two surfaces, in pi-desk's panel.
 *
 * **Log** is Branchshift's three-column reading view — the branch tree, the
 * commit graph and list, one commit's message, files and diff. **Commit** is
 * Branchshift's staging workflow, with its Shelf (git stash) and Idea Shelf
 * tabs. Both read the ported backend through `POST /api/git/execute`, and both
 * refresh from the same event stream (`GET /api/git/events`): the panel has no
 * timer, exactly as the app's first Git view had none.
 *
 * The columns split with a drag and stack when the panel is too narrow, so the
 * view is usable at a phone width without a sideways page scroll.
 *
 * The repository is the project folder the panel was opened with; the switcher
 * lists that checkout's worktrees and the repositories nested in it, and the
 * server honours a selection only when discovery reached it.
 */

interface Props {
  /** The project folder the panel reads: a main checkout or a linked worktree. */
  cwd: string;
  /** A file, opened as a panel tab (the shell's `handleOpenFile`). The path is the
   *  file's own — an absolute path, which is what a tab is keyed by. */
  onOpenFile: (filePath: string, fileName: string) => void;
  /** A file's working-tree diff, opened as a panel tab in the Diff mode. */
  onOpenFileGitDiff?: (filePath: string, fileName: string) => void;
  /** A worktree of the same repository, selected from the switcher. */
  onSwitchRepository?: (cwd: string) => void;
  /** The shell's busy line: a git operation the panel started. */
  onBusyChange?: (label: string | null) => void;
}

type PanelTab = "log" | "commit";
type NarrowView = "branches" | "log";

const NARROW_BREAKPOINT = 560;
const SPLIT_STORAGE_KEY = "pi-git-split";
const SPLIT_MIN = 170;
const SPLIT_MAX = 420;

export function GitPanel({ cwd, onOpenFile, onOpenFileGitDiff, onSwitchRepository, onBusyChange }: Props) {
  const { t } = useI18n();
  const [activeCwd, setActiveCwd] = useState(cwd);
  const [tab, setTab] = useState<PanelTab>("log");
  const [narrowView, setNarrowView] = useState<NarrowView>("branches");
  const [refreshToken, setRefreshToken] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedRef, setSelectedRef] = useState<GitRefIdentity | null>(null);
  const [dialog, setDialog] = useState<
    | null
    | { kind: "push" }
    | { kind: "conflicts" }
    | { kind: "blame"; filePath: string }
    | { kind: "compare"; from: GitRefIdentity; to: GitRefIdentity }
  >(null);
  const [repos, setRepos] = useState<GitRepoList | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [split, setSplit] = useState(() => readStoredSplit());
  const [isNarrow, setIsNarrow] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const target: GitTarget = useMemo(() => ({ cwd: activeCwd }), [activeCwd]);
  const branches = useGitQuery<BranchInfo[]>(target, "getBranches", {}, { deps: [refreshToken] });
  // Per remote: `{ remote, branches: string[] }`. See
  // `components/git/branch/remote-rows.ts`.
  const remoteBranches = useGitQuery<RemoteBranchGroup[]>(target, "getRemoteBranches", {}, { deps: [refreshToken] });
  const mergeState = useGitQuery<MergeState>(target, "getMergeState", {}, { deps: [refreshToken] });
  const rebaseState = useGitQuery<{ isRebasing: boolean; branchName?: string; step?: number; totalSteps?: number }>(
    target,
    "getRebaseState",
    {},
    { deps: [refreshToken] },
  );
  const cherryPickState = useGitQuery<CherryPickState>(target, "getCherryPickState", {}, { deps: [refreshToken] });
  const conflicts = useGitQuery<string[]>(target, "getConflictFiles", {}, { deps: [refreshToken] });

  const current = branches.data?.find((branch) => branch.isCurrent) ?? null;
  const ahead = current?.ahead ?? 0;

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
    void gitCommand(target, "refreshGitState").catch(() => null);
  }, [target]);

  // The event stream says "the repository moved", and the panel re-reads. The
  // batching (one read per watcher burst) lives in `useGitEvents`: this view
  // owns no timer, so nothing here reads git on a schedule.
  useGitEvents(target, () => setRefreshToken((value) => value + 1));

  useEffect(() => {
    setActiveCwd(cwd);
    setSelectedRef(null);
    setRepos(null);
  }, [cwd]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    const measure = () => setIsNarrow(host.clientWidth < NARROW_BREAKPOINT);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const loadRepos = useCallback(async (refresh: boolean) => {
    try {
      setRepos(await fetchGitRepos(cwd, refresh));
    } catch {
      setRepos(null);
    }
  }, [cwd]);

  useEffect(() => {
    void loadRepos(false);
  }, [loadRepos]);

  /**
   * A path the panel reads from git — repo-relative, as git names it — as the
   * absolute path a file tab is keyed by.
   *
   * Passing git's name straight to the shell opened a tab for `README.md`, and
   * the file route answered `Access denied` for a relative path: the panel showed
   * a tall empty view with one red word in it. The repository is the base, and a
   * path that is already absolute (a service result) is left alone.
   */
  const toAbsolutePath = useCallback((repoPath: string) => {
    const clean = repoPath.replace(/^\.\//, "");
    if (!clean) return target.cwd;
    if (clean.startsWith("/") || /^[A-Za-z]:[\\/]/.test(clean)) return clean;
    const base = target.cwd.endsWith("/") ? target.cwd.slice(0, -1) : target.cwd;
    return `${base}/${clean}`;
  }, [target.cwd]);

  const openFile = useCallback((repoPath: string, label?: string) => {
    const absolute = toAbsolutePath(repoPath);
    onOpenFile(absolute, label ?? absolute.split("/").pop() ?? absolute);
  }, [toAbsolutePath, onOpenFile]);

  const openFileDiff = useCallback((repoPath: string, label?: string, commitSha?: string) => {
    const absolute = toAbsolutePath(repoPath);
    const name = label ?? absolute.split("/").pop() ?? absolute;
    if (onOpenFileGitDiff) onOpenFileGitDiff(absolute, name, commitSha);
    else onOpenFile(absolute, name);
  }, [toAbsolutePath, onOpenFile, onOpenFileGitDiff]);

  const openFileAtRevision = useCallback(async (hash: string, filePath: string) => {
    if (!filePath) return;
    const result = await gitCommand<{ filePath: string; content: string }>(target, "openFileAtRevision", {
      hash,
      filePath,
    }).catch(() => null);
    if (!result) return;
    // The panel cannot mint a tab of its own; the shell opens the bytes it is handed.
    onOpenFile(result.filePath, `${result.filePath.split("/").pop()}@${hash.slice(0, 7)}`);
  }, [target, onOpenFile]);

  const branchList = remoteBranchNames(remoteBranches.data ?? []);

  return (
    <div className="git-panel" id="git-panel" role="region" aria-label={t("gitPanel.title")}>
      <div className="git-panel-header">
        <div className="git-repo-switcher">
          <button
            type="button"
            className="git-repo-button"
            aria-haspopup="menu"
            aria-expanded={reposOpen}
            onClick={() => setReposOpen((value) => !value)}
            title={activeCwd}
          >
            <span className="git-repo-name">{(activeCwd.split("/").pop() ?? activeCwd)}</span>
            <span className="git-repo-branch">{current?.name ?? t("git.detached")}</span>
            <ChevronIcon open={reposOpen} />
          </button>
          {reposOpen ? (
            <div className="native-popover app-menu git-repo-menu" role="menu" aria-label={t("git.repoSwitcher")}>
              <div className="git-repo-menu-header">
                <span>{t("git.repoSwitcher")}</span>
                <button type="button" className="git-inline-button" onClick={() => void loadRepos(true)}>
                  {t("gitPanel.reload")}
                </button>
              </div>
              {(repos?.repos ?? []).map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={repo.id === activeCwd}
                  className={`git-repo-row${repo.id === activeCwd ? " is-selected" : ""}`}
                  onClick={() => {
                    setReposOpen(false);
                    setActiveCwd(repo.rootPath);
                    onSwitchRepository?.(repo.rootPath);
                  }}
                >
                  <span className="git-repo-row-name">{repo.label}</span>
                  <span className="git-repo-row-branch">{repo.branch ?? t("git.detached")}</span>
                  {repo.isWorktree ? <span className="git-repo-row-tag">{t("git.worktreeTag")}</span> : null}
                </button>
              ))}
              {!repos?.repos.length ? <div className="git-repo-row git-repo-empty">{t("git.repoNone")}</div> : null}

              {/* The app's own projects. Branchshift's switcher listed the IDE's
                  open projects, and that was the point of it: the Git view moved
                  between the folders the editor was working in. pi-desk's project
                  list is the session sidebar's, so the panel shows that list, with
                  the current workspace's worktrees above it (a worktree is its own
                  checkout, so it stays listed as one). */}
              {(repos?.projects ?? []).length ? (
                <>
                  <div className="git-repo-menu-section">{t("git.repoProjects")}</div>
                  {(repos?.projects ?? [])
                    .filter((project) => !(repos?.repos ?? []).some((repo) => repo.rootPath === project.path))
                    .map((project) => (
                      <button
                        key={project.path}
                        type="button"
                        role="menuitemradio"
                        aria-checked={project.path === activeCwd}
                        className={`git-repo-row${project.path === activeCwd ? " is-selected" : ""}`}
                        title={project.path}
                        onClick={() => {
                          setReposOpen(false);
                          setActiveCwd(project.path);
                          onSwitchRepository?.(project.path);
                        }}
                      >
                        <span className="git-repo-row-name">{project.name}</span>
                        <span className="git-repo-row-branch">{project.branch ?? t("git.detached")}</span>
                        {project.isWorktree ? <span className="git-repo-row-tag">{t("git.worktreeTag")}</span> : null}
                      </button>
                    ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <GitTabs
          value={tab}
          onChange={(value) => {
            setTab(value);
            setNarrowView("branches");
          }}
          ariaLabel={t("gitPanel.title")}
          items={[
            { id: "log", label: t("git.tabLog") },
            { id: "commit", label: t("git.tabCommit") },
          ]}
        />

        <span className="git-toolbar-spacer" />
        <GitIconButton
          label={t("git.push")}
          onClick={() => setDialog({ kind: "push" })}
          disabled={!current}
          title={t("git.pushTitle")}
        >
          <PushIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.conflictTitle")}
          active={(conflicts.data?.length ?? 0) > 0}
          onClick={() => setDialog({ kind: "conflicts" })}
          disabled={(conflicts.data?.length ?? 0) === 0}
        >
          <ConflictIcon />
          {(conflicts.data?.length ?? 0) > 0 ? (
            <span className="git-badge">{conflicts.data?.length}</span>
          ) : null}
        </GitIconButton>
        <GitIconButton label={t("gitPanel.reload")} onClick={refresh}>
          <RefreshIcon />
        </GitIconButton>
      </div>

      <GitOperationBanner
        target={target}
        mergeState={mergeState.data}
        rebaseState={rebaseState.data}
        cherryPickState={cherryPickState.data}
        onBusy={setBusy}
        onChanged={refresh}
      />

      {branches.error ? (
        <div className="git-panel-body">
          <GitState kind="error" text={branches.error.message} onRetry={branches.reload} />
        </div>
      ) : (
        <div className="git-panel-body" ref={bodyRef}>
          {tab === "log" ? (
            isNarrow ? (
              <div className="git-narrow">
                <GitTabs
                  value={narrowView}
                  onChange={setNarrowView}
                  ariaLabel={t("git.tabLog")}
                  items={[
                    { id: "branches", label: t("git.branchesTitle") },
                    { id: "log", label: t("git.logTitle") },
                  ]}
                />
                {narrowView === "branches" ? (
                  <BranchSidebar
                    target={target}
                    refreshToken={refreshToken}
                    selected={selectedRef}
                    onSelect={(ref) => {
                      setSelectedRef(ref);
                      setNarrowView("log");
                    }}
                    onBusy={setBusy}
                    onChanged={refresh}
                    onCompare={(ref) => current && ref && setDialog({ kind: "compare", from: ref, to: identityOf(current) })}
                    onOpenWorktree={(path) => {
                      setActiveCwd(path);
                      onSwitchRepository?.(path);
                    }}
                  />
                ) : (
                  <LogPanel
                    target={target}
                    refreshToken={refreshToken}
                    selectedRef={selectedRef}
                    onClearRef={() => setSelectedRef(null)}
                    currentBranch={current?.name ?? null}
                    onBusy={setBusy}
                    onChanged={refresh}
                    onOpenFileDiff={({ label, to }) => openFileDiff(label, undefined, to)}
                    onOpenFileAtRevision={(hash, filePath) => void openFileAtRevision(hash, filePath)}
                    onOpenFileHistory={(filePath) => openFile(filePath)}
                    onOpenBlame={(filePath) => setDialog({ kind: "blame", filePath })}
                  />
                )}
              </div>
            ) : (
              <div className="git-log-split" style={{ gridTemplateColumns: `${split}px 6px minmax(0, 1fr)` }}>
                <BranchSidebar
                  target={target}
                  refreshToken={refreshToken}
                  selected={selectedRef}
                  onSelect={setSelectedRef}
                  onBusy={setBusy}
                  onChanged={refresh}
                  onCompare={(ref) => current && setDialog({ kind: "compare", from: ref, to: identityOf(current) })}
                  onOpenWorktree={(path) => {
                    setActiveCwd(path);
                    onSwitchRepository?.(path);
                  }}
                />
                <div
                  className="panel-resize-handle git-split-resizer"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("git.resizeBranches")}
                  tabIndex={0}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    const startX = event.clientX;
                    const startSplit = split;
                    const onMove = (moveEvent: PointerEvent) => {
                      const next = clampSplit(startSplit + (moveEvent.clientX - startX));
                      setSplit(next);
                      writeStoredSplit(next);
                    };
                    const onUp = () => {
                      window.removeEventListener("pointermove", onMove);
                      window.removeEventListener("pointerup", onUp);
                    };
                    window.addEventListener("pointermove", onMove);
                    window.addEventListener("pointerup", onUp);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      const next = clampSplit(split + (event.key === "ArrowLeft" ? -16 : 16));
                      setSplit(next);
                      writeStoredSplit(next);
                    }
                  }}
                />
                <LogPanel
                  target={target}
                  refreshToken={refreshToken}
                  selectedRef={selectedRef}
                  onClearRef={() => setSelectedRef(null)}
                  currentBranch={current?.name ?? null}
                  onBusy={setBusy}
                  onChanged={refresh}
                  onOpenFileDiff={({ label }) => openFileDiff(label)}
                  onOpenFileAtRevision={(hash, filePath) => void openFileAtRevision(hash, filePath)}
                  onOpenFileHistory={(filePath) => openFile(filePath)}
                  onOpenBlame={(filePath) => setDialog({ kind: "blame", filePath })}
                />
              </div>
            )
          ) : (
            <CommitPanel
              target={target}
              refreshToken={refreshToken}
              currentBranch={current?.name ?? null}
              onBusy={setBusy}
              onChanged={refresh}
              onOpenFile={(filePath) => onOpenFile(filePath, filePath.split("/").pop() ?? filePath)}
              onOpenFileDiff={({ filePath, label }) => openFileDiff(filePath, label)}
            />
          )}
        </div>
      )}

      <div className="git-panel-status" role="status">
        {busy ? (
          <span className="git-status-busy">
            <span className="git-panel-spin" aria-hidden="true" />
            {busy}
          </span>
        ) : current ? (
          <>
            <span className="git-status-item">{current.name}</span>
            {current.ahead || current.behind ? (
              <span className="git-status-item">{t("git.aheadBehind", { ahead: current.ahead, behind: current.behind })}</span>
            ) : null}
            {current.upstream ? <span className="git-status-item">→ {current.upstream}</span> : null}
            {current.lastCommitHash ? (
              <span className="git-status-item git-status-dim">{current.name} @ {current.lastCommitHash.slice(0, 7)}</span>
            ) : null}
          </>
        ) : (
          <span className="git-status-item">{branches.loading ? t("git.branchesLoading") : t("git.detached")}</span>
        )}
        <span className="git-toolbar-spacer" />
        <span className="git-status-item git-status-dim">{t("git.eventsLive")}</span>
      </div>

      {dialog?.kind === "push" && current ? (
        <PushDialog
          target={target}
          branch={current.name}
          remoteBranches={branchList}
          ahead={ahead}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      ) : null}
      {dialog?.kind === "conflicts" ? (
        <ConflictDialog target={target} onClose={() => setDialog(null)} onDone={refresh} />
      ) : null}
      {dialog?.kind === "blame" ? (
        <BlameDialog target={target} filePath={dialog.filePath} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "compare" ? (
        <CompareDialog
          target={target}
          from={dialog.from}
          to={dialog.to}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

function identityOf(branch: BranchInfo): GitRefIdentity {
  return { type: "local", name: branch.name, fullRef: branch.fullRef };
}

function GitOperationBanner({
  target,
  mergeState,
  rebaseState,
  cherryPickState,
  onBusy,
  onChanged,
}: {
  target: GitTarget;
  mergeState: MergeState | null;
  rebaseState: { isRebasing: boolean; branchName?: string; step?: number; totalSteps?: number } | null;
  cherryPickState: CherryPickState | null;
  onBusy: (label: string | null) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  const run = useCallback(
    async (label: string, command: string, params: Record<string, unknown>) => {
      onBusy(label);
      setFailed(null);
      try {
        await gitCommand(target, command, params);
        onChanged();
      } catch (error) {
        setFailed((error as Error).message);
      } finally {
        onBusy(null);
      }
    },
    [target, onBusy, onChanged],
  );

  if (!mergeState?.isMerging && !rebaseState?.isRebasing && !cherryPickState?.isCherryPicking) return null;

  const rebase = rebaseState?.isRebasing ? rebaseState : null;
  const cherry = cherryPickState?.isCherryPicking ? cherryPickState : null;
  const label = rebase
    ? t("git.rebasing", {
      branch: rebase.branchName ?? "",
      step: rebase.step ?? 0,
      total: rebase.totalSteps ?? 0,
    })
    : cherry
      ? t("git.cherryPicking")
      : t("git.merging", { head: mergeState?.mergeHead?.slice(0, 8) ?? "" });

  return (
    <div className="git-operation-banner" role="status">
      <span className="git-operation-label">{label}</span>
      {failed ? <span className="git-operation-error" role="alert">{failed}</span> : null}
      <span className="git-toolbar-spacer" />
      {rebase ? (
        <>
          <button type="button" className="git-inline-button" onClick={() => void run(t("git.rebaseContinue"), "rebaseAction", { action: "continue" })}>
            {t("git.rebaseContinue")}
          </button>
          <button type="button" className="git-inline-button" onClick={() => void run(t("git.rebaseSkip"), "rebaseAction", { action: "skip" })}>
            {t("git.rebaseSkip")}
          </button>
          <button type="button" className="git-inline-button is-danger" onClick={() => void run(t("git.rebaseAbort"), "rebaseAction", { action: "abort" })}>
            {t("git.rebaseAbort")}
          </button>
        </>
      ) : null}
      {cherry ? (
        <>
          <button type="button" className="git-inline-button" onClick={() => void run(t("git.cherryContinue"), "cherryPickAction", { action: "continue" })}>
            {t("git.cherryContinue")}
          </button>
          <button type="button" className="git-inline-button" onClick={() => void run(t("git.cherrySkip"), "cherryPickAction", { action: "skip" })}>
            {t("git.cherrySkip")}
          </button>
          <button type="button" className="git-inline-button is-danger" onClick={() => void run(t("git.cherryAbort"), "cherryPickAction", { action: "abort" })}>
            {t("git.cherryAbort")}
          </button>
        </>
      ) : null}
      {mergeState?.isMerging && !rebase && !cherry ? (
        <>
          <button type="button" className="git-inline-button is-danger" onClick={() => void run(t("git.mergeAbort"), "mergeAction", { action: "abort" })}>
            {t("git.mergeAbort")}
          </button>
          <button type="button" className="git-inline-button is-primary" onClick={() => void run(t("git.mergeContinue"), "mergeAction", { action: "continue" })}>
            {t("git.mergeContinue")}
          </button>
        </>
      ) : null}
    </div>
  );
}

function clampSplit(value: number) {
  return Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, Math.round(value)));
}

function readStoredSplit(): number {
  try {
    const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? clampSplit(parsed) : 232;
  } catch {
    return 232;
  }
}

function writeStoredSplit(value: number) {
  try {
    window.localStorage.setItem(SPLIT_STORAGE_KEY, String(value));
  } catch {
    // Private mode: the split is a convenience, not state worth failing over.
  }
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
      <path
        d={open ? "M2 4.5 L6 8.5 L10 4.5" : "M4.5 2 L8.5 6 L4.5 10"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M8 13V3.4M4.4 6.8L8 3.2l3.6 3.6M3 13.6h10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ConflictIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M6 2.6v6.4M6 11.4v1.2M10.6 3.4v5.6M10.6 11.2v1.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.4H10.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
