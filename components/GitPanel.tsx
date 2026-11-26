"use client";

// Fork-owned: the right panel's Git view — branch tree → one branch's commits → one
// commit's diff.
//
// The app already had the two ends of this and nothing in the middle. The branch list
// was a page of the composer's branch menu (components/ProjectContextMenu.tsx), and a
// file's working-tree diff was the file viewer's (components/FileViewer.tsx). In
// between stood a question nobody could answer from the panel: *what has happened on
// this branch?* So the panel's Git button opens three levels, in the order the question
// is asked — where am I (the branch this checkout is on, the branches with a folder of
// their own, the rest as the tree their names carry), then the commits of the branch
// picked, then the diff of the commit picked.
//
// Nothing here is a second version of a thing the app has:
// - the branch rows are the menu's own rows: `fetchProjectBranchMenu`, `buildBranchRows`,
//   `buildBranchTree`, `flattenBranchTree` and `filterBranchRows`, and the same three
//   glyphs (current / worktree / plain branch) in the same marks;
// - the commits and the commit's patch come from `app/api/git/commits` and
//   `app/api/git/commit-diff`, which read git through the app's one bounded runner
//   (lib/git-log.ts over runGit in lib/git-changes.ts);
// - the patch is painted by the file viewer's own diff view, so a commit reads exactly
//   like a file's diff tab, hunk headers and collapsed-unchanged markers included;
// - a file row's own button opens that file as a panel tab through the shell's
//   `handleOpenFile`, the way every other open-file affordance in the app does.
//
// The levels are the panel's state, not routes, and nothing is read on a timer: each
// level asks when it is shown, and the two refresh buttons are the only other way a
// git command runs.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  buildBranchRows,
  buildBranchTree,
  flattenBranchTree,
  type BranchListItem,
  type BranchRow,
} from "@/lib/branch-tree";
import { shortenPath } from "@/lib/display-path";
import { joinFilePath } from "@/lib/file-paths";
import { formatCompactRelativeTime } from "@/lib/i18n/format";
import { patchForFile } from "@/lib/patch";
import type {
  GitCommitDiffResponse,
  GitCommitEntry,
  GitCommitFile,
} from "@/lib/git-types";
import {
  currentCheckout,
  fetchProjectBranchMenu,
  fetchRemoteBranches,
  filterBranchRows,
  type ProjectBranchMenuState,
} from "./ProjectContextMenu";
import { BranchIcon, ProjectFolderIcon, WorktreeIcon } from "./GitIcons";
import { DiffView } from "./FileViewer";

/** A page of history, the same number the server caps a page to. */
const COMMIT_PAGE_SIZE = 40;
/** Below this many branches, reading the list is faster than typing in a box — the
 *  same rule the branch menu applies (BRANCH_FILTER_THRESHOLD there). */
const BRANCH_FILTER_THRESHOLD = 6;

interface Props {
  /** The project folder the panel reads: a main checkout or a linked worktree. */
  cwd: string;
  /** A commit's file, opened as a panel tab (the shell's `handleOpenFile`). */
  onOpenFile: (filePath: string, fileName: string) => void;
}

interface BranchRead {
  loading: boolean;
  data: ProjectBranchMenuState | null;
}

interface CommitRead {
  loading: boolean;
  loadingMore: boolean;
  entries: GitCommitEntry[];
  hasMore: boolean;
  repositoryRoot: string | null;
  error: string | null;
}

interface DiffRead {
  loading: boolean;
  data: GitCommitDiffResponse | null;
  error: string | null;
}

/** git's first line, which is the part that says what went wrong. */
function gitMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim()) ?? text;
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}

function statusLetter(file: GitCommitFile): string {
  if (file.status === "added") return "A";
  if (file.status === "deleted") return "D";
  if (file.status === "renamed") return "R";
  if (file.status === "conflict") return "U";
  if (file.status === "untracked") return "?";
  return "M";
}

/** The arrow that folds a branch group, and the arrow that steps a level back. */
function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** The row's trailing arrow: this row leads somewhere, and that is the row's whole job. */
function IntoIcon() {
  return (
    <span className="git-panel-into" aria-hidden="true">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 6 15 12 9 18" />
      </svg>
    </span>
  );
}

function ReloadIcon({ spinning }: { spinning?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={spinning ? "git-panel-spin" : undefined}>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <polyline points="20 4 20 10 14 10" />
    </svg>
  );
}

function OpenFileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </svg>
  );
}

export function GitPanel({ cwd, onOpenFile }: Props) {
  const { t, locale } = useI18n();

  const [branches, setBranches] = useState<BranchRead>({ loading: true, data: null });
  const [fetching, setFetching] = useState(false);
  const [branchFilter, setBranchFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [selectedBranch, setSelectedBranch] = useState<BranchRow | null>(null);
  const [commits, setCommits] = useState<CommitRead>({
    loading: false, loadingMore: false, entries: [], hasMore: false, repositoryRoot: null, error: null,
  });
  const [selectedCommit, setSelectedCommit] = useState<GitCommitEntry | null>(null);
  const [diff, setDiff] = useState<DiffRead>({ loading: false, data: null, error: null });
  /** The file whose section of the commit's patch is painted; null is the whole commit. */
  const [shownFile, setShownFile] = useState<string | null>(null);

  // A panel is one project's: the request ids drop the answers of a project that is no
  // longer on screen, so a slow read for the previous folder never paints this one.
  const branchRequest = useRef(0);
  const commitRequest = useRef(0);
  const diffRequest = useRef(0);

  const loadBranches = useCallback(async () => {
    const request = ++branchRequest.current;
    setBranches((current) => ({ loading: true, data: current.data }));
    const data = await fetchProjectBranchMenu(cwd);
    if (request !== branchRequest.current) return;
    setBranches({ loading: false, data });
  }, [cwd]);

  const loadCommits = useCallback(async (ref: string, page: number) => {
    const request = ++commitRequest.current;
    setCommits((current) => ({
      ...current,
      loading: page === 0,
      loadingMore: page > 0,
      error: null,
    }));
    const query = `cwd=${encodeURIComponent(cwd)}&ref=${encodeURIComponent(ref)}&limit=${COMMIT_PAGE_SIZE}&skip=${page * COMMIT_PAGE_SIZE}`;
    try {
      const response = await fetch(`/api/git/commits?${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        commits?: GitCommitEntry[];
        hasMore?: boolean;
        repositoryRoot?: string | null;
        isGitRepository?: boolean;
      };
      if (request !== commitRequest.current) return;
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      if (data.isGitRepository === false) throw new Error(t("gitPanel.notGit"));
      const fresh = Array.isArray(data.commits) ? data.commits : [];
      // A second page is appended to what is on screen, by sha: git's own list can
      // shift under a commit made while the panel was open, and a row never repeats.
      const known = page === 0 ? [] : commitEntriesRef.current;
      const seen = new Set(known.map((entry) => entry.sha));
      setCommits({
        loading: false,
        loadingMore: false,
        entries: [...known, ...fresh.filter((entry) => !seen.has(entry.sha))],
        hasMore: data.hasMore === true,
        repositoryRoot: data.repositoryRoot ?? null,
        error: null,
      });
    } catch (error) {
      if (request !== commitRequest.current) return;
      setCommits((current) => ({ ...current, loading: false, loadingMore: false, error: gitMessage(error) }));
    }
  }, [cwd, t]);

  /** The commits on screen, for the append path: a late answer for another project
   *  must never be joined onto this one's list. */
  const commitEntriesRef = useRef<GitCommitEntry[]>([]);
  useEffect(() => {
    commitEntriesRef.current = commits.entries;
  }, [commits.entries]);

  const loadDiff = useCallback(async (sha: string) => {
    const request = ++diffRequest.current;
    setDiff({ loading: true, data: null, error: null });
    const query = `cwd=${encodeURIComponent(cwd)}&sha=${encodeURIComponent(sha)}`;
    try {
      const response = await fetch(`/api/git/commit-diff?${query}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as GitCommitDiffResponse & { error?: string };
      if (request !== diffRequest.current) return;
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setDiff({ loading: false, data, error: null });
    } catch (error) {
      if (request !== diffRequest.current) return;
      setDiff({ loading: false, data: null, error: gitMessage(error) });
    }
  }, [cwd]);

  // The first level reads on open, and the reload button is the only other way.
  useEffect(() => {
    setCollapsedGroups(new Set());
    setBranchFilter("");
    void loadBranches();
  }, [loadBranches]);

  const data = branches.data;
  const checkout = useMemo(
    () => (data ? currentCheckout(data.worktrees, cwd) : undefined),
    [data, cwd],
  );

  const rows = useMemo(() => (data
    ? buildBranchRows({
      branches: data.branches,
      remoteBranches: data.remoteBranches,
      worktrees: data.worktrees,
      checkoutPath: checkout?.path ?? null,
    })
    : []), [data, checkout]);

  const visibleRows = useMemo(() => filterBranchRows(rows, branchFilter), [rows, branchFilter]);
  const treeItems = useMemo(() => flattenBranchTree(
    buildBranchTree(visibleRows.filter((row) => row.kind === "branch")),
    collapsedGroups,
    // A filter box is the narrowing the fold is standing in for, so a query opens all.
    { expandAll: branchFilter.trim().length > 0 },
  ), [visibleRows, collapsedGroups, branchFilter]);
  const topRows = useMemo(() => visibleRows.filter((row) => row.kind !== "branch"), [visibleRows]);

  const toggleBranchGroup = useCallback((prefix: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  }, []);

  const openBranch = useCallback((row: BranchRow) => {
    setSelectedBranch(row);
    setSelectedCommit(null);
    setShownFile(null);
    setDiff({ loading: false, data: null, error: null });
    void loadCommits(row.name, 0);
  }, [loadCommits]);

  const backToBranches = useCallback(() => {
    setSelectedBranch(null);
    setSelectedCommit(null);
    setShownFile(null);
  }, []);

  const backToCommits = useCallback(() => {
    setSelectedCommit(null);
    setShownFile(null);
  }, []);

  const openCommit = useCallback((commit: GitCommitEntry) => {
    setSelectedCommit(commit);
    setShownFile(null);
    void loadDiff(commit.sha);
  }, [loadDiff]);

  const fetchBranches = useCallback(async () => {
    if (!data) return;
    setFetching(true);
    try {
      const fresh = await fetchRemoteBranches(data.projectRoot);
      setBranches({
        loading: false,
        data: { ...data, branches: fresh.branches, remoteBranches: fresh.remoteBranches },
      });
    } catch (error) {
      setBranches({ loading: false, data: { ...data, isGit: data.isGit, loaded: true } });
      setCommits((current) => ({ ...current, error: gitMessage(error) }));
    } finally {
      setFetching(false);
    }
  }, [data]);

  const commitTitle = useCallback((row: BranchRow) => (
    row.kind === "current"
      ? t("gitPanel.currentBranchCommits", { branch: row.name })
      : row.remote
        ? t("gitPanel.remoteBranchCommits", { branch: row.name })
        : t("gitPanel.branchCommits", { branch: row.name })
  ), [t]);

  const panelTitle = selectedCommit
    ? selectedCommit.shortSha
    : selectedBranch
      ? selectedBranch.name
      : t("gitPanel.branchesTitle");

  const files = diff.data?.files ?? [];
  const wholePatch = diff.data?.patch ?? "";
  const patch = shownFile ? patchForFile(wholePatch, shownFile) : wholePatch;
  const shownFileEntry = shownFile ? files.find((file) => file.path === shownFile) ?? null : null;

  return (
    <div
      id="git-panel"
      className="git-panel"
      role="region"
      aria-label={t("gitPanel.title")}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (selectedCommit) {
          event.stopPropagation();
          backToCommits();
        } else if (selectedBranch) {
          event.stopPropagation();
          backToBranches();
        }
      }}
    >
      <div className="git-panel-heading">
        {selectedCommit && (
          <button
            type="button"
            className="git-panel-back"
            onClick={backToCommits}
            title={t("gitPanel.backToCommits", { branch: selectedBranch?.name ?? "" })}
            aria-label={t("gitPanel.backToCommits", { branch: selectedBranch?.name ?? "" })}
          >
            <ChevronIcon className="is-back" />
          </button>
        )}
        {!selectedCommit && selectedBranch && (
          <button
            type="button"
            className="git-panel-back"
            onClick={backToBranches}
            title={t("gitPanel.backToBranches")}
            aria-label={t("gitPanel.backToBranches")}
          >
            <ChevronIcon className="is-back" />
          </button>
        )}
        <span className="git-panel-title">
          {!selectedCommit && <BranchIcon size={12} />}
          <span className="git-panel-title-text" title={selectedCommit?.subject ?? selectedBranch?.name}>
            {panelTitle}
          </span>
          {/* The folder this panel reads, behind the title. It is a fact about the whole
              panel — which repository the branches, the commits and the diff below come
              from — so it belongs to the heading, and it never takes a line from the
              branch list the way the row above the list used to. The label is the
              home-relative form; the full path stays in the title. */}
          {data?.isGit && checkout && (
            <span className="git-panel-heading-path" title={checkout.path}>
              {shortenPath(checkout.path)}
            </span>
          )}
        </span>
        <span className="git-panel-actions">
          {selectedCommit ? (
            <button
              type="button"
              className="git-panel-action"
              disabled={diff.loading}
              onClick={() => void loadDiff(selectedCommit.sha)}
              title={t("gitPanel.reload")}
              aria-label={t("gitPanel.reload")}
            >
              <ReloadIcon spinning={diff.loading} />
            </button>
          ) : selectedBranch ? (
            <button
              type="button"
              className="git-panel-action"
              disabled={commits.loading}
              onClick={() => void loadCommits(selectedBranch.name, 0)}
              title={t("gitPanel.reload")}
              aria-label={t("gitPanel.reload")}
            >
              <ReloadIcon spinning={commits.loading} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className="git-panel-action"
                disabled={fetching}
                onClick={() => void fetchBranches()}
                title={fetching ? t("sidebar.fetchingBranches") : t("sidebar.fetchBranchesTitle")}
                aria-label={fetching ? t("sidebar.fetchingBranches") : t("sidebar.fetchBranches")}
              >
                <ReloadIcon spinning={fetching} />
              </button>
              <button
                type="button"
                className="git-panel-action"
                disabled={branches.loading}
                onClick={() => void loadBranches()}
                title={t("gitPanel.reload")}
                aria-label={t("gitPanel.reload")}
              >
                <ReloadIcon spinning={branches.loading} />
              </button>
            </>
          )}
        </span>
      </div>

      {/* ─── Level 1: the branch tree ─── */}
      {!selectedBranch && (
        <>
          {data?.isGit && rows.length > BRANCH_FILTER_THRESHOLD && (
            <input
              className="git-panel-filter"
              type="text"
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              placeholder={t("sidebar.filterBranches")}
              aria-label={t("sidebar.filterBranches")}
              title={t("sidebar.filterBranchesTitle")}
              spellCheck={false}
            />
          )}
          <div className="git-panel-list">
            {branches.loading && !data && (
              <p className="git-panel-hint">{t("gitPanel.branchesLoading")}</p>
            )}
            {data && !data.isGit && (
              <p className="git-panel-hint" role="status">{t("gitPanel.notGit")}</p>
            )}
            {data?.isGit && checkout && !checkout.branch && (
              <p className="git-panel-hint" role="status">{t("gitPanel.detached")}</p>
            )}
            {data?.isGit && topRows.map((row) => (
              <button
                key={`${row.name}`}
                type="button"
                className="git-panel-row git-branch-row"
                aria-current={row.kind === "current" ? "true" : undefined}
                title={commitTitle(row)}
                onClick={() => openBranch(row)}
              >
                <BranchMark row={row} />
                <span className="sidebar-project-context-menu-branch-name" data-branch={row.name}>{row.name}</span>
                {row.remote && <span className="sidebar-project-context-menu-branch-tag">{t("sidebar.remoteBranchTag")}</span>}
                <IntoIcon />
              </button>
            ))}
            {data?.isGit && treeItems.map((item: BranchListItem) => item.type === "group"
              ? (
                <button
                  key={`group:${item.group.prefix}`}
                  type="button"
                  className="git-panel-row git-branch-group"
                  style={{ "--branch-depth": item.depth } as React.CSSProperties}
                  aria-expanded={!item.collapsed}
                  aria-label={t(item.collapsed ? "sidebar.branchGroupExpand" : "sidebar.branchGroupCollapse", { group: item.group.prefix })}
                  title={t(item.collapsed ? "sidebar.branchGroupExpand" : "sidebar.branchGroupCollapse", { group: item.group.prefix })}
                  onClick={() => toggleBranchGroup(item.group.prefix)}
                >
                  <span className={`sidebar-project-context-menu-branch-chevron${item.collapsed ? " is-collapsed" : ""}`} aria-hidden="true">
                    <ChevronIcon />
                  </span>
                  <span className="sidebar-project-context-menu-branch-mark is-plain"><ProjectFolderIcon /></span>
                  <span className="sidebar-project-context-menu-branch-name" data-group={item.group.prefix}>{item.label}</span>
                  {item.collapsed && (
                    <span className="sidebar-project-context-menu-branch-tag">
                      {t("sidebar.branchGroupCount", { count: item.count })}
                    </span>
                  )}
                </button>
              )
              : (
                <button
                  key={`${item.row.remote ? "remote:" : "local:"}${item.row.name}`}
                  type="button"
                  className="git-panel-row git-branch-row"
                  style={{ "--branch-depth": item.depth } as React.CSSProperties}
                  title={commitTitle(item.row)}
                  onClick={() => openBranch(item.row)}
                >
                  <BranchMark row={item.row} />
                  <span className="sidebar-project-context-menu-branch-name" data-branch={item.row.name}>{item.label}</span>
                  {item.row.remote && <span className="sidebar-project-context-menu-branch-tag">{t("sidebar.remoteBranchTag")}</span>}
                  <IntoIcon />
                </button>
              ))}
            {data?.isGit && !branches.loading && rows.length === 0 && (
              <p className="git-panel-hint" role="status">{t("gitPanel.noBranches")}</p>
            )}
            {data?.isGit && branchFilter.trim() && visibleRows.length === 0 && (
              <p className="git-panel-hint" role="status">{t("sidebar.noBranchMatches", { query: branchFilter.trim() })}</p>
            )}
          </div>
        </>
      )}

      {/* ─── Level 2: the branch's commits ─── */}
      {selectedBranch && !selectedCommit && (
        <div className="git-panel-list">
          {commits.loading && (
            <p className="git-panel-hint">{t("gitPanel.commitsLoading", { branch: selectedBranch.name })}</p>
          )}
          {commits.error && (
            <p className="git-panel-hint git-panel-error" role="alert">{t("gitPanel.commitsError", { message: commits.error })}</p>
          )}
          {!commits.loading && !commits.error && commits.entries.length === 0 && (
            <p className="git-panel-hint" role="status">{t("gitPanel.noCommits", { branch: selectedBranch.name })}</p>
          )}
          {commits.entries.map((commit) => (
            <button
              key={commit.sha}
              type="button"
              className="git-panel-row git-commit-row"
              title={commit.subject}
              onClick={() => openCommit(commit)}
            >
              <span className="git-commit-top">
                <span className="git-commit-subject">{commit.subject}</span>
                <IntoIcon />
              </span>
              <span className="git-commit-meta">
                <span className="git-commit-author">{commit.authorName}</span>
                <span className="git-commit-time">
                  {commit.dateMs ? formatCompactRelativeTime(new Date(commit.dateMs), locale) : ""}
                </span>
                <code className="git-commit-sha" title={commit.sha}>{commit.shortSha}</code>
              </span>
            </button>
          ))}
          {commits.hasMore && (
            <button
              type="button"
              className="git-panel-more"
              disabled={commits.loadingMore}
              onClick={() => void loadCommits(selectedBranch.name, Math.max(1, Math.ceil(commits.entries.length / COMMIT_PAGE_SIZE)))}
            >
              {commits.loadingMore ? t("i18n.loading") : t("i18n.loadMore")}
            </button>
          )}
        </div>
      )}

      {/* ─── Level 3: one commit's diff ─── */}
      {selectedCommit && (
        <>
          <div className="git-panel-commit-meta">
            <span className="git-panel-commit-line">
              <span className="git-panel-commit-author">{selectedCommit.authorName}</span>
              {selectedCommit.dateMs && (
                <>
                  <span className="git-panel-dot" aria-hidden="true">·</span>
                  <span>{formatCompactRelativeTime(new Date(selectedCommit.dateMs), locale)}</span>
                </>
              )}
              {selectedCommit.parentCount > 1 && (
                <>
                  <span className="git-panel-dot" aria-hidden="true">·</span>
                  <span title={t("gitPanel.mergeCommitHint")}>
                    {t("gitPanel.mergeCommit", { count: selectedCommit.parentCount })}
                  </span>
                </>
              )}
            </span>
            <span className="git-panel-commit-subject" title={selectedCommit.subject}>{selectedCommit.subject}</span>
            <code className="git-commit-sha" title={selectedCommit.sha}>{selectedCommit.shortSha}</code>
          </div>

          <div className="git-panel-file-list">
            {files.map((file) => (
              <div key={`${file.status}:${file.path}`} className="git-panel-row git-file-row">
                <button
                  type="button"
                  className="git-file-row-main"
                  aria-pressed={shownFile === file.path}
                  title={file.oldPath
                    ? t("gitPanel.fileRenamedTitle", { from: file.oldPath, to: file.path })
                    : t("gitPanel.fileDiffTitle", { file: file.path })}
                  onClick={() => setShownFile(shownFile === file.path ? null : file.path)}
                >
                  <span className={`git-file-status is-${file.status}`} aria-hidden="true">{statusLetter(file)}</span>
                  <span className="git-file-path" title={file.path}>{file.path}</span>
                  {(file.additions !== null || file.deletions !== null) && (
                    <span className="git-file-counts">
                      <span className="git-file-additions">+{file.additions ?? 0}</span>
                      <span className="git-file-deletions">−{file.deletions ?? 0}</span>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="git-file-open"
                  title={t("gitPanel.openFile", { file: file.path.split("/").pop() ?? file.path })}
                  aria-label={t("gitPanel.openFile", { file: file.path.split("/").pop() ?? file.path })}
                  onClick={() => onOpenFile(
                    joinFilePath(diff.data?.repositoryRoot ?? cwd, file.path),
                    file.path.split("/").pop() ?? file.path,
                  )}
                >
                  <OpenFileIcon />
                </button>
              </div>
            ))}
            {files.length > 1 && (
              <button
                type="button"
                className="git-panel-more"
                aria-pressed={shownFile === null}
                onClick={() => setShownFile(null)}
              >
                {t("gitPanel.allFiles", { count: files.length })}
              </button>
            )}
          </div>

          <div className="git-panel-diff">
            {diff.loading && (
              <p className="git-panel-hint">{t("gitPanel.loadingDiff")}</p>
            )}
            {diff.error && (
              <p className="git-panel-hint git-panel-error" role="alert">{t("gitPanel.diffError", { message: diff.error })}</p>
            )}
            {!diff.loading && !diff.error && diff.data && !diff.data.supported && (
              <p className="git-panel-hint" role="status">
                {diff.data.reason === "too-large" ? t("gitPanel.diffTooLarge") : t("gitPanel.noChanges")}
              </p>
            )}
            {!diff.loading && diff.data?.supported && patch && (
              <>
                {shownFileEntry && (
                  <p className="git-panel-note git-panel-diff-note" title={shownFileEntry.path}>
                    {shownFileEntry.path}
                    <button type="button" className="git-panel-note-clear" onClick={() => setShownFile(null)}>
                      {t("gitPanel.showAllFiles")}
                    </button>
                  </p>
                )}
                <DiffView patch={patch} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The glyph of a branch row: the three facts the branch menu's rows already name. */
function BranchMark({ row }: { row: BranchRow }) {
  return (
    <span className={`sidebar-project-context-menu-branch-mark${row.kind === "branch" ? " is-plain" : ""}`}>
      {row.kind === "worktree" || (row.kind === "current" && !row.holderIsMain)
        ? <WorktreeIcon />
        : row.kind === "branch"
          ? <BranchIcon />
          : <ProjectFolderIcon />}
    </span>
  );
}
