"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AppSelect } from "../../AppSelect";
import type { BlameHunk, BlameResult } from "@/lib/git/blame";
import { DiffView } from "../../FileViewer";
import { gitCommand, useGitMutation, useGitQuery, type GitTarget } from "../git-api";
import {
  GitCheckbox,
  GitDialog,
  GitErrorLine,
  GitState,
  GitTabs,
  GitTextInput,
  formatCommitTime,
  formatFullTime,
} from "../git-ui";

/**
 * The operation dialogs: the ones Branchshift opened as VS Code quick panels
 * (`push/App.tsx`, `conflicts/App.tsx`, `blame/App.tsx`, `compare/App.tsx`),
 * here as the app's modal surface. Every one of them reads and writes through
 * the command table — none of them builds a command line.
 */

export function PushDialog({
  target,
  branch,
  remoteBranches,
  ahead,
  onClose,
  onDone,
}: {
  target: GitTarget;
  branch: string;
  remoteBranches: string[];
  ahead: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { run, busy, error, clearError } = useGitMutation(target);
  const [remote, setRemote] = useState("origin");
  const [force, setForce] = useState(false);
  const [setUpstream, setSetUpstream] = useState(true);
  const targetBranch = branch;

  return (
    <GitDialog
      title={`${t("git.pushTitle")} — ${branch}`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="git-inline-button" onClick={onClose}>
            {t("git.cancel")}
          </button>
          <button
            type="button"
            className="git-inline-button is-primary"
            disabled={busy === "pushBranch"}
            onClick={async () => {
              const result = await run("pushBranch", {
                branch: targetBranch,
                remote,
                force,
                setUpstream,
              });
              if (result !== null) {
                onDone();
                onClose();
              }
            }}
          >
            {busy === "pushBranch" ? t("git.pushRunning") : t("git.push")}
          </button>
        </>
      }
    >
      <div className="git-push-summary">
        <span>{t("git.pushAhead", { count: ahead })}</span>
        <span className="git-push-target">{remote}/{targetBranch}</span>
      </div>
      <label className="git-field">
        <span className="git-field-label">{t("git.pushRemote")}</span>
        <AppSelect
          value={remote}
          onValueChange={setRemote}
          aria-label={t("git.pushRemote")}
          options={[...new Set(["origin", ...remoteBranches.map((name) => name.split("/")[0] ?? "")])]
            .filter(Boolean)
            .map((name) => ({ value: name, label: name }))}
        />
      </label>
      <label className="git-check-row">
        <GitCheckbox label={t("git.pushForce")} checked={force} onChange={setForce} />
        <span>
          {t("git.pushForce")}
          <span className="git-dialog-note"> {t("git.pushForceNote")}</span>
        </span>
      </label>
      <label className="git-check-row">
        <GitCheckbox label={t("git.pushSetUpstream")} checked={setUpstream} onChange={setSetUpstream} />
        <span>{t("git.pushSetUpstream")}</span>
      </label>
      <GitErrorLine error={error} />
      <button type="button" onClick={clearError} hidden aria-hidden="true">clear</button>
    </GitDialog>
  );
}

export function ConflictDialog({
  target,
  onClose,
  onDone,
}: {
  target: GitTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { run, busy, error, clearError } = useGitMutation(target);
  const conflicts = useGitQuery<string[]>(target, "getConflictFiles", {}, {});
  const [selected, setSelected] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ base: string; ours: string; theirs: string } | null>(null);
  const [view, setView] = useState<"ours" | "theirs" | "base">("ours");

  const openFile = async (filePath: string) => {
    setSelected(filePath);
    setVersions(null);
    const result = await run("getFileVersions", { filePath });
    setVersions(result as { base: string; ours: string; theirs: string } | null);
  };

  const accept = async (filePath: string, side: "ours" | "theirs") => {
    const result = await run(side === "ours" ? "acceptOurs" : "acceptTheirs", { filePath });
    if (result === null) return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    conflicts.reload();
    onDone();
  };

  const finish = async (action: "continue" | "abort") => {
    const result = await run("mergeAction", { action });
    if (result === null) return;
    await gitCommand(target, "refreshGitState").catch(() => null);
    onDone();
    onClose();
  };

  const list = conflicts.data ?? [];
  return (
    <GitDialog
      title={t("git.conflictTitle")}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button
            type="button"
            className="git-inline-button is-danger"
            disabled={busy === "mergeAction"}
            onClick={() => void finish("abort")}
          >
            {t("git.mergeAbort")}
          </button>
          <button
            type="button"
            className="git-inline-button is-primary"
            disabled={busy === "mergeAction" || list.length > 0}
            title={list.length ? t("git.conflictsLeft", { count: list.length }) : undefined}
            onClick={() => void finish("continue")}
          >
            {t("git.mergeContinue")}
          </button>
        </>
      }
    >
      <div className="git-conflict-body">
        <div className="git-conflict-list" role="list">
          {conflicts.loading ? <GitState kind="loading" text={t("git.conflictLoading")} /> : null}
          {!conflicts.loading && list.length === 0 ? <GitState kind="empty" text={t("git.conflictEmpty")} /> : null}
          {list.map((filePath) => (
            <button
              key={filePath}
              type="button"
              role="listitem"
              className={`git-conflict-row${selected === filePath ? " is-selected" : ""}`}
              onClick={() => void openFile(filePath)}
            >
              <span className="git-file-path" title={filePath}>{filePath}</span>
              <span className="git-conflict-actions">
                <span
                  role="button"
                  tabIndex={0}
                  className="git-inline-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void accept(filePath, "ours");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.stopPropagation();
                      void accept(filePath, "ours");
                    }
                  }}
                >
                  {t("git.acceptOurs")}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  className="git-inline-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void accept(filePath, "theirs");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.stopPropagation();
                      void accept(filePath, "theirs");
                    }
                  }}
                >
                  {t("git.acceptTheirs")}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="git-conflict-preview">
          {selected ? (
            <>
              <GitTabs
                value={view}
                onChange={setView}
                ariaLabel={t("git.conflictSides")}
                items={[
                  { id: "ours", label: t("git.sideOurs") },
                  { id: "theirs", label: t("git.sideTheirs") },
                  { id: "base", label: t("git.sideBase") },
                ]}
              />
              <pre className="git-conflict-content">
                {versions ? versions[view] : t("git.conflictLoading")}
              </pre>
            </>
          ) : (
            <GitState kind="empty" text={t("git.conflictPick")} />
          )}
        </div>
      </div>
      <GitErrorLine error={error} />
      <button type="button" onClick={clearError} hidden aria-hidden="true">clear</button>
    </GitDialog>
  );
}

export function BlameDialog({
  target,
  filePath,
  onClose,
}: {
  target: GitTarget;
  filePath: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const blame = useGitQuery<BlameResult>(target, "getGitBlame", { filePath }, {});
  const hunks = blame.data?.hunks ?? [];
  return (
    <GitDialog
      title={`${t("git.blameTitle")} — ${filePath.split("/").pop()}`}
      onClose={onClose}
      width={820}
    >
      {blame.loading ? <GitState kind="loading" text={t("git.blameLoading")} /> : null}
      {blame.error ? <GitState kind="error" text={blame.error.message} onRetry={blame.reload} /> : null}
      {!blame.loading && hunks.length === 0 ? <GitState kind="empty" text={t("git.blameEmpty")} /> : null}
      <div className="git-blame-list">
        {hunks.map((entry: BlameHunk) => (
          <div key={`${entry.commitHash}-${entry.lines[0]?.lineNumber ?? 0}`} className="git-blame-block">
            <div className="git-blame-head">
              <button
                type="button"
                className="git-blame-hash"
                title={entry.commitHash}
                onClick={() => void navigator.clipboard?.writeText(entry.commitHash).catch(() => {})}
              >
                {entry.commitHash.slice(0, 8)}
              </button>
              <span className="git-blame-summary" title={entry.summary}>{entry.summary}</span>
              <span className="git-blame-author">{entry.author}</span>
              <span className="git-blame-date" title={new Date(entry.authorTime * 1000).toISOString()}>
                {formatCommitTime(new Date(entry.authorTime * 1000).toISOString())}
              </span>
            </div>
            <div className="git-blame-lines">
              {(entry.lines ?? []).map((line) => (
                <div key={line.lineNumber} className="git-blame-line">
                  <span className="git-blame-number">{line.lineNumber}</span>
                  <span className="git-blame-content">{line.content}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </GitDialog>
  );
}

export function CompareDialog({
  target,
  from,
  to,
  onClose,
}: {
  target: GitTarget;
  from: { name: string; fullRef: string };
  to: { name: string; fullRef: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"files" | "patch">("files");
  const files = useGitQuery<Array<{ newPath: string; oldPath: string; status: string }>>(
    target,
    "getCommitRangeFiles",
    { hashes: [] },
    { enabled: false },
  );
  const patch = useGitQuery<string>(target, "getDiff", { ref1: from.fullRef, ref2: to.fullRef }, {});
  void files;
  return (
    <GitDialog
      title={t("git.compareTitle", { from: from.name, to: to.name })}
      onClose={onClose}
      width={760}
    >
      <GitTabs
        value={tab}
        onChange={setTab}
        ariaLabel={t("git.compareTitle", { from: from.name, to: to.name })}
        items={[
          { id: "files", label: t("git.compareSummary") },
          { id: "patch", label: t("git.comparePatch") },
        ]}
      />
      {tab === "files" ? (
        <div className="git-compare-summary">
          <p>
            {t("git.compareHint", { from: from.fullRef, to: to.fullRef })}
          </p>
          <p className="git-dialog-note">{t("git.compareAhead")}</p>
        </div>
      ) : null}
      {patch.loading ? <GitState kind="loading" text={t("gitPanel.loadingDiff")} /> : null}
      {patch.error ? <GitState kind="error" text={patch.error.message} onRetry={patch.reload} /> : null}
      {tab === "patch" && patch.data ? (
        <div className="git-compare-patch">
          <DiffView patch={patch.data} />
        </div>
      ) : null}
    </GitDialog>
  );
}
