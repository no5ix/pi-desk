"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { patchForFile } from "@/lib/patch";
import { joinFilePath } from "@/lib/file-paths";
import type { CommitNode, DiffFile } from "@/lib/git/types";
import { DiffView } from "../../FileViewer";
import { refChips } from "./ref-chips";
import { gitCommand, useGitMutation, type GitTarget } from "../git-api";
import {
  GitErrorLine,
  GitIconButton,
  GitRowMenuButton,
  GitState,
  formatFullTime,
  statusLetter,
  useGitMenu,
  type GitMenuItem,
} from "../git-ui";
import { GitMenu } from "../git-ui";

/**
 * One commit: its message, its author, its files, and its diff.
 *
 * Branchshift's commit detail, with the diff painted by the app's own renderer
 * (`DiffView` in `components/FileViewer.tsx`) — one diff renderer for the app,
 * as the existing Git view's test insists. The file list is the ported backend's
 * (`getCommitFiles`); one file's section is cut by the shared patch parser.
 */

interface Props {
  target: GitTarget;
  commit: CommitNode | null;
  busy: string | null;
  onBusy: (label: string | null) => void;
  onChanged: () => void;
  onOpenFileDiff: (options: { from: string; to: string; file: string; label: string }) => void;
  onOpenFileAtRevision: (hash: string, filePath: string) => void;
  onOpenFileHistory: (filePath: string) => void;
  onOpenBlame: (filePath: string) => void;
  multiHashes: string[];
}

interface CommitDiffResponse {
  isGitRepository: boolean;
  supported: boolean;
  reason?: string;
  patch?: string;
  repositoryRoot?: string;
  files?: Array<{ path: string; status: string }>;
}

export function CommitDetail({
  target,
  commit,
  busy,
  onBusy,
  onChanged,
  onOpenFileDiff,
  onOpenFileAtRevision,
  onOpenFileHistory,
  onOpenBlame,
  multiHashes,
}: Props) {
  const { t } = useI18n();
  const { menu, open, close } = useGitMenu();
  const { run, error, clearError } = useGitMutation(target);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [filesKey, setFilesKey] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [patchKey, setPatchKey] = useState<string | null>(null);
  const [patchState, setPatchState] = useState<"idle" | "loading" | "too-large" | "error">("idle");
  const [patchError, setPatchError] = useState<string | null>(null);

  // The files arrive with the commit; the patch arrives when a file is picked,
  // so a wide commit's megabytes are not read for someone who only wanted the
  // message.
  const loadFiles = async (hash: string) => {
    if (filesKey === hash) return;
    setFilesKey(hash);
    setSelectedFile(null);
    setPatch(null);
    setPatchState("idle");
    try {
      setFiles(await gitCommand<DiffFile[]>(target, "getCommitFiles", { hash }));
    } catch {
      setFiles([]);
    }
  };

  // Hooks first, always: the empty state below returns early, and a memo after
  // it would change the hook count between "no commit" and "a commit".
  const groups = useMemo(() => groupFiles(files ?? []), [files]);
  const repositoryRoot = target.cwd;

  if (!commit) {
    return (
      <div className="git-commit-detail is-empty">
        <GitState kind="empty" text={t("git.detailEmpty")} />
      </div>
    );
  }

  if (filesKey !== commit.hash) void loadFiles(commit.hash);

  const loadPatch = async (file: DiffFile) => {
    const key = `${commit.hash}\u0000${file.newPath}`;
    setSelectedFile(file.newPath);
    if (patchKey === key) return;
    setPatchKey(key);
    setPatchState("loading");
    setPatch(null);
    setPatchError(null);
    try {
      const query = new URLSearchParams({ cwd: target.cwd, sha: commit.hash });
      const response = await fetch(`/api/git/commit-diff?${query}`, { cache: "no-store" });
      const data = (await response.json()) as CommitDiffResponse;
      if (!response.ok || !data.isGitRepository) {
        setPatchState("error");
        setPatchError(data.reason ?? `HTTP ${response.status}`);
        return;
      }
      if (data.reason === "too-large" || !data.patch) {
        setPatchState("too-large");
        return;
      }
      const section = patchForFile(data.patch, file.newPath) || data.patch;
      setPatch(section);
      setPatchState("idle");
    } catch (fetchError) {
      setPatchState("error");
      setPatchError((fetchError as Error).message);
    }
  };

  const act = async (label: string, command: string, params: Record<string, unknown> = {}) => {
    onBusy(label);
    const result = await run(command, params);
    onBusy(null);
    if (result === null) return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    onChanged();
  };

  const fileMenu = (file: DiffFile): GitMenuItem[] => [
    {
      id: "diff",
      label: t("git.fileDiff"),
      onSelect: () => void loadPatch(file),
    },
    {
      id: "open",
      label: t("git.openFile"),
      onSelect: () => {
        const root = target.cwd;
        onOpenFileDiff({
          from: `${commit.hash}^`,
          to: commit.hash,
          file: file.newPath,
          label: file.newPath,
        });
        void root;
      },
    },
    {
      id: "at-revision",
      label: t("git.fileAtRevision"),
      onSelect: () => onOpenFileAtRevision(commit.hash, file.newPath),
    },
    {
      id: "history",
      label: t("git.fileHistory"),
      onSelect: () => onOpenFileHistory(file.newPath),
    },
    {
      id: "blame",
      label: t("git.blameOpen"),
      onSelect: () => onOpenBlame(file.newPath),
    },
    { id: "sep", label: "", separator: true },
    {
      id: "revert-file",
      label: t("git.revertThisFile"),
      disabled: Boolean(busy),
      onSelect: () => void act(t("git.revertThisFile"), "revertFileChanges", { hash: commit.hash, filePaths: [file.newPath] }),
    },
    {
      id: "cherry-files",
      label: multiHashes.length > 1 ? t("git.cherryPickSelected") : t("git.cherryPickFile"),
      disabled: Boolean(busy) || multiHashes.length === 0,
      onSelect: () =>
        void act(
          t("git.cherryPickFile"),
          "cherryPickFileChanges",
          { hash: commit.hash, filePaths: [file.newPath] },
        ),
    },
    { id: "sep2", label: "", separator: true },
    {
      id: "copy-path",
      label: t("git.copyPath"),
      onSelect: () => void navigator.clipboard?.writeText(file.newPath).catch(() => {}),
    },
    {
      id: "copy-name",
      label: t("git.copyName"),
      onSelect: () => void navigator.clipboard?.writeText(file.newPath.split("/").pop() ?? file.newPath).catch(() => {}),
    },
  ];

  return (
    <div className="git-commit-detail">
      <div className="git-commit-detail-message">
        <div className="git-commit-detail-subject" title={commit.subject}>
          {commit.subject}
        </div>
        <div className="git-commit-detail-meta">
          <span className="git-commit-detail-hash" title={commit.hash}>{commit.shortHash}</span>
          <span>{commit.authorName}</span>
          <span title={formatFullTime(commit.authorDate)}>{formatFullTime(commit.authorDate)}</span>
          {commit.refs.length ? (
            <span className="git-commit-detail-refs">
              {refChips(commit.refs).map((chip) => (
                <span key={chip.key} className={`git-ref-chip ${chip.className}`}>
                  {chip.label}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        {commit.body ? <div className="git-commit-detail-body">{commit.body}</div> : null}
        <div className="git-commit-detail-actions">
          <button
            type="button"
            className="git-inline-button"
            disabled={Boolean(busy)}
            onClick={() => void act(t("git.cherryPick"), "cherryPick", { hash: commit.hash })}
          >
            {t("git.cherryPick")}
          </button>
          <button
            type="button"
            className="git-inline-button"
            disabled={Boolean(busy)}
            onClick={() => void act(t("git.revert"), "revertCommit", { hash: commit.hash })}
          >
            {t("git.revert")}
          </button>
          <GitIconButton
            label={t("git.copyHash")}
            onClick={() => void navigator.clipboard?.writeText(commit.hash).catch(() => {})}
          >
            <CopyIcon />
          </GitIconButton>
        </div>
      </div>

      <div className="git-commit-files" role="treegrid" aria-label={t("git.commitFiles")}>
        <div className="git-commit-files-header">
          <span>{t("git.commitFiles")}</span>
          <span className="git-commit-files-count">
            {t("git.fileCount", { count: files?.length ?? 0 })}
          </span>
        </div>
        {files === null ? <GitState kind="loading" text={t("git.commitFilesLoading")} /> : null}
        {files && files.length === 0 ? <GitState kind="empty" text={t("git.commitFilesEmpty")} /> : null}
        <div className="git-commit-files-list">
          {groups.map((group) => (
            <div key={group.prefix || "."} className="git-file-group">
              {group.prefix ? <div className="git-file-group-label">{group.prefix}/</div> : null}
              {group.files.map((file) => {
                const letter = statusLetter(file.status);
                return (
                  <div
                    key={file.newPath}
                    className={`git-file-row${selectedFile === file.newPath ? " is-selected" : ""}`}
                    role="row"
                    tabIndex={0}
                    onClick={() => void loadPatch(file)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadPatch(file);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      open(event.currentTarget, fileMenu(file));
                    }}
                  >
                    <span className={`git-file-letter ${letter.className}`}>{letter.letter}</span>
                    <button
                      type="button"
                      className="git-file-name"
                      title={file.isBinary ? `${file.newPath} — ${t("git.binaryFile")}` : joinFilePath(repositoryRoot, file.newPath)}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (file.isBinary) {
                          void loadPatch(file);
                          return;
                        }
                        onOpenFileDiff({
                          from: `${commit.hash}^`,
                          to: commit.hash,
                          file: file.newPath,
                          label: file.newPath,
                        });
                      }}
                    >
                      {file.newPath.split("/").pop()}
                    </button>
                    <span className="git-file-path">{file.newPath}</span>
                    {file.status === "renamed" && file.oldPath ? (
                      <span className="git-file-old" title={file.oldPath}>← {file.oldPath.split("/").pop()}</span>
                    ) : null}
                    <GitRowMenuButton
                      label={t("git.rowMenu")}
                      items={fileMenu(file)}
                      onOpen={(anchor) => open(anchor, fileMenu(file))}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="git-commit-diff">
        {patchState === "loading" ? <GitState kind="loading" text={t("gitPanel.loadingDiff")} /> : null}
        {patchState === "too-large" ? <GitState kind="empty" text={t("gitPanel.diffTooLarge")} /> : null}
        {patchState === "error" ? (
          <GitState kind="error" text={t("gitPanel.diffError", { message: patchError ?? "" })} onRetry={() => {
            const file = (files ?? []).find((entry) => entry.newPath === selectedFile);
            if (file) void loadPatch(file);
          }} />
        ) : null}
        {patch && patchState === "idle" ? (
          <div className="git-commit-diff-body">
            <DiffView patch={patch} />
          </div>
        ) : null}
        {/* A file is picked and its diff is being read; with none picked, the
            list above is the thing to look at, so the diff area says nothing. */}
        {!patch && patchState === "idle" && selectedFile ? (
          <GitState kind="empty" text={t("git.fileDiff")} />
        ) : null}
      </div>

      <GitErrorLine error={error} />
      <button type="button" className="git-hidden-clear" onClick={clearError} hidden aria-hidden="true">clear</button>
      {menu ? <GitMenu menu={menu} onDone={close} /> : null}
    </div>
  );
}

function groupFiles(files: DiffFile[]): Array<{ prefix: string; files: DiffFile[] }> {
  const groups = new Map<string, DiffFile[]>();
  for (const file of files) {
    const segments = file.newPath.split("/");
    const prefix = segments.length > 1 ? segments.slice(0, -1).join("/") : "";
    const bucket = groups.get(prefix);
    if (bucket) bucket.push(file);
    else groups.set(prefix, [file]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([prefix, list]) => ({ prefix, files: list }));
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <rect x="5.4" y="2.4" width="8.2" height="8.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10.6 12.4v1.2c0 .8-.6 1.4-1.4 1.4H3.8c-.8 0-1.4-.6-1.4-1.4V7c0-.8.6-1.4 1.4-1.4h1.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
