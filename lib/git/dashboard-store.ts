import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { BranchDashboardStateStore } from "./branch-dashboard-state";
import type { BranchDashboardMemento } from "./branch-dashboard-state";

/**
 * Branchshift kept the branch dashboard's favourites and view preferences in VS
 * Code's globalState (`Memento`). pi-desk has no extension host, so the same
 * shape is stored in one JSON file under the agent directory, next to
 * `scheduled-tasks.json`. The store keeps Branchshift's key layout
 * (`branchshift.branchDashboard.v1`), so favourites a user already has in
 * Branchshift carry over when the file is copied.
 */

export const GIT_DASHBOARD_FILE = "git-dashboard.json";

type StoredState = Record<string, unknown>;

function stateFile(agentDir = getAgentDir()): string {
  return path.join(agentDir, GIT_DASHBOARD_FILE);
}

async function loadState(file: string): Promise<StoredState> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as StoredState
      : {};
  } catch {
    return {};
  }
}

async function writeState(file: string, state: StoredState): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  // A unique temp file per write: two panels saving at once must not have one
  // rename clobber the other's partially written file.
  const temporary = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

/** The `Memento` the ported dashboard store expects, plus a priming read. */
export interface GitDashboardMemento extends BranchDashboardMemento {
  /** Reads the file into the memento, so the store's synchronous reads see it. */
  prime(): Promise<void>;
}
/** The `Memento` the ported dashboard store expects. */
export function createGitDashboardMemento(agentDir = getAgentDir()): GitDashboardMemento {
  const file = stateFile(agentDir);
  let cached: StoredState | null = null;
  let chain: Promise<void> = Promise.resolve();

  const read = async (): Promise<StoredState> => {
    if (cached) return cached;
    cached = await loadState(file);
    return cached;
  };

  return {
    prime: async () => {
      await read();
    },
    get<T>(key: string, defaultValue: T): T {
      // Synchronous by contract: the store works from the copy it was given,
      // so a cold memento hands back the default until `prime()` has run.
      const value = cached?.[key];
      return value === undefined ? defaultValue : value as T;
    },
    update(key: string, value: unknown): Promise<void> {
      const write = chain.then(async () => {
        const state = await read();
        if (value === undefined) delete state[key];
        else state[key] = value;
        cached = state;
        await writeState(file, state);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

let storePromise: Promise<BranchDashboardStateStore> | null = null;

/** The shared store: favourites and view preferences for every repository. */
export async function getGitDashboardStore(): Promise<BranchDashboardStateStore> {
  if (storePromise) return storePromise;
  const memento = createGitDashboardMemento();
  storePromise = memento.prime().then(() => new BranchDashboardStateStore(memento));
  return storePromise;
}
