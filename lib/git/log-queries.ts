import type { GitRefIdentity } from "./branch-dashboard-state";
import { refIdentityFromFullRef } from "./refs/ref-identity";
import type { GitService } from "./git-service";
import type { LogOptions, LogRevision } from "./types";

/**
 * The log/graph query pipeline, ported from Branchshift's `logHandlers.ts`.
 * Branchshift registered these on its VS Code message router; pi-desk calls them
 * from `lib/git/commands.ts`.
 */

export type LogQueryRevision =
  | { kind: "all" }
  | { kind: "ref"; ref: GitRefIdentity }
  | { kind: "range"; excludeRef: GitRefIdentity; includeRef: GitRefIdentity };

export interface LogQueryParams {
  maxCount?: number;
  count?: number;
  skip?: number;
  snapshot?: unknown;
  revision?: LogQueryRevision;
  currentRef?: GitRefIdentity;
  branch?: string;
  search?: string;
  author?: string;
  since?: string;
  until?: string;
  file?: string;
}

export type LogQueryResult =
  | ({ status: "ok"; hasMore: boolean } & { graphData: unknown; snapshot: unknown })
  | { status: "ref-unavailable"; ref: GitRefIdentity };

const PAGE_SIZE = 200;

/** One page of the graph, continuing from a `snapshot` for `loadMoreLog`. */
export async function queryGraphPage(
  gitService: GitService,
  params: LogQueryParams,
  mode: "first" | "more",
): Promise<unknown> {
  const structured = params.revision !== undefined || params.currentRef !== undefined;
  const revision = params.revision
    ? await resolveRevision(gitService, params.revision)
    : undefined;
  if (revision && "unavailable" in revision) return unavailable(revision.unavailable);

  if (params.currentRef) {
    assertRefIdentity(params.currentRef);
    if (!(await gitService.resolveCommitRef(params.currentRef.fullRef))) {
      return unavailable(params.currentRef);
    }
  }

  // The branch filter is the one log parameter with no availability probe: it is
  // appended to argv verbatim, so a branch deleted while the panel was filtered
  // on it made `git log refs/heads/<gone>` fail with `fatal: ambiguous
  // argument …`, and the panel cleared the commits, branches and tags it had
  // already fetched. Probe it like the structured refs instead.
  //
  // The panel's branch row names the branch the way git takes it on the command
  // line — `feat/x` for a local branch, `origin/feat/x` for a remote one — and
  // `check-ref-format --branch` accepts both. Deriving the identity from a
  // `refs/…` prefix alone made every filter from the sidebar throw
  // `Invalid Git branch ref: feat/x`, and the panel showed "No commit matches
  // this filter" for a branch with hundreds of commits.
  if (!params.revision && params.branch) {
    const filterRef = refIdentityFromFullRef(params.branch) ?? (await probePlainBranch(gitService, params.branch));
    if (!filterRef) throw new Error(`Invalid Git branch ref: ${params.branch}`);
    if (!(await gitService.resolveCommitRef(filterRef.fullRef))) return unavailable(filterRef);
  }

  const maxCount = mode === "more" ? (params.count ?? params.maxCount ?? PAGE_SIZE) : (params.maxCount ?? PAGE_SIZE);
  const options: LogOptions = {
    maxCount,
    skip: mode === "more" ? (params.skip ?? 0) : params.skip,
    revision: revision && "value" in revision ? revision.value : undefined,
    ...(params.revision ? {} : { branch: params.branch }),
    search: params.search,
    author: params.author,
    since: params.since,
    until: params.until,
    file: params.file,
  };
  const result = await gitService.getGraphTopology(
    options,
    params.snapshot as never,
    params.currentRef?.fullRef,
  );
  if (!structured) return result;
  return {
    status: "ok",
    ...result,
    hasMore: result.graphData.commits.length >= maxCount,
  } satisfies LogQueryResult;
}

async function resolveRevision(
  service: GitService,
  revision: LogQueryRevision,
): Promise<{ value: LogRevision } | { unavailable: GitRefIdentity }> {
  switch (revision.kind) {
    case "all":
      return { value: revision };
    case "ref":
      assertRefIdentity(revision.ref);
      if (!(await service.resolveCommitRef(revision.ref.fullRef))) {
        return { unavailable: revision.ref };
      }
      return { value: { kind: "ref", ref: revision.ref.fullRef } };
    case "range":
      for (const ref of [revision.excludeRef, revision.includeRef]) {
        assertRefIdentity(ref);
        if (!(await service.resolveCommitRef(ref.fullRef))) return { unavailable: ref };
      }
      return {
        value: {
          kind: "range",
          excludeRef: revision.excludeRef.fullRef,
          includeRef: revision.includeRef.fullRef,
        },
      };
  }
}

function assertRefIdentity(ref: GitRefIdentity): void {
  if (
    !ref ||
    !["local", "remote", "tag", "detached"].includes(ref.type) ||
    typeof ref.name !== "string" ||
    !ref.name ||
    typeof ref.fullRef !== "string" ||
    !ref.fullRef
  ) {
    throw new Error("Invalid structured Git ref");
  }
}

function unavailable(ref: GitRefIdentity): LogQueryResult {
  return { status: "ref-unavailable", ref };
}

/**
 * The identity of the log's plain branch filter, when it resolves.
 *
 * The panel's branch row names the branch the way git takes it on the command
 * line: `feat/x` for a local branch, `origin/feat/x` for a remote one — and a
 * local branch may itself carry a slash (`bak/4pi-desk-main`), so a slash does
 * not mean "remote". The namespaces are tried in git's own order of preference
 * for a name (`refs/heads/`, then `refs/remotes/`) and the one that resolves is
 * the identity reported: the availability probe and the `ref-unavailable` answer
 * are shaped for the panel's sidebar, while the query itself runs on the plain
 * name (`check-ref-format --branch` in the service).
 *
 * A name that is not a ref name at all answers `null`, so the caller refuses it
 * instead of passing it to git.
 */
async function probePlainBranch(service: GitService, name: string): Promise<GitRefIdentity | null> {
  if (!isPlainRefName(name)) return null;
  for (const [type, prefix] of [["local", "refs/heads/"], ["remote", "refs/remotes/"]] as const) {
    const fullRef = `${prefix}${name}`;
    if (await service.resolveCommitRef(fullRef)) return { type, name, fullRef };
  }
  // Nothing resolved: report it as the branch the panel asked for.
  return { type: "local", name, fullRef: `refs/heads/${name}` };
}

function isPlainRefName(name: string): boolean {
  return (
    !!name &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.startsWith("refs/") &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.includes("@{") &&
    !name.includes(" ") &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name)
  );
}
