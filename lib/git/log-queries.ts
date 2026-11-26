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
  if (!params.revision && params.branch) {
    const filterRef = refIdentityFromFullRef(params.branch);
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
