"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { IdeaShelfEntry, ShelveEntry, WorkingTreeFile } from "@/lib/git/types";
import { gitCommand, useGitMutation, useGitQuery, type GitTarget } from "../git-api";
import {
  GitCheckbox,
  GitDialog,
  GitErrorLine,
  GitIconButton,
  GitMenu,
  GitRowMenuButton,
  GitState,
  GitTabs,
  GitTextInput,
  formatCommitTime,
  formatFullTime,
  statusLetter,
  useGitMenu,
  type GitMenuItem,
} from "../git-ui";

/**
 * The commit workflow — Branchshift's Commit panel, with its Shelf (git stash)
 * and Idea Shelf (`.idea/shelf`) tabs.
 *
 * The rows are the working tree as git sees it (`getWorkingTreeChanges`), split
 * into Staged / Changes / Unversioned / Conflicted, each with a checkbox: the
 * checkbox *is* the index operation (stage, unstage), and a commit of a
 * selection commits exactly that selection — Branchshift's `IndexTransaction`
 * prepares the index around the commit and restores it after, so a partial
 * commit never leaves the index in a state the user did not ask for.
 */

type PanelTab = "commit" | "shelf" | "idea";

interface Props {
  target: GitTarget;
  refreshToken: number;
  currentBranch: string | null;
  onBusy: (label: string | null) => void;
  onChanged: () => void;
  onOpenFile: (filePath: string) => void;
  onOpenFileDiff: (options: { label: string; filePath: string; staged: boolean }) => void;
}

export function CommitPanel({
  target,
  refreshToken,
  currentBranch,
  onBusy,
  onChanged,
  onOpenFile,
  onOpenFileDiff,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<PanelTab>("commit");
  return (
    <div className="git-commit-panel">
      <div className="git-panel-section-header">
        <GitTabs
          value={tab}
          onChange={setTab}
          ariaLabel={t("git.commitTitle")}
          items={[
            { id: "commit", label: t("git.tabCommit") },
            { id: "shelf", label: t("git.tabShelf") },
            { id: "idea", label: t("git.tabIdeaShelf") },
          ]}
        />
      </div>
      {tab === "commit" ? (
        <CommitTab
          target={target}
          refreshToken={refreshToken}
          currentBranch={currentBranch}
          onBusy={onBusy}
          onChanged={onChanged}
          onOpenFile={onOpenFile}
          onOpenFileDiff={onOpenFileDiff}
        />
      ) : tab === "shelf" ? (
        <ShelfTab target={target} refreshToken={refreshToken} onBusy={onBusy} onChanged={onChanged} />
      ) : (
        <IdeaShelfTab target={target} refreshToken={refreshToken} onBusy={onBusy} onChanged={onChanged} />
      )}
    </div>
  );
}

// ── Commit ─────────────────────────────────────────────────────────

interface Selection {
  path: string;
  oldPath?: string;
  staged: boolean;
  status: WorkingTreeFile["status"];
}

function CommitTab({
  target,
  refreshToken,
  currentBranch,
  onBusy,
  onChanged,
  onOpenFile,
  onOpenFileDiff,
}: Omit<Props, "tab">) {
  const { t } = useI18n();
  const { menu, open, close } = useGitMenu();
  const { run, busy, error, clearError } = useGitMutation(target);
  const changes = useGitQuery<WorkingTreeFile[]>(target, "getWorkingTreeChanges", {}, { deps: [refreshToken] });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [amendMessage, setAmendMessage] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const files = changes.data ?? [];
  const groups = useMemo(() => {
    const staged = files.filter((file) => file.staged);
    const conflicted = files.filter((file) => file.status === "conflicted");
    const changesGroup = files.filter((file) => !file.staged && file.status !== "untracked" && file.status !== "conflicted");
    const untracked = files.filter((file) => !file.staged && file.status === "untracked");
    return { staged, conflicted, changes: changesGroup, untracked };
  }, [files]);

  // A refresh keeps the ticked files that are still there.
  useEffect(() => {
    setChecked((current) => {
      const alive = new Set(files.map((file) => file.path));
      const next = new Set([...current].filter((path) => alive.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [files]);

  useEffect(() => {
    if (!amend) return;
    if (amendMessage !== null) {
      setMessage(amendMessage);
      return;
    }
    void gitCommand<string>(target, "getAmendMessage").then((value) => {
      setAmendMessage(value);
      if (value) setMessage(value);
    }).catch(() => setAmendMessage(""));
  }, [amend, amendMessage, target]);

  const act = async (label: string, command: string, params: Record<string, unknown> = {}) => {
    onBusy(label);
    const result = await run(command, params);
    onBusy(null);
    if (result === null) return;
    setChecked(new Set());
    if (command === "commitChanges" || command === "commitAndPush" || command === "amendCommit") {
      setMessage("");
      setAmend(false);
      setAmendMessage(null);
    }
    await gitCommand(target, "refreshGitState").catch(() => null);
    onChanged();
    changes.reload();
  };

  const selections = (): Selection[] =>
    files
      .filter((file) => checked.has(file.path))
      .map((file) => ({ path: file.path, oldPath: file.oldPath, staged: file.staged, status: file.status }));

  const commit = (andPush: boolean) => {
    const text = message.trim();
    if (!text) {
      messageRef.current?.focus();
      return;
    }
    const picked = selections();
    if (amend) {
      void act(t("git.amend"), "amendCommit", { message: text });
      return;
    }
    void act(andPush ? t("git.commitPush") : t("git.commit"), andPush ? "commitAndPush" : "commitChanges", {
      message: text,
      amend: false,
      selections: picked.length ? picked : files.map((file) => ({ path: file.path, oldPath: file.oldPath, staged: file.staged, status: file.status })),
    });
  };

  const toggle = (path: string, value: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      if (value) next.add(path);
      else next.delete(path);
      return next;
    });
    // The checkbox is the index operation, exactly as in Branchshift.
    void act(
      value ? t("git.stage") : t("git.unstage"),
      value ? "stageFile" : "unstageFile",
      { filePath: path },
    );
  };

  const groupChecked = (list: WorkingTreeFile[]) =>
    list.length > 0 && list.every((file) => checked.has(file.path));
  const groupSome = (list: WorkingTreeFile[]) => list.some((file) => checked.has(file.path));

  const toggleGroup = (list: WorkingTreeFile[], value: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      for (const file of list) {
        if (value) next.add(file.path);
        else next.delete(file.path);
      }
      return next;
    });
    void act(
      value ? t("git.stage") : t("git.unstage"),
      value ? "stageAll" : "unstageAll",
      {},
    );
  };

  const fileMenu = (file: WorkingTreeFile): GitMenuItem[] => {
    const list = [
      {
        id: "open",
        label: t("git.openFile"),
        onSelect: () => onOpenFile(file.path),
      },
      {
        id: "diff",
        label: t("git.fileDiff"),
        onSelect: () => onOpenFileDiff({ label: file.path, filePath: file.path, staged: file.staged }),
      },
      { id: "sep0", label: "", separator: true },
      {
        id: "stage",
        label: t("git.stage"),
        disabled: file.staged || Boolean(busy),
        onSelect: () => void act(t("git.stage"), "stageFile", { filePath: file.path }),
      },
      {
        id: "unstage",
        label: t("git.unstage"),
        disabled: !file.staged || Boolean(busy),
        onSelect: () => void act(t("git.unstage"), "unstageFile", { filePath: file.path }),
      },
      { id: "sep1", label: "", separator: true },
      {
        id: "shelve",
        label: t("git.shelve"),
        disabled: Boolean(busy),
        onSelect: () => {
          const text = message.trim() || `${t("git.shelve")}: ${file.path}`;
          void act(t("git.shelve"), "shelveChanges", { message: text, filePaths: [file.path] });
        },
      },
      {
        id: "rollback",
        label: t("git.rollback"),
        danger: true,
        disabled: Boolean(busy) || file.status === "untracked" || file.staged,
        onSelect: () => void act(t("git.rollback"), "rollbackFile", { filePath: file.path }),
      },
      {
        id: "delete",
        label: t("git.deleteUntracked"),
        danger: true,
        disabled: Boolean(busy) || file.status !== "untracked",
        onSelect: () => void act(t("git.deleteUntracked"), "deleteFiles", { filePaths: [file.path] }),
      },
      { id: "sep2", label: "", separator: true },
      {
        id: "copy",
        label: t("git.copyPath"),
        onSelect: () => void navigator.clipboard?.writeText(file.path).catch(() => {}),
      },
    ];
    return list;
  };

  const picked = selections();
  const canCommit = Boolean(message.trim()) && !busy && (!amend || files.length >= 0);

  return (
    <div className="git-commit-tab">
      <div className="git-commit-toolbar">
        <GitIconButton label={t("gitPanel.reload")} onClick={changes.reload} disabled={changes.loading}>
          <RefreshIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.stageAll")}
          onClick={() => void act(t("git.stageAll"), "stageAll")}
          disabled={Boolean(busy) || files.filter((file) => !file.staged).length === 0}
        >
          <StageAllIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.unstageAll")}
          onClick={() => void act(t("git.unstageAll"), "unstageAll")}
          disabled={Boolean(busy) || groups.staged.length === 0}
        >
          <UnstageAllIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.shelve")}
          onClick={() => {
            const text = message.trim() || `${t("git.shelve")}: ${currentBranch ?? "changes"}`;
            void act(t("git.shelve"), "shelveChanges", {
              message: text,
              filePaths: picked.length ? picked.map((entry) => entry.path) : undefined,
            });
          }}
          disabled={Boolean(busy) || files.length === 0}
        >
          <ShelveIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.rollbackSelected")}
          onClick={() => {
            const paths = picked.filter((entry) => !entry.staged && entry.status !== "untracked").map((entry) => entry.path);
            if (!paths.length) return;
            void act(t("git.rollbackSelected"), "rollbackFiles", { filePaths: paths });
          }}
          disabled={Boolean(busy) || picked.length === 0}
        >
          <RollbackIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.collapseAll")}
          onClick={() => setCollapsed(new Set(["staged", "changes", "untracked", "conflicted"]))}
        >
          <ExpandIcon collapsed />
        </GitIconButton>
        <GitIconButton label={t("git.expandAll")} onClick={() => setCollapsed(new Set())}>
          <ExpandIcon />
        </GitIconButton>
      </div>

      <GitErrorLine error={error} />
      <button type="button" onClick={clearError} hidden aria-hidden="true">clear</button>

      <div className="git-change-list" role="tree" aria-label={t("git.changesTitle")}>
        {changes.loading && !changes.data ? <GitState kind="loading" text={t("git.changesLoading")} /> : null}
        {!changes.loading && files.length === 0 ? <GitState kind="empty" text={t("git.changesEmpty")} /> : null}
        {changes.error ? <GitState kind="error" text={changes.error.message} onRetry={changes.reload} /> : null}

        {([
          ["staged", t("git.groupStaged"), groups.staged],
          ["conflicted", t("git.groupConflicted"), groups.conflicted],
          ["changes", t("git.groupChanges"), groups.changes],
          ["untracked", t("git.groupUntracked"), groups.untracked],
        ] as Array<[string, string, WorkingTreeFile[]]>).map(([key, label, list]) => {
          if (!list.length) return null;
          const isCollapsed = collapsed.has(key);
          return (
            <div key={key} className={`git-change-group${isCollapsed ? " is-collapsed" : ""}`}>
              <div className="git-change-group-header">
                <GitCheckbox
                  label={`${label}: ${t("git.selectAll", { count: list.length })}`}
                  checked={groupChecked(list)}
                  indeterminate={!groupChecked(list) && groupSome(list)}
                  onChange={(value) => toggleGroup(list, value)}
                />
                <button
                  type="button"
                  className="git-change-group-title"
                  onClick={() => setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })}
                  aria-expanded={!isCollapsed}
                >
                  <span className="git-change-group-label">{label}</span>
                  <span className="git-change-group-count">{t("git.fileCount", { count: list.length })}</span>
                </button>
              </div>
              {isCollapsed ? null : list.map((file) => {
                const letter = statusLetter(file.status);
                return (
                  <div
                    key={`${file.staged ? "s" : "w"}:${file.path}`}
                    className="git-change-row"
                    role="treeitem"
                    tabIndex={0}
                    onDoubleClick={() => onOpenFileDiff({ label: file.path, filePath: file.path, staged: file.staged })}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      open(event.currentTarget, fileMenu(file));
                    }}
                  >
                    <GitCheckbox
                      label={`${file.path} — ${label}`}
                      checked={checked.has(file.path)}
                      onChange={(value) => toggle(file.path, value)}
                    />
                    <span className={`git-file-letter ${letter.className}`} title={file.status}>
                      {file.status === "untracked" ? "?" : letter.letter}
                    </span>
                    <button
                      type="button"
                      className="git-file-name"
                      title={file.path}
                      onClick={() => onOpenFile(file.path)}
                    >
                      {file.path.split("/").pop()}
                    </button>
                    <span className="git-file-path">{file.path}</span>
                    {file.oldPath ? <span className="git-file-old" title={file.oldPath}>← {file.oldPath.split("/").pop()}</span> : null}
                    <GitRowMenuButton
                      label={t("git.rowMenu")}
                      items={fileMenu(file)}
                      onOpen={(anchor) => open(anchor, fileMenu(file))}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="git-message-area">
        <div className="git-message-head">
          <label className="git-check-row">
            <GitCheckbox label={t("git.amend")} checked={amend} onChange={setAmend} />
            <span>{t("git.amend")}</span>
          </label>
          <span className="git-toolbar-spacer" />
          <button
            type="button"
            className="git-inline-button"
            onClick={() => {
              setShowRecent((value) => !value);
              if (!recent.length) {
                void gitCommand<string[]>(target, "getRecentCommitMessages", { count: 20 })
                  .then(setRecent)
                  .catch(() => setRecent([]));
              }
            }}
          >
            {t("git.recentMessages")}
          </button>
        </div>
        {showRecent ? (
          <div className="git-recent-list" role="listbox" aria-label={t("git.recentMessages")}>
            {recent.length === 0 ? <div className="git-state git-state-empty">{t("git.recentEmpty")}</div> : null}
            {recent.map((entry, index) => (
              <button
                key={`${index}-${entry.slice(0, 12)}`}
                type="button"
                role="option"
                className="git-recent-row"
                onClick={() => {
                  setMessage(entry);
                  setShowRecent(false);
                  messageRef.current?.focus();
                }}
              >
                {entry.split("\n")[0]}
              </button>
            ))}
          </div>
        ) : null}
        <textarea
          ref={messageRef}
          className="git-message-input"
          value={message}
          placeholder={amend ? t("git.amendPlaceholder") : t("git.messagePlaceholder")}
          aria-label={t("git.messagePlaceholder")}
          rows={3}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              commit(false);
            }
          }}
        />
        <div className="git-message-actions">
          <span className="git-message-count">
            {picked.length ? t("git.selectedCount", { count: picked.length }) : t("git.selectedNone")}
          </span>
          <span className="git-toolbar-spacer" />
          <button
            type="button"
            className="git-inline-button"
            disabled={!canCommit}
            onClick={() => commit(true)}
            title={t("git.commitPushHint")}
          >
            {t("git.commitPush")}
          </button>
          <button
            type="button"
            className="git-inline-button is-primary"
            disabled={!canCommit}
            onClick={() => commit(false)}
            title={`${t("git.commit")} (${navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl"}+Enter)`}
          >
            {amend ? t("git.amendCommit") : t("git.commit")}
          </button>
        </div>
      </div>

      {menu ? <GitMenu menu={menu} onDone={close} /> : null}
    </div>
  );
}

// ── Shelf (git stash) ──────────────────────────────────────────────

function ShelfTab({
  target,
  refreshToken,
  onBusy,
  onChanged,
}: Pick<Props, "target" | "refreshToken" | "onBusy" | "onChanged">) {
  const { t } = useI18n();
  const { menu, open, close } = useGitMenu();
  const { run, busy, error } = useGitMutation(target);
  const shelves = useGitQuery<ShelveEntry[]>(target, "getShelves", {}, { deps: [refreshToken] });
  const [expanded, setExpanded] = useState<string | null>(null);

  const act = async (label: string, command: string, params: Record<string, unknown> = {}) => {
    onBusy(label);
    const result = await run(command, params);
    onBusy(null);
    if (result === null) return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    onChanged();
    shelves.reload();
  };

  const menuFor = (entry: ShelveEntry): GitMenuItem[] => [
    {
      id: "unshelve",
      label: t("git.unshelve"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.unshelve"), "unshelveChanges", { stashId: entry.id, drop: true }),
    },
    {
      id: "apply",
      label: t("git.applyKeep"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.applyKeep"), "unshelveChanges", { stashId: entry.id, drop: false }),
    },
    { id: "sep1", label: "", separator: true },
    {
      id: "export",
      label: t("git.exportPatch"),
      onSelect: () => {
        void gitCommand<string>(target, "createPatchFromShelf", { stashId: entry.id })
          .then((patch) => navigator.clipboard?.writeText(patch))
          .catch(() => {});
      },
    },
    {
      id: "copy",
      label: t("git.copyMessage"),
      onSelect: () => void navigator.clipboard?.writeText(entry.message).catch(() => {}),
    },
    { id: "sep2", label: "", separator: true },
    {
      id: "delete",
      label: t("git.deleteShelf"),
      danger: true,
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.deleteShelf"), "deleteShelve", { stashId: entry.id }),
    },
  ];

  const fileMenuFor = (entry: ShelveEntry, filePath: string): GitMenuItem[] => [
    {
      id: "diff",
      label: t("git.fileDiff"),
      onSelect: () => {
        void gitCommand<string>(target, "showShelfFileDiff", { stashId: entry.id, filePath })
          .then((patch) => navigator.clipboard?.writeText(patch).catch(() => {}))
          .catch(() => {});
      },
    },
    {
      id: "unshelve-file",
      label: t("git.unshelveFile"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.unshelveFile"), "unshelveFile", { stashId: entry.id, filePath }),
    },
  ];

  return (
    <div className="git-shelf-tab">
      <div className="git-commit-toolbar">
        <GitIconButton label={t("gitPanel.reload")} onClick={shelves.reload} disabled={shelves.loading}>
          <RefreshIcon />
        </GitIconButton>
        <GitIconButton
          label={t("git.shelve")}
          onClick={() => void act(t("git.shelve"), "shelveChanges", { message: `${t("git.shelve")}: ${formatFullTime(new Date().toISOString())}` })}
          disabled={Boolean(busy)}
        >
          <ShelveIcon />
        </GitIconButton>
      </div>
      <GitErrorLine error={error} />
      {shelves.loading && !shelves.data ? <GitState kind="loading" text={t("git.shelfLoading")} /> : null}
      {!shelves.loading && (shelves.data?.length ?? 0) === 0 ? (
        <GitState kind="empty" text={t("git.shelfEmpty")} />
      ) : null}
      <div className="git-shelf-list" role="list">
        {(shelves.data ?? []).map((entry) => (
          <div key={entry.id} className={`git-shelf-row${expanded === entry.id ? " is-expanded" : ""}`} role="listitem">
            <div
              className="git-shelf-head"
              onClick={() => setExpanded((current) => (current === entry.id ? null : entry.id))}
              onKeyDown={(event) => {
                if (event.key === "Enter") setExpanded((current) => (current === entry.id ? null : entry.id));
              }}
              tabIndex={0}
              role="button"
              aria-expanded={expanded === entry.id}
            >
              <span className="git-shelf-message" title={entry.message}>{entry.message}</span>
              <span className="git-shelf-meta">
                {entry.branch ? <span className="git-shelf-branch">{entry.branch}</span> : null}
                <span title={formatFullTime(entry.date)}>{formatCommitTime(entry.date)}</span>
                <span className="git-shelf-files">{t("git.fileCount", { count: entry.files.length })}</span>
              </span>
              <GitRowMenuButton
                label={t("git.rowMenu")}
                items={menuFor(entry)}
                onOpen={(anchor) => open(anchor, menuFor(entry))}
              />
            </div>
            {expanded === entry.id ? (
              <div className="git-shelf-files-list">
                {entry.files.map((filePath) => (
                  <div
                    key={filePath}
                    className="git-file-row"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      open(event.currentTarget, fileMenuFor(entry, filePath));
                    }}
                  >
                    <span className="git-file-path">{filePath}</span>
                    <GitRowMenuButton
                      label={t("git.rowMenu")}
                      items={fileMenuFor(entry, filePath)}
                      onOpen={(anchor) => open(anchor, fileMenuFor(entry, filePath))}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {menu ? <GitMenu menu={menu} onDone={close} /> : null}
    </div>
  );
}

// ── Idea Shelf ─────────────────────────────────────────────────────

function IdeaShelfTab({
  target,
  refreshToken,
  onBusy,
  onChanged,
}: Pick<Props, "target" | "refreshToken" | "onBusy" | "onChanged">) {
  const { t } = useI18n();
  const { run, busy, error, clearError } = useGitMutation(target);
  const shelves = useGitQuery<IdeaShelfEntry[]>(target, "getIdeaShelves", {}, { deps: [refreshToken] });
  const [importOpen, setImportOpen] = useState(false);
  const [patchName, setPatchName] = useState("");
  const [patchContent, setPatchContent] = useState("");

  const act = async (label: string, command: string, params: Record<string, unknown> = {}) => {
    onBusy(label);
    const result = await run(command, params);
    onBusy(null);
    if (result === null) return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    onChanged();
    shelves.reload();
  };

  return (
    <div className="git-shelf-tab">
      <div className="git-commit-toolbar">
        <GitIconButton label={t("gitPanel.reload")} onClick={shelves.reload} disabled={shelves.loading}>
          <RefreshIcon />
        </GitIconButton>
        <GitIconButton label={t("git.importPatch")} onClick={() => setImportOpen(true)}>
          <ImportIcon />
        </GitIconButton>
      </div>
      <GitErrorLine error={error} />
      <button type="button" onClick={clearError} hidden aria-hidden="true">clear</button>
      {shelves.loading && !shelves.data ? <GitState kind="loading" text={t("git.ideaLoading")} /> : null}
      {!shelves.loading && (shelves.data?.length ?? 0) === 0 ? (
        <GitState kind="empty" text={t("git.ideaEmpty")} />
      ) : null}
      <div className="git-shelf-list" role="list">
        {(shelves.data ?? []).map((entry) => (
          <div key={entry.name} className="git-shelf-row" role="listitem">
            <div className="git-shelf-head">
              <span className="git-shelf-message" title={entry.description || entry.name}>{entry.description || entry.name}</span>
              <span className="git-shelf-meta">
                <span title={formatFullTime(entry.date)}>{formatCommitTime(entry.date)}</span>
                <span className="git-shelf-files">{t("git.fileCount", { count: entry.files.length })}</span>
              </span>
              <button
                type="button"
                className="git-inline-button"
                disabled={Boolean(busy)}
                onClick={() => void act(t("git.unshelve"), "ideaUnshelveChanges", { name: entry.name, drop: false })}
              >
                {t("git.unshelve")}
              </button>
              <button
                type="button"
                className="git-inline-button is-danger"
                disabled={Boolean(busy)}
                onClick={() => void act(t("git.deleteShelf"), "deleteIdeaShelf", { name: entry.name })}
              >
                {t("git.deleteShelf")}
              </button>
            </div>
            <div className="git-shelf-files-list">
              {entry.files.map((filePath) => (
                <div key={filePath} className="git-file-row">
                  <span className="git-file-path">{filePath}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {importOpen ? (
        <GitDialog
          title={t("git.importPatch")}
          onClose={() => setImportOpen(false)}
          width={560}
          footer={
            <>
              <button type="button" className="git-inline-button" onClick={() => setImportOpen(false)}>
                {t("git.cancel")}
              </button>
              <button
                type="button"
                className="git-inline-button is-primary"
                disabled={busy === "importPatches" || !patchName.trim() || !patchContent.trim()}
                onClick={() => {
                  void act(t("git.importPatch"), "importPatches", { name: patchName.trim(), patchContent });
                  setImportOpen(false);
                  setPatchName("");
                  setPatchContent("");
                }}
              >
                {t("git.importPatch")}
              </button>
            </>
          }
        >
          <GitTextInput label={t("git.shelfName")} value={patchName} onChange={setPatchName} autoFocus placeholder="from-clipboard" />
          <label className="git-field">
            <span className="git-field-label">{t("git.patchContent")}</span>
            <textarea
              className="git-message-input"
              rows={10}
              value={patchContent}
              aria-label={t("git.patchContent")}
              onChange={(event) => setPatchContent(event.target.value)}
            />
          </label>
          <p className="git-dialog-note">{t("git.importNote")}</p>
        </GitDialog>
      ) : null}
    </div>
  );
}

// ── icons ──────────────────────────────────────────────────────────

function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.6V5.4H10.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StageAllIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2.6 8.4l3 3 7.8-7.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UnstageAllIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ShelveIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M2.4 4.6h11.2v8.2H2.4zM2.4 4.6l2-2.2h7.2l2 2.2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function RollbackIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M3.2 7.4h6.4a3 3 0 0 1 0 6H5.4M3.2 7.4l2.6-2.6M3.2 7.4l2.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M8 2.4v7.2M4.8 6.8L8 10l3.2-3.2M2.8 12.8h10.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
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
