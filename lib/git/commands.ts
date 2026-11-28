import { existsSync } from "node:fs";
import path from "node:path";
import { resolveExistingPath } from "../paths";
import { getGitDashboardStore } from "./dashboard-store";
import { GitCommandError, GIT_NETWORK_TIMEOUT_MS, type GitRunOptions } from "./core/git-executor";
import { BranchShiftError, BranchShiftErrorCode } from "./errors";
import { emitGitStateChanged } from "./events";
import type { GitService } from "./git-service";
import { queryGraphPage, type LogQueryParams } from "./log-queries";
import type { RepoRuntime } from "./repo-registry";
import { discoverWorkspaceRepos, invalidateGitWorkspace, repoLabel, resolveRepoRuntime } from "./workspace";
import type { CommitRequest, CommitSelection } from "./types";

/**
 * The Git command surface the panel calls, replacing Branchshift's VS Code
 * message router.
 *
 * Branchshift's webview posted `{ type: "request", command, params, repoId }` to
 * the extension host, which resolved `repoId` to a `GitService` and dispatched to
 * a handler. Here the same command names and parameters are dispatched in the
 * Next.js server process, and every request is bound to a repository discovered
 * from an authorized project cwd (see lib/git/workspace.ts).
 *
 * Two invariants:
 * - Only the commands in `COMMANDS` can run. No command takes a shell string,
 *   an argv array, or a repository path from the client.
 * - Refs, hashes and file paths are validated before they reach git, so a
 *   request cannot smuggle an option (`--uploadpack`, `--exec`) or a path that
 *   leaves the checkout.
 */

const REPO_AGNOSTIC_COMMANDS = new Set<string>(["getRepos"]);

/** Commands that change repository state; each publishes a refresh scope. */
const MUTATION_SCOPES: Record<string, "all" | "branches" | "status" | "mergeState" | "log"> = {
  checkoutBranch: "all",
  createBranch: "branches",
  createBranchFromCommit: "branches",
  deleteBranch: "branches",
  renameBranch: "branches",
  mergeBranch: "all",
  mergeAction: "all",
  rebaseBranch: "all",
  rebaseAction: "all",
  checkoutAndRebase: "all",
  pushBranch: "branches",
  executePush: "branches",
  updateBranch: "branches",
  pullBranch: "all",
  pullRebase: "all",
  pullMerge: "all",
  fetchBranch: "branches",
  fetchAll: "branches",
  commitChanges: "all",
  commitAndPush: "all",
  amendCommit: "all",
  stageFile: "status",
  unstageFile: "status",
  stageAll: "status",
  unstageAll: "status",
  rollbackFile: "status",
  rollbackFiles: "status",
  deleteFiles: "status",
  shelveChanges: "all",
  unshelveChanges: "all",
  unshelveFile: "all",
  deleteShelve: "all",
  ideaShelveChanges: "all",
  ideaUnshelveChanges: "all",
  deleteIdeaShelf: "all",
  importPatches: "all",
  checkoutCommit: "all",
  cherryPick: "all",
  cherryPickAction: "all",
  cherryPickFileChanges: "status",
  createTag: "branches",
  resetToCommit: "all",
  revertCommit: "all",
  revertFileChanges: "status",
  dropCommit: "all",
  acceptOurs: "mergeState",
  acceptTheirs: "mergeState",
  saveMergedContent: "mergeState",
  setFavorite: "branches",
};

type CommandHandler = (params: Record<string, unknown>, context: CommandContext) => Promise<unknown>;

interface CommandContext {
  cwd: string;
  runtime: RepoRuntime;
  git: GitService;
  rootPath: string;
}

/** A failure the route renders as `{ code, message, recovery }`, like the bridge did. */
export class GitCommandFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "GitCommandFailure";
  }
}

// ─── Parameter validation ────────────────────────────────────────────

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new GitCommandFailure(BranchShiftErrorCode.UNKNOWN, `${key} is required.`);
  }
  return value;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalBoolean(params: Record<string, unknown>, key: string): boolean {
  return params[key] === true;
}

function stringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/**
 * A branch, tag or ref name handed to git as one argv entry.
 *
 * Git's rev-parse grammar accepts a name that also reads as an option
 * (`--help`, `-b`), a placeholder (`@{u}`), or a range; the range forms and the
 * option-prefixed names are the ones that turn a single ref argument into a
 * second instruction. Only the safe character set is allowed through.
 */
function refName(params: Record<string, unknown>, key: string): string {
  const value = typeof params[key] === "string" ? params[key] : "";
  if (!value.trim()) {
    throw new GitCommandFailure(BranchShiftErrorCode.INVALID_REF, `${key} is required.`);
  }
  assertRefName(value, key);
  return value;
}

function assertRefName(value: string, key: string): void {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._\/+-]*$/.test(value) ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("//") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.endsWith(".lock") ||
    value.includes(" ")
  ) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.INVALID_REF,
      `"${value}" is not a usable Git ref name.`,
      `Give ${key} a plain branch or tag name.`,
    );
  }
}

/**
 * A revision: a ref or hash, optionally followed by git's ancestry suffixes
 * (`HEAD^`, `<hash>~3`, `<hash>^0`). The panel builds these to diff a commit
 * against its parent, so the suffixes are part of the grammar — and only them:
 * ranges, `@{…}` placeholders and anything option-shaped stay out of argv.
 */
function revisionArg(params: Record<string, unknown>, key: string): string {
  const value = typeof params[key] === "string" ? params[key].trim() : "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]*(?:\^\d*|~\d+)*$/.test(value) || value.includes("..")) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.INVALID_REF,
      `"${value}" is not a usable Git revision.`,
      `Give ${key} a commit hash or a ref name.`,
    );
  }
  return value;
}

/**
 * An Idea Shelf name. Shelves are a directory under `.idea/shelf/`, so a name
 * with a separator would reach outside the shelf folder — and unshelving runs
 * `git apply` on the patch found there.
 */
function shelfName(params: Record<string, unknown>, key = "shelfName"): string {
  const value = typeof params[key] === "string" ? params[key].trim() : "";
  if (
    !value ||
    value.length > 200 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.INVALID_REF,
      `"${value}" is not a usable shelf name.`,
      `Give ${key} a plain name without a path.`,
    );
  }
  return value;
}

function commitHash(params: Record<string, unknown>, key = "hash"): string {
  const value = typeof params[key] === "string" ? params[key].trim() : "";
  if (!/^[0-9a-fA-F]{4,64}$/.test(value)) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.INVALID_REF,
      `${key} must be a commit hash.`,
      "Pick a commit in the graph and retry.",
    );
  }
  return value;
}

/**
 * A stash reference. The panel carries the id git's own `git stash list` format
 * reports (`stash@{3}`); a bare index is accepted too, and anything else —
 * including the `stash@{0}; git init` shape — is refused, because the id is
 * passed to git inside `stash@{…}` expressions.
 */
function stashRef(params: Record<string, unknown>, key = "stashId"): string {
  const value = typeof params[key] === "string" ? params[key].trim() : "";
  const match = value.match(/^(?:stash@\{(\d+)\}|(\d+))$/);
  const index = match?.[1] ?? match?.[2];
  if (index === undefined) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.INVALID_REF,
      `${key} must be a stash reference (stash@{0}).`,
    );
  }
  return `stash@{${index}}`;
}

/**
 * A file path inside the checkout, relative to its root. Git refuses paths
 * outside a repository, but the panel also writes files through plain
 * filesystem calls (`saveMergedContent`, `deleteFiles`), so the boundary is
 * enforced here for every path parameter.
 */
function repoPath(context: CommandContext, value: string, key: string): string {
  const unified = value.replace(/\\/g, "/");
  const segments = unified.split("/").filter(Boolean);
  if (
    !unified ||
    unified.startsWith("/") ||
    /^[a-zA-Z]:/.test(unified) ||
    segments.length === 0 ||
    segments.some((segment) => segment === ".." || segment === ".") ||
    segments[0] === ".git"
  ) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.FILE_NOT_FOUND,
      `"${value}" is outside the repository.`,
      `Pick ${key} from the repository's own file list.`,
    );
  }
  const joined = path.resolve(context.rootPath, ...segments);
  const anchored = resolveExistingPath(path.dirname(joined));
  const realName = path.basename(joined);
  const realFull = path.resolve(anchored, realName);
  const rootReal = resolveExistingPath(context.rootPath);
  const relative = path.relative(rootReal, realFull);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.FILE_NOT_FOUND,
      `"${value}" resolves outside the repository.`,
      `Pick ${key} from the repository's own file list.`,
    );
  }
  return segments.join("/");
}

function repoPaths(context: CommandContext, key: string, params: Record<string, unknown>): string[] {
  return stringArray(params, key).map((value) => repoPath(context, value, key));
}

const COMMIT_STATUSES = new Set<CommitSelection["status"]>([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflicted",
]);

/**
 * The panel sends the working-tree rows it selected (path, staged flag, status).
 * The paths go through the repository boundary like every other path parameter;
 * the status is re-read from the client's row, which is the only place the
 * index/worktree split is known.
 */
function commitSelections(
  context: CommandContext,
  params: Record<string, unknown>,
): CommitSelection[] {
  const raw = Array.isArray(params.selections) ? params.selections : [];
  return raw.map((entry) => {
    const selection = (entry ?? {}) as Record<string, unknown>;
    const status = String(selection.status ?? "") as CommitSelection["status"];
    if (!COMMIT_STATUSES.has(status)) {
      throw new GitCommandFailure(
        BranchShiftErrorCode.COMMIT_REJECTED,
        "A selected change has an unknown status.",
        "Refresh the change list and select the files again.",
      );
    }
    return {
      path: repoPath(context, String(selection.path ?? ""), "selections[].path"),
      ...(typeof selection.oldPath === "string" && selection.oldPath
        ? { oldPath: repoPath(context, selection.oldPath, "selections[].oldPath") }
        : {}),
      staged: selection.staged === true,
      status,
    };
  });
}

function network(): GitRunOptions {
  return { timeoutMs: GIT_NETWORK_TIMEOUT_MS };
}

// ─── Commands ────────────────────────────────────────────────────────

const COMMANDS: Record<string, CommandHandler> = {
  // Repository switching -------------------------------------------------
  async getRepos(params, context) {
    const workspace = await discoverWorkspaceRepos(context.cwd);
    return {
      repos: workspace.repos.map((repo) => ({
        ...repo,
        label: repoLabel(repo, workspace.repos),
      })),
      activeId: workspace.currentId,
    };
  },

  // Log and graph --------------------------------------------------------
  async getGraphData(params, context) {
    return queryGraphPage(context.git, params as LogQueryParams, "first");
  },
  async loadMoreLog(params, context) {
    return queryGraphPage(context.git, params as LogQueryParams, "more");
  },
  async getLog(params, context) {
    return context.git.getLog(params as { maxCount?: number });
  },
  async getCommitFiles(params, context) {
    return context.git.getCommitFiles(commitHash(params));
  },
  async getCommitRangeFiles(params, context) {
    const hashes = stringArray(params, "hashes").map((hash) => {
      if (!/^[0-9a-fA-F]{4,64}$/.test(hash)) throw new GitCommandFailure(BranchShiftErrorCode.INVALID_REF, "hashes must be commit hashes.");
      return hash;
    });
    return context.git.getCommitRangeFiles(hashes);
  },
  async getAheadCommits(params, context) {
    return context.git.getAheadCommits(
      refName(params, "branch"),
      optionalString(params, "remote"),
    );
  },
  async getDiff(params, context) {
    const ref1 = revisionArg(params, "ref1");
    const ref2 = revisionArg(params, "ref2");
    const file = optionalString(params, "file");
    return context.git.getDiff(ref1, ref2, file ? repoPath(context, file, "file") : undefined);
  },
  async getFileContent(params, context) {
    const ref = revisionArg(params, "ref");
    return context.git.getFileContent(ref, repoPath(context, requiredString(params, "filePath"), "filePath"));
  },
  async openFileAtRevision(params, context) {
    // The panel asks for the bytes at a revision; the client opens them as a tab.
    const ref = revisionArg(params, "ref");
    const filePath = repoPath(context, requiredString(params, "filePath"), "filePath");
    const content = await context.git.getFileContent(ref, filePath);
    return { filePath, ref, content };
  },
  async getFileHistory(params, context) {
    const filePath = repoPath(context, requiredString(params, "filePath"), "filePath");
    const maxCount = typeof params.maxCount === "number" ? Math.min(params.maxCount, 500) : 200;
    return context.git.getLog({ maxCount, file: filePath });
  },
  async getGitBlame(params, context) {
    return context.git.getGitBlame(repoPath(context, requiredString(params, "filePath"), "filePath"));
  },

  // Refs -----------------------------------------------------------------
  async getBranches(_params, context) {
    return context.git.getBranches();
  },
  async getRemoteBranches(_params, context) {
    return context.git.getRemoteBranches();
  },
  async getTags(_params, context) {
    return context.git.getTags();
  },
  async checkoutBranch(params, context) {
    await context.git.checkout(refName(params, "branch"));
    return null;
  },
  async createBranch(params, context) {
    const name = refName(params, "name");
    const startPoint = requiredString(params, "startPoint");
    assertRefName(startPoint, "startPoint");
    await context.git.createBranch(name, startPoint, optionalBoolean(params, "force"));
    if (optionalBoolean(params, "checkout")) await context.git.checkout(name);
    return null;
  },
  async createBranchFromCommit(params, context) {
    const name = refName(params, "name");
    const hash = commitHash(params);
    await context.git.createBranchFromCommit(name, hash, optionalBoolean(params, "force"));
    if (optionalBoolean(params, "checkout")) await context.git.checkout(name);
    return null;
  },
  async deleteBranch(params, context) {
    const name = refName(params, "branch");
    await context.git.deleteBranch(name, optionalBoolean(params, "force"));
    const remote = optionalString(params, "remote");
    if (remote) await context.git.deleteRemoteBranch(`${remote}/${name}`);
    return null;
  },
  async renameBranch(params, context) {
    await context.git.renameBranch(refName(params, "oldName"), refName(params, "newName"));
    return null;
  },
  async createTag(params, context) {
    await context.git.createTag(
      refName(params, "tagName"),
      commitHash(params),
      optionalString(params, "message"),
    );
    return null;
  },
  async setFavorite(params, context) {
    const store = await getGitDashboardStore();
    const type = params.type === "remote" || params.type === "tag" ? params.type : "local";
    const name = requiredString(params, "name");
    await store.setFavorite(context.runtime.descriptor.id, type, name, params.favorite === true);
    return store.getPreferences();
  },
  async getBranchDashboardPreferences(_params, context) {
    const store = await getGitDashboardStore();
    return {
      preferences: store.getPreferences(),
      favorites: store.favoritesFor(context.runtime.descriptor.id),
    };
  },
  async setBranchDashboardPreferences(params, context) {
    const store = await getGitDashboardStore();
    return store.updatePreferences({
      showTags: params.showTags !== false,
      singleClickAction: params.singleClickAction === "navigate" ? "navigate" : "filter",
    });
  },

  // Network ------------------------------------------------------------
  async pushBranch(params, context) {
    const branch = refName(params, "branch");
    const remote = optionalString(params, "remote");
    const target = optionalString(params, "targetBranch");
    if (remote) assertRefName(remote, "remote");
    if (target) assertRefName(target, "targetBranch");
    return context.git.push(branch, optionalBoolean(params, "force"), remote ?? "origin", target);
  },
  async executePush(params, context) {
    return COMMANDS.pushBranch?.(params, context);
  },
  async updateBranch(params, context) {
    await context.git.updateBranch(refName(params, "branch"));
    return null;
  },
  async pullBranch(params, context) {
    const branch = optionalString(params, "branch");
    if (branch) assertRefName(branch, "branch");
    await context.git.pull(branch);
    return null;
  },
  async pullRebase(params, context) {
    const branch = optionalString(params, "branch");
    if (branch) assertRefName(branch, "branch");
    await context.git.pullRebase(branch);
    return null;
  },
  async pullMerge(params, context) {
    return COMMANDS.pullBranch?.(params, context);
  },
  async fetchBranch(params, context) {
    // `git fetch` takes a remote, not a branch: Branchshift's "fetch this
    // branch" fetches the remote that owns it and leaves the rest alone.
    const remote = optionalString(params, "remote") ?? optionalString(params, "branch") ?? "origin";
    assertRefName(remote, "remote");
    await context.git.fetch(remote);
    return null;
  },
  async fetchAll(params, context) {
    return COMMANDS.fetchBranch?.({ remote: params.remote ?? "origin" }, context);
  },

  // Merge / rebase / cherry-pick ----------------------------------------
  async mergeBranch(params, context) {
    await context.git.merge(refName(params, "branch"));
    return null;
  },
  async mergeAction(params, context) {
    if (params.action === "abort") await context.git.mergeAbort();
    else await context.git.mergeContinue();
    return null;
  },
  async rebaseBranch(params, context) {
    await context.git.rebase(requiredString(params, "onto"));
    return null;
  },
  async checkoutAndRebase(params, context) {
    await context.git.checkoutAndRebase(refName(params, "branch"), requiredString(params, "onto"));
    return null;
  },
  async rebaseAction(params, context) {
    const action = params.action === "abort" || params.action === "skip" ? params.action : "continue";
    await context.git.rebaseAction(action);
    return null;
  },
  async getMergeState(_params, context) {
    return context.git.getMergeState();
  },
  async getRebaseState(_params, context) {
    return context.git.getRebaseState();
  },
  async getCherryPickState(_params, context) {
    return context.git.getCherryPickState();
  },
  async getConflictFiles(_params, context) {
    return context.git.getConflictFiles();
  },
  async getFileVersions(params, context) {
    return context.git.getFileVersions(repoPath(context, requiredString(params, "filePath"), "filePath"));
  },
  async saveMergedContent(params, context) {
    const filePath = repoPath(context, requiredString(params, "filePath"), "filePath");
    const content = typeof params.content === "string" ? params.content : "";
    await context.git.saveMergedContent(filePath, content);
    return null;
  },
  async acceptOurs(params, context) {
    await context.git.acceptOurs(repoPath(context, requiredString(params, "filePath"), "filePath"));
    return null;
  },
  async acceptTheirs(params, context) {
    await context.git.acceptTheirs(repoPath(context, requiredString(params, "filePath"), "filePath"));
    return null;
  },
  async cherryPick(params, context) {
    await context.git.cherryPick(commitHash(params));
    return null;
  },
  async cherryPickAction(params, context) {
    const action = params.action === "abort" || params.action === "skip" ? params.action : "continue";
    await context.git.cherryPickAction(action);
    return null;
  },
  async cherryPickFileChanges(params, context) {
    const hash = commitHash(params);
    for (const filePath of repoPaths(context, "filePaths", params)) {
      await context.git.checkoutFileFromCommit(hash, filePath);
    }
    return null;
  },
  async checkoutCommit(params, context) {
    await context.git.checkoutCommit(commitHash(params));
    return null;
  },
  async resetToCommit(params, context) {
    const mode = params.mode === "soft" || params.mode === "hard" ? params.mode : "mixed";
    await context.git.resetToCommit(commitHash(params), mode);
    return null;
  },
  async revertCommit(params, context) {
    await context.git.revertCommit(commitHash(params));
    return null;
  },
  async dropCommit(params, context) {
    await context.git.dropCommit(commitHash(params));
    return null;
  },
  async revertFileChanges(params, context) {
    const hash = commitHash(params);
    const files = await context.git.getCommitFiles(hash);
    for (const filePath of repoPaths(context, "filePaths", params)) {
      const file = files.find((candidate) => candidate.newPath === filePath);
      await context.git.checkoutFileFromParent(hash, filePath, file?.status);
    }
    return null;
  },

  // Working tree and commit --------------------------------------------
  async getStatus(_params, context) {
    return context.git.getStatus();
  },
  async getWorkingTreeChanges(_params, context) {
    return context.git.getWorkingTreeChanges();
  },
  async stageFile(params, context) {
    await context.git.stageFile(repoPath(context, requiredString(params, "filePath"), "filePath"));
    return null;
  },
  async unstageFile(params, context) {
    await context.git.unstageFile(repoPath(context, requiredString(params, "filePath"), "filePath"));
    return null;
  },
  async stageAll(_params, context) {
    await context.git.stageAll();
    return null;
  },
  async unstageAll(_params, context) {
    await context.git.unstageAll();
    return null;
  },
  async commitChanges(params, context) {
    const request: CommitRequest = {
      message: requiredString(params, "message"),
      amend: optionalBoolean(params, "amend"),
      selections: commitSelections(context, params),
    };
    const result = await context.git.commitSelected(request);
    if (!result.ok) {
      throw new GitCommandFailure(result.code, result.message, result.recovery);
    }
    return null;
  },
  async commitAndPush(params, context) {
    await context.git.commitAndPush(requiredString(params, "message"), optionalBoolean(params, "amend"));
    return null;
  },
  async amendCommit(params, context) {
    await context.git.commit(requiredString(params, "message"), true);
    return null;
  },
  async getAmendMessage(_params, context) {
    return context.git.getLastCommitMessage();
  },
  async getRecentCommitMessages(params, context) {
    return context.git.getRecentCommitMessages(
      typeof params.count === "number" ? Math.min(params.count, 100) : 20,
    );
  },
  async rollbackFile(params, context) {
    await context.git.rollbackFile(repoPath(context, requiredString(params, "filePath"), "filePath"));
    return null;
  },
  async rollbackFiles(params, context) {
    for (const filePath of repoPaths(context, "filePaths", params)) {
      await context.git.rollbackFile(filePath);
    }
    return null;
  },
  async deleteFiles(params, context) {
    // Branchshift deleted through the VS Code file service; here the same
    // boundary is the checkout: every path is repo-relative, and a path inside
    // the repository's own object store is refused.
    const { rm } = await import("node:fs/promises");
    for (const filePath of repoPaths(context, "filePaths", params)) {
      if (!existsSync(path.join(context.rootPath, filePath))) {
        throw new GitCommandFailure(BranchShiftErrorCode.FILE_NOT_FOUND, `${filePath} does not exist.`);
      }
      await rm(path.join(context.rootPath, filePath), { recursive: true, force: true });
    }
    return null;
  },

  // Shelf (native stash) and Idea Shelf (.idea/shelf) -------------------
  async getShelves(_params, context) {
    return context.git.getShelves();
  },
  async shelveChanges(params, context) {
    const message = requiredString(params, "message");
    const filePaths = stringArray(params, "filePaths").map((value) => repoPath(context, value, "filePaths"));
    await context.git.shelveChanges(message, filePaths.length ? filePaths : undefined);
    return null;
  },
  async unshelveChanges(params, context) {
    await context.git.unshelveChanges(stashRef(params), params.drop !== false);
    return null;
  },
  async unshelveFile(params, context) {
    // Unshelve the whole entry, then drop every other file's change so the
    // result is the one file the panel asked for.
    const stashId = stashRef(params);
    const filePath = repoPath(context, requiredString(params, "filePath"), "filePath");
    const shelves = await context.git.getShelves();
    const shelf = shelves.find((entry) => entry.id === stashId);
    await context.git.unshelveChanges(stashId, params.drop !== false);
    for (const other of shelf?.files ?? []) {
      if (other === filePath) continue;
      await context.git.rollbackFile(other);
    }
    return null;
  },
  async deleteShelve(params, context) {
    await context.git.deleteShelve(stashRef(params));
    return null;
  },
  async showShelfFileDiff(params, context) {
    const stashId = stashRef(params);
    const filePath = repoPath(context, requiredString(params, "filePath"), "filePath");
    return context.git.getDiff(stashId, "HEAD", filePath);
  },
  async showDiffForWorkingFile(params, context) {
    const filePath = repoPath(context, requiredString(params, "filePath"), "filePath");
    const staged = params.staged === true;
    return context.git.getDiff(staged ? "HEAD" : "", "INDEX", filePath);
  },
  async getIdeaShelves(_params, context) {
    return context.git.getIdeaShelves();
  },
  async ideaShelveChanges(params, context) {
    await context.git.ideaShelveChanges(
      shelfName(params, "name"),
      stringArray(params, "filePaths").map((value) => repoPath(context, value, "filePaths")),
    );
    return null;
  },
  async ideaUnshelveChanges(params, context) {
    await context.git.ideaUnshelveChanges(shelfName(params), params.drop === true);
    return null;
  },
  async deleteIdeaShelf(params, context) {
    await context.git.deleteIdeaShelf(shelfName(params));
    return null;
  },
  async showIdeaShelfFileDiff(params, context) {
    // The Idea Shelf is a patch file on disk (Branchshift's shelfArtifact
    // layout); the panel shows the section for one file, so the patch is read
    // and split here.
    const name = shelfName(params);
    const entries = await context.git.getIdeaShelves();
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      throw new GitCommandFailure(BranchShiftErrorCode.FILE_NOT_FOUND, `Shelf "${name}" does not exist.`);
    }
    const { readFile } = await import("node:fs/promises");
    const patch = await readFile(entry.patchPath, "utf8");
    const filePath = params.filePath === undefined ? undefined : repoPath(context, String(params.filePath), "filePath");
    if (!filePath) return patch;
    const sections = patch.split(/(?=^diff --git )/m).filter((section) =>
      section.includes(`/b/${filePath}`) || section.includes(`b/${filePath}`));
    return sections.join("\n");
  },
  async importPatches(params, context) {
    const name = shelfName(params, "name");
    const patchContent = requiredString(params, "patchContent");
    await context.git.importPatchAsShelf(name, patchContent);
    return null;
  },
  async createPatchFromShelf(params, context) {
    const stashId = stashRef(params);
    return context.git.getDiff(`${stashId}^`, stashId);
  },
  async refreshGitState(_params, context) {
    context.git.invalidateCache();
    invalidateGitWorkspace(context.cwd);
    emitGitStateChanged(context.runtime.descriptor.id, "all");
    return null;
  },
};

export type GitCommandName = keyof typeof COMMANDS;

export function isGitCommand(command: string): command is GitCommandName {
  return Object.prototype.hasOwnProperty.call(COMMANDS, command);
}

export function listGitCommands(): string[] {
  return Object.keys(COMMANDS).sort();
}

// ─── Dispatch ────────────────────────────────────────────────────────

export interface GitCommandRequest {
  cwd: string;
  repoId?: string | null;
  command: string;
  params?: Record<string, unknown>;
}

/**
 * Run one Git command. Throws `GitCommandFailure` for anything the panel should
 * show: an unknown command, a repository that is not part of the workspace, a
 * rejected ref/path, or a git error.
 */
export async function runGitCommand(request: GitCommandRequest): Promise<unknown> {
  const command = request.command;
  const handler = COMMANDS[command];
  if (!handler) {
    throw new GitCommandFailure(BranchShiftErrorCode.UNKNOWN, `Unknown Git command "${command}".`);
  }

  const runtime = await resolveRepoRuntime(request.cwd, request.repoId);
  if (!runtime && !REPO_AGNOSTIC_COMMANDS.has(command)) {
    throw new GitCommandFailure(
      BranchShiftErrorCode.REPO_NOT_FOUND,
      "The selected folder is not a Git repository, or it is not an allowed project folder.",
      "Open a project whose folder is a Git checkout.",
    );
  }

  const context: CommandContext = {
    cwd: request.cwd,
    runtime: runtime as RepoRuntime,
    git: (runtime as RepoRuntime).gitService,
    rootPath: (runtime as RepoRuntime).descriptor.rootPath,
  };

  try {
    const result = await handler(request.params ?? {}, context);
    const scope = MUTATION_SCOPES[command];
    if (scope) {
      invalidateGitWorkspace(request.cwd);
      emitGitStateChanged(context.runtime.descriptor.id, scope);
    }
    return result;
  } catch (error) {
    throw normalizeCommandError(error);
  }
}

function normalizeCommandError(error: unknown): GitCommandFailure {
  if (error instanceof GitCommandFailure) return error;
  if (error instanceof BranchShiftError) {
    return new GitCommandFailure(error.code, error.message, error.recovery);
  }
  if (error instanceof GitCommandError) {
    return new GitCommandFailure(
      BranchShiftErrorCode.GIT_COMMAND_FAILED,
      error.stderr.trim() || error.message,
      "Check the repository state and retry.",
    );
  }
  return new GitCommandFailure(
    BranchShiftErrorCode.UNKNOWN,
    error instanceof Error ? error.message : String(error),
  );
}
