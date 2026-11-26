import { type FSWatcher, watch as fsWatch } from "node:fs";
import path from "node:path";
import { registerFileWatch } from "../file-watch-registry";
import { buildGitWatchSpecs, type GitChangeScope, type GitEvent, subscribeGitEvents } from "./events";
import type { RepositoryPaths } from "./repo-registry";

/**
 * The panel's live refresh: one SSE stream per open panel, watching the
 * repository's own state files.
 *
 * Branchshift used VS Code's FileSystemWatcher; here the watchers are
 * `fs.watch`, and single files are watched through their parent directory
 * because git replaces them (refs, index and MERGE_HEAD are written to a temp
 * file and renamed over the target), which leaves a watcher bound to the old
 * inode dead.
 *
 * Changes are debounced per scope. An operation the panel itself issued arrives
 * through the in-process bus (lib/git/events.ts), so a commit made in this app
 * refreshes immediately while a commit made in a terminal refreshes when git
 * touches the repository.
 */

const DEBOUNCE_MS = 250;
const KEEP_ALIVE_MS = 25_000;
const MAX_WATCHERS_PER_STREAM = 24;
const REARM_DELAY_MS = 2_000;

export interface GitWatchStreamOptions {
  repoId: string;
  paths: RepositoryPaths;
}

interface WatchTarget {
  directory: string;
  recursive: boolean;
  /** File names inside `directory` that matter; null = anything below it. */
  names: Set<string> | null;
  scope: GitChangeScope;
}

export function gitWatchTargets(paths: RepositoryPaths): WatchTarget[] {
  const targets = new Map<string, WatchTarget>();
  for (const spec of buildGitWatchSpecs(paths)) {
    const directory = spec.recursive
      ? path.join(spec.basePath, spec.pattern)
      : path.dirname(path.join(spec.basePath, spec.pattern));
    const key = `${directory}\0${spec.recursive}`;
    const existing = targets.get(key);
    if (!existing) {
      targets.set(key, {
        directory,
        recursive: spec.recursive,
        names: spec.recursive ? null : new Set([path.basename(spec.pattern)]),
        scope: spec.scope,
      });
      continue;
    }
    existing.names?.add(path.basename(spec.pattern));
  }
  return [...targets.values()];
}

/** An SSE response reporting this repository's changes until the client goes. */
export function createGitWatchResponse(options: GitWatchStreamOptions, request: Request): Response {
  const encoder = new TextEncoder();
  const targets = gitWatchTargets(options.paths).slice(0, MAX_WATCHERS_PER_STREAM);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const watchers: FSWatcher[] = [];
      const releases: (() => void)[] = [];
      const timers = new Map<GitChangeScope, ReturnType<typeof setTimeout>>();
      let closed = false;

      const send = (event: GitEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          // The stream is already closed.
        }
      };

      const publish = (scope: GitChangeScope) => {
        if (closed) return;
        const existing = timers.get(scope);
        if (existing) clearTimeout(existing);
        timers.set(scope, setTimeout(() => {
          timers.delete(scope);
          send({ type: "gitStateChanged", repoId: options.repoId, scope });
        }, DEBOUNCE_MS));
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        for (const watcher of watchers) {
          try {
            watcher.close();
          } catch {
            // Closed by the filesystem already.
          }
        }
        watchers.length = 0;
        for (const release of releases) release();
        releases.length = 0;
        unsubscribe();
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      // A watcher whose path dies (a worktree removed while the panel is open)
      // is re-armed after a beat, so the panel does not go silent for good.
      const arm = (target: WatchTarget) => {
        if (closed) return;
        let watcher: FSWatcher;
        try {
          watcher = fsWatch(target.directory, { persistent: false, recursive: target.recursive }, (_type, changed) => {
            const name = changed?.toString();
            if (!name) return publish(target.scope);
            if (target.names && !target.names.has(name)) return;
            publish(target.scope);
          });
        } catch {
          return;
        }
        watchers.push(watcher);
        releases.push(registerFileWatch());
        watcher.on("error", () => {
          const index = watchers.indexOf(watcher);
          if (index >= 0) watchers.splice(index, 1);
          try {
            watcher.close();
          } catch {
            // ignore
          }
          if (!closed) setTimeout(() => arm(target), REARM_DELAY_MS).unref?.();
        });
      };
      for (const target of targets) arm(target);

      const unsubscribe = subscribeGitEvents((event) => {
        if (event.type === "reposChanged") {
          send(event);
          return;
        }
        if (event.repoId === options.repoId) publish(event.scope);
      });

      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          // The stream is already closed.
        }
      }, KEEP_ALIVE_MS);

      controller.enqueue(
        encoder.encode(`event: connected\ndata: ${JSON.stringify({ repoId: options.repoId })}\n\n`),
      );
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
