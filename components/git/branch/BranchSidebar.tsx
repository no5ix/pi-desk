"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { buildBranchTree, flattenBranchTree, type BranchRow } from "@/lib/branch-tree";
import { filterBranchRows } from "../../ProjectContextMenu";
import { remoteBranchRows } from "./remote-rows";
import { BranchIcon, WorktreeIcon } from "../../GitIcons";
import {
  GitCheckbox,
  GitDialog,
  GitIconButton,
  GitMenu,
  GitRowMenuButton,
  GitState,
  GitTextInput,
  useGitMenu,
  type GitMenuItem,
  type GitMenuState,
} from "../git-ui";
import {
  gitCommand,
  useGitMutation,
  useGitQuery,
  type GitTarget,
} from "../git-api";

/**
 * The branch tree — Branchshift's Local / Remote / Tags tree, in the app's
 * branch-list vocabulary.
 *
 * The rows are built with the sidebar's own tree model (`lib/branch-tree`:
 * a `/`-separated name is a folder that collapses), the git data comes from the
 * ported backend, and the star is Branchshift's dashboard favourite. Selecting a
 * row is the log's filter; the menu is where the branch operations live.
 */

export interface GitRefIdentity {
  type: "local" | "remote" | "tag" | "detached";
  name: string;
  fullRef: string;
}

type GitBranchRow = BranchRow & { info: import("@/lib/git/types").BranchInfo };

interface Props {
  target: GitTarget;
  refreshToken: number;
  selected: GitRefIdentity | null;
  onSelect: (ref: GitRefIdentity | null) => void;
  onBusy: (label: string | null) => void;
  onChanged: () => void;
  onCompare?: (ref: GitRefIdentity) => void;
  onOpenWorktree?: (path: string) => void;
  worktreePaths?: string[];
}

interface BranchDashboardState {
  preferences: { showTags: boolean; singleClickAction: "filter" | "navigate" };
  favorites: Record<string, string[]>;
}

function identity(row: BranchRow, fullRef: string): GitRefIdentity {
  return {
    type: row.remote ? "remote" : "local",
    name: row.name,
    fullRef,
  };
}

export function BranchSidebar({
  target,
  refreshToken,
  selected,
  onSelect,
  onBusy,
  onChanged,
  onCompare,
  onOpenWorktree,
  worktreePaths = [],
}: Props) {
  const { t } = useI18n();
  const { menu, open, close } = useGitMenu();
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<null | { kind: "create"; from: string } | { kind: "rename"; name: string } | { kind: "tag"; from: string }>(null);
  const { run, busy, error, clearError } = useGitMutation(target);
  const branches = useGitQuery<import("@/lib/git/types").BranchInfo[]>(target, "getBranches", {}, { deps: [refreshToken] });
  // The answer is per remote — `{ remote, branches }` — not a list of
  // `BranchInfo`. `remoteBranchRows` is what turns it into rows; reading the
  // groups directly leaves `name` undefined and the branch tree crashes on it.
  const remoteBranches = useGitQuery<import("@/lib/git/types").RemoteBranchGroup[]>(target, "getRemoteBranches", {}, { deps: [refreshToken] });
  const tags = useGitQuery<import("@/lib/git/types").TagInfo[]>(target, "getTags", {}, { deps: [refreshToken] });
  const dashboard = useGitQuery<BranchDashboardState>(target, "getBranchDashboardPreferences", {}, { deps: [refreshToken] });

  const favorites = dashboard.data?.favorites ?? {};
  const isFavorite = (type: string, name: string) => (favorites[type] ?? []).includes(name);
  const query = filter.trim();

  const localRows = useMemo(() => (branches.data ?? []).map((branch) => ({
    name: branch.name,
    remote: false,
    kind: branch.isCurrent ? "current" as const : branch.checkedOutWorktreePath ? "worktree" as const : "branch" as const,
    holderPath: branch.checkedOutWorktreePath ?? null,
    holderIsMain: false,
    info: branch,
  })), [branches.data]);
  const remoteRows = useMemo(() => remoteBranchRows(remoteBranches.data ?? []), [remoteBranches.data]);

  const localItems = useMemo(() => flattenBranchTree(
    buildBranchTree(filterBranchRows(localRows, query)),
    collapsed,
    { expandAll: query.length > 0 },
  ), [localRows, query, collapsed]);
  const remoteItems = useMemo(() => flattenBranchTree(
    buildBranchTree(filterBranchRows(remoteRows, query)),
    collapsed,
    { expandAll: query.length > 0 },
  ), [remoteRows, query, collapsed]);

  const filteredTags = useMemo(() => {
    const list = tags.data ?? [];
    if (!query) return list;
    return list.filter((tag) => tag.name.toLowerCase().includes(query.toLowerCase()));
  }, [tags, query]);

  const refreshAll = () => {
    branches.reload();
    remoteBranches.reload();
    tags.reload();
    dashboard.reload();
  };

  const act = async (label: string, command: string, params: Record<string, unknown> = {}) => {
    onBusy(label);
    const result = await run(command, params);
    onBusy(null);
    if (result === null && command !== "getAheadCommits") return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    refreshAll();
    onChanged();
  };

  const toggleFavorite = (type: "local" | "remote" | "tag", name: string) =>
    void run("setFavorite", { name, type, favorite: !isFavorite(type, name) }).then(() => dashboard.reload());

  const branchMenu = (row: GitBranchRow, anchor: Element): GitMenuItem[] => {
    const current = row.info.isCurrent;
    const items: GitMenuItem[] = [
      {
        id: "filter",
        label: t("git.branchFilter"),
        disabled: !row.info.lastCommitHash,
        onSelect: () => onSelect(identity(row, row.info.fullRef)),
      },
      {
        id: "compare",
        label: t("git.branchCompare"),
        disabled: current || !row.info.lastCommitHash,
        onSelect: () => onCompare?.(identity(row, row.info.fullRef)),
      },
      { id: "sep1", label: "", separator: true },
      {
        id: "checkout",
        label: row.remote ? t("git.branchCheckoutNew") : t("git.branchCheckout"),
        disabled: current || Boolean(busy),
        onSelect: () => void act(t("git.branchCheckout"), "checkoutBranch", { branch: row.name }),
      },
      {
        id: "update",
        label: t("git.branchUpdate"),
        disabled: row.remote || current || Boolean(busy),
        onSelect: () => void act(t("git.branchUpdate"), "updateBranch", { branch: row.name }),
      },
      {
        id: "push",
        label: t("git.branchPush"),
        disabled: row.remote || Boolean(busy),
        onSelect: () => void act(t("git.branchPush"), "pushBranch", { branch: row.name }),
      },
      {
        id: "force-push",
        label: t("git.branchForcePush"),
        disabled: row.remote || Boolean(busy),
        onSelect: () => void act(t("git.branchForcePush"), "pushBranch", { branch: row.name, force: true }),
      },
      {
        id: "pull",
        label: t("git.branchPull"),
        disabled: row.remote || Boolean(busy),
        onSelect: () => void act(t("git.branchPull"), "pullBranch", { branch: row.name }),
      },
      {
        id: "fetch",
        label: t("git.branchFetch"),
        disabled: !row.remote || Boolean(busy),
        onSelect: () => void act(t("git.branchFetch"), "fetchBranch", { branch: row.name }),
      },
      { id: "sep2", label: "", separator: true },
      {
        id: "merge",
        label: t("git.branchMerge"),
        disabled: current || row.remote || !row.info.lastCommitHash || Boolean(busy),
        onSelect: () => void act(t("git.branchMerge"), "mergeBranch", { branch: row.name }),
      },
      {
        id: "rebase",
        label: t("git.branchRebaseOnto"),
        disabled: current || row.remote || !row.info.lastCommitHash || Boolean(busy),
        onSelect: () => void act(t("git.branchRebaseOnto"), "rebaseBranch", { onto: row.name }),
      },
      {
        id: "checkout-rebase",
        label: t("git.branchCheckoutAndRebase"),
        disabled: current || row.remote || !row.info.lastCommitHash || Boolean(busy),
        onSelect: () => void act(t("git.branchCheckoutAndRebase"), "checkoutAndRebase", { branch: row.name, onto: "HEAD" }),
      },
      { id: "sep3", label: "", separator: true },
      {
        id: "new-branch",
        label: t("git.branchNew"),
        onSelect: () => setDialog({ kind: "create", from: row.name }),
      },
      {
        id: "new-tag",
        label: t("git.tagNew"),
        onSelect: () => setDialog({ kind: "tag", from: row.name }),
      },
      {
        id: "rename",
        label: t("git.branchRename"),
        disabled: row.remote || current || Boolean(busy),
        onSelect: () => setDialog({ kind: "rename", name: row.name }),
      },
      {
        id: "favorite",
        label: isFavorite(row.remote ? "remote" : "local", row.name) ? t("git.unfavorite") : t("git.favorite"),
        checked: isFavorite(row.remote ? "remote" : "local", row.name),
        onSelect: () => toggleFavorite(row.remote ? "remote" : "local", row.name),
      },
      { id: "sep4", label: "", separator: true },
      {
        id: "copy",
        label: t("git.copyName"),
        onSelect: () => void navigator.clipboard?.writeText(row.name).catch(() => {}),
      },
      {
        id: "delete",
        label: t("git.branchDelete"),
        danger: true,
        disabled: current || Boolean(busy),
        onSelect: () => void act(t("git.branchDelete"), "deleteBranch", { branch: row.name, force: false }),
      },
    ];
    if (row.holderPath && onOpenWorktree) {
      items.splice(3, 0, {
        id: "open-worktree",
        label: t("git.openWorktree"),
        hint: row.holderPath.split("/").pop(),
        onSelect: () => onOpenWorktree(row.holderPath!),
      });
    }
    return items;
  };

  const tagMenu = (name: string, hash: string): GitMenuItem[] => [
    {
      id: "filter",
      label: t("git.tagFilter"),
      onSelect: () => onSelect({ type: "tag", name, fullRef: `refs/tags/${name}` }),
    },
    {
      id: "checkout",
      label: t("git.tagCheckout"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.tagCheckout"), "checkoutCommit", { hash }),
    },
    {
      id: "merge",
      label: t("git.branchMerge"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.branchMerge"), "mergeBranch", { branch: name }),
    },
    { id: "sep", label: "", separator: true },
    {
      id: "delete",
      label: t("git.tagDelete"),
      danger: true,
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.tagDelete"), "deleteBranch", { branch: name, force: true }),
    },
  ];

  const loading = branches.loading && !branches.data;
  const isEmpty = !loading && (branches.data?.length ?? 0) === 0 && (remoteBranches.data?.length ?? 0) === 0;

  const toggleGroup = (prefix: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });
  };

  const allCollapsed = () => {
    const prefixes: string[] = [];
    for (const items of [localItems, remoteItems]) {
      for (const item of items) if (item.type === "group") prefixes.push(item.group.prefix);
    }
    setCollapsed(new Set(prefixes));
  };

  const expandAll = () => setCollapsed(new Set());

  return (
    <div className="git-branch-sidebar" data-git-section="branches">
      <div className="git-panel-section-header">
        <span className="git-panel-section-title">{t("git.branchesTitle")}</span>
        <span className="git-panel-section-count">{(branches.data?.length ?? 0) + (remoteBranches.data?.length ?? 0)}</span>
        <span className="git-toolbar-spacer" />
        <GitIconButton label={t("git.expandAll")} onClick={expandAll} disabled={localItems.length === 0}>
          <ExpandIcon collapsed />
        </GitIconButton>
        <GitIconButton label={t("git.collapseAll")} onClick={allCollapsed} disabled={localItems.length === 0}>
          <ExpandIcon />
        </GitIconButton>
        <GitIconButton label={t("gitPanel.reload")} onClick={refreshAll} disabled={branches.loading}>
          <RefreshIcon />
        </GitIconButton>
      </div>

      <div className="git-search-row">
        <input
          className="git-search-input"
          type="search"
          value={filter}
          placeholder={t("git.searchBranches")}
          aria-label={t("git.searchBranches")}
          onChange={(event) => setFilter(event.target.value)}
        />
        <GitIconButton
          label={t("git.branchNew")}
          onClick={() => setDialog({ kind: "create", from: (branches.data?.find((branch) => branch.isCurrent)?.name) ?? "HEAD" })}
        >
          <PlusIcon />
        </GitIconButton>
      </div>

      {branches.error ? <GitState kind="error" text={branches.error.message} onRetry={branches.reload} /> : null}
      {loading ? <GitState kind="loading" text={t("git.branchesLoading")} /> : null}
      {isEmpty ? <GitState kind="empty" text={t("git.branchesEmpty")} /> : null}
      {error ? <GitState kind="error" text={error.message} onRetry={clearError} /> : null}

      <div className="git-tree-scroll" role="tree" aria-label={t("git.branchesTitle")}>
        <TreeSection
          title={t("git.sectionLocal")}
          count={localRows.length}
          collapsedState={Boolean(sectionCollapsed.local)}
          onToggleSection={() => setSectionCollapsed((current) => ({ ...current, local: !current.local }))}
        >
          {localItems.map((item, index) =>
            item.type === "group" ? (
              <GroupRow
                key={`g-${item.group.prefix}`}
                item={item}
                onToggle={() => toggleGroup(item.group.prefix)}
              />
            ) : (
              <BranchRowView
                key={`l-${item.row.name}-${index}`}
                row={item.row as GitBranchRow}
                depth={item.depth}
                label={item.label}
                selected={selected?.type === "local" && selected.name === item.row.name}
                favorite={isFavorite("local", item.row.name)}
                busy={Boolean(busy)}
                worktreePaths={worktreePaths}
                onOpen={() => onSelect(identity(item.row as GitBranchRow, (item.row as GitBranchRow).info.fullRef))}
                onFavorite={() => toggleFavorite("local", item.row.name)}
                onMenu={(anchor) => open(anchor, branchMenu(item.row as GitBranchRow, anchor))}
              />
            ),
          )}
        </TreeSection>

        <TreeSection
          title={t("git.sectionRemote")}
          count={remoteRows.length}
          collapsedState={Boolean(sectionCollapsed.remote)}
          onToggleSection={() => setSectionCollapsed((current) => ({ ...current, remote: !current.remote }))}
        >
          {remoteItems.map((item, index) =>
            item.type === "group" ? (
              <GroupRow
                key={`r-${item.group.prefix}`}
                item={item}
                onToggle={() => toggleGroup(item.group.prefix)}
              />
            ) : (
              <BranchRowView
                key={`m-${item.row.name}-${index}`}
                row={item.row as GitBranchRow}
                depth={item.depth}
                label={item.label}
                selected={selected?.type === "remote" && selected.name === item.row.name}
                favorite={isFavorite("remote", item.row.name)}
                busy={Boolean(busy)}
                worktreePaths={worktreePaths}
                onOpen={() => onSelect(identity(item.row as GitBranchRow, (item.row as GitBranchRow).info.fullRef))}
                onFavorite={() => toggleFavorite("remote", item.row.name)}
                onMenu={(anchor) => open(anchor, branchMenu(item.row as GitBranchRow, anchor))}
              />
            ),
          )}
        </TreeSection>

        {dashboard.data?.preferences.showTags !== false ? (
          <TreeSection
            title={t("git.sectionTags")}
            count={filteredTags.length}
            collapsedState={Boolean(sectionCollapsed.tags)}
            onToggleSection={() => setSectionCollapsed((current) => ({ ...current, tags: !current.tags }))}
          >
            {filteredTags.map((tag) => (
              <div
                key={tag.fullRef}
                className={`git-branch-row is-tag${selected?.type === "tag" && selected.name === tag.name ? " is-selected" : ""}`}
                role="treeitem"
                tabIndex={0}
                onClick={() => onSelect({ type: "tag", name: tag.name, fullRef: tag.fullRef })}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSelect({ type: "tag", name: tag.name, fullRef: tag.fullRef });
                }}
                // Right click belongs to the browser (Safari: Back, Reload,
                // Inspect…). A git menu on the row's own ⋮, where the user looks
                // for it — see the Log's commit row, same rule.
                onContextMenu={(event) => {
                  event.stopPropagation();
                }}
              >
                <span className="git-branch-mark"><TagIcon /></span>
                <span className="sidebar-project-context-menu-branch-name">{tag.name}</span>
                {isFavorite("tag", tag.name) ? <span className="git-branch-star is-on" aria-hidden="true">★</span> : null}
                <GitRowMenuButton
                  label={t("git.rowMenu")}
                  items={tagMenu(tag.name, tag.targetCommitHash)}
                  onOpen={(anchor) => open(anchor, tagMenu(tag.name, tag.targetCommitHash))}
                />
              </div>
            ))}
          </TreeSection>
        ) : null}
      </div>

      {menu ? <GitMenu menu={menu} onDone={close} /> : null}

      {dialog ? (
        <GitDialog
          title={dialog.kind === "rename" ? t("git.branchRename") : dialog.kind === "tag" ? t("git.tagNew") : t("git.branchNew")}
          onClose={() => setDialog(null)}
          width={420}
        >
          <BranchDialog
            dialog={dialog}
            onCancel={() => setDialog(null)}
            onSubmit={async (values) => {
              if (dialog.kind === "create") {
                await act(t("git.branchNew"), "createBranch", { name: values.name, startPoint: dialog.from, checkout: values.checkout });
              } else if (dialog.kind === "rename") {
                await act(t("git.branchRename"), "renameBranch", { oldName: dialog.name, newName: values.name });
              } else {
                await act(t("git.tagNew"), "createTag", { tagName: values.name, hash: dialog.from, message: values.message });
              }
              setDialog(null);
            }}
            busy={Boolean(busy)}
          />
        </GitDialog>
      ) : null}
    </div>
  );
}

function TreeSection({
  title,
  count,
  collapsedState,
  onToggleSection,
  children,
}: {
  title: string;
  count: number;
  collapsedState: boolean;
  onToggleSection: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`git-tree-section${collapsedState ? " is-collapsed" : ""}`}>
      <button type="button" className="git-tree-section-header" onClick={onToggleSection} aria-expanded={!collapsedState}>
        <span className="sidebar-project-context-menu-branch-chevron">
          <ChevronIcon open={!collapsedState} />
        </span>
        <span className="git-tree-section-title">{title}</span>
        <span className="git-tree-section-count">{count}</span>
      </button>
      {collapsedState ? null : <div className="git-tree-section-body">{children}</div>}
    </div>
  );
}

function GroupRow({
  item,
  onToggle,
}: {
  item: Extract<ReturnType<typeof flattenBranchTree>[number], { type: "group" }>;
  onToggle: () => void;
}) {
  return (
    <div
      className="git-branch-row is-group"
      role="treeitem"
      aria-expanded={!item.collapsed}
      tabIndex={0}
      style={{ paddingLeft: 8 + item.depth * 14 }}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <span className="sidebar-project-context-menu-branch-chevron">
        <ChevronIcon open={!item.collapsed} />
      </span>
      <span className="git-folder-mark"><FolderIcon /></span>
      <span className="sidebar-project-context-menu-branch-name">{item.label}</span>
      <span className="git-tree-section-count">{item.count}</span>
    </div>
  );
}

function BranchRowView({
  row,
  depth,
  label,
  selected,
  favorite,
  busy,
  worktreePaths,
  onOpen,
  onFavorite,
  onMenu,
}: {
  row: GitBranchRow;
  depth: number;
  label: string;
  selected: boolean;
  favorite: boolean;
  busy: boolean;
  worktreePaths: string[];
  onOpen: () => void;
  onFavorite: () => void;
  onMenu: (anchor: Element) => void;
}) {
  const { t } = useI18n();
  const info = row.info;
  const inOtherWorktree = Boolean(info.checkedOutWorktreePath);
  return (
    <div
      className={`git-branch-row sidebar-project-context-menu-branch${selected ? " is-selected" : ""}${info.isCurrent ? " is-current" : ""}`}
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      style={{ paddingLeft: 8 + depth * 14 }}
      title={info.upstream ? `${info.name} → ${info.upstream}` : info.name}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen();
      }}
      // No git menu on right click: `preventDefault` takes the browser's menu
      // away, and the user wants theirs. The row's ⋮ opens the git menu.
      onContextMenu={(event) => {
        event.stopPropagation();
      }}
    >
      <span className="sidebar-project-context-menu-branch-mark">
        {info.isCurrent ? <BranchIcon /> : inOtherWorktree ? <WorktreeIcon /> : <BranchIcon />}
      </span>
      <span className="sidebar-project-context-menu-branch-name">{label}</span>
      {row.remote ? <span className="git-branch-tag">{t("sidebar.remoteBranchTag")}</span> : null}
      {info.isCurrent ? <span className="git-branch-current-mark">•</span> : null}
      {info.ahead || info.behind ? (
        <span className="git-branch-track" title={t("git.aheadBehind", { ahead: info.ahead, behind: info.behind })}>
          {info.ahead ? `↑${info.ahead}` : ""}
          {info.behind ? `↓${info.behind}` : ""}
        </span>
      ) : null}
      <button
        type="button"
        className={`git-branch-star${favorite ? " is-on" : ""}`}
        title={favorite ? t("git.unfavorite") : t("git.favorite")}
        aria-label={favorite ? t("git.unfavorite") : t("git.favorite")}
        aria-pressed={favorite}
        onClick={(event) => {
          event.stopPropagation();
          onFavorite();
        }}
      >
        ★
      </button>
      <GitRowMenuButton
        label={t("git.rowMenu")}
        disabled={busy}
        items={[]}
        onOpen={(anchor) => onMenu(anchor)}
      />
    </div>
  );
}

function BranchDialog({
  dialog,
  onSubmit,
  onCancel,
  busy,
}: {
  dialog: { kind: "create"; from: string } | { kind: "rename"; name: string } | { kind: "tag"; from: string };
  onSubmit: (values: { name: string; checkout: boolean; message: string }) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [checkout, setCheckout] = useState(dialog.kind === "create");
  const [message, setMessage] = useState("");
  const valid = name.trim().length > 0 && !name.trim().startsWith("-") && !/\s/.test(name.trim());
  return (
    <form
      className="git-dialog-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) onSubmit({ name: name.trim(), checkout, message });
      }}
    >
      <GitTextInput
        label={dialog.kind === "rename" ? t("git.branchRenameTo") : t("git.branchName")}
        value={name}
        onChange={setName}
        autoFocus
        placeholder={dialog.kind === "tag" ? "v1.0.0" : "feature/name"}
      />
      <p className="git-dialog-note">
        {dialog.kind === "create"
          ? t("git.branchFrom", { from: dialog.from })
          : dialog.kind === "rename"
            ? t("git.branchRenameNote", { name: dialog.name })
            : t("git.tagFrom", { from: dialog.from })}
      </p>
      {dialog.kind === "create" ? (
        <label className="git-check-row">
          <GitCheckbox label={t("git.branchCheckoutAfter")} checked={checkout} onChange={setCheckout} />
          <span>{t("git.branchCheckoutAfter")}</span>
        </label>
      ) : null}
      {dialog.kind === "tag" ? (
        <GitTextInput label={t("git.tagMessage")} value={message} onChange={setMessage} />
      ) : null}
      <div className="git-dialog-actions">
        <button type="button" className="git-inline-button" onClick={onCancel}>{t("git.cancel")}</button>
        <button type="submit" className="git-inline-button is-primary" disabled={!valid || busy}>
          {dialog.kind === "rename" ? t("git.branchRename") : dialog.kind === "tag" ? t("git.tagNew") : t("git.branchNew")}
        </button>
      </div>
    </form>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" className={open ? "is-open" : ""}>
      <path d={open ? "M2 4.5 L6 8.5 L10 4.5" : "M4.5 2 L8.5 6 L4.5 10"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M1.5 4.2c0-.6.5-1.1 1.1-1.1h3.1l1.3 1.5h6.5c.6 0 1 .5 1 1.1v6c0 .6-.4 1.1-1 1.1H2.6c-.6 0-1.1-.5-1.1-1.1z" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M2.5 2.5h5.6l5.4 5.4-5.6 5.6-5.4-5.4z" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5.4" cy="5.4" r="1" fill="currentColor" />
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M8 3.4v9.2M3.4 8h9.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon({ collapsed }: { collapsed?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d={collapsed ? "M4 6l4-3 4 3M4 10l4 3 4-3" : "M4 3l4 3 4-3M4 13l4-3 4 3"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
