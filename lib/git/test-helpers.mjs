import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

/**
 * Shared fixtures for the Git panel's server tests.
 *
 * Every suite works in a throwaway repository under the OS temp directory: the
 * cases stage, commit, merge, reset and delete, so they must never run against a
 * checkout anyone cares about. The agent directory is redirected too, so the
 * allowed-root scan and the dashboard file stay inside the temp tree.
 */

export async function createSandbox() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pi-git-")));
  // Keep every pi/SDK lookup (sessions, agent dir) inside the sandbox.
  const agentDir = path.join(root, "agent");
  await fs.mkdir(agentDir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return { root, agentDir };
}

const GIT_ENV = { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

export function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: GIT_ENV,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** A repository with one commit, a clean tree, and a local `origin` remote. */
export async function createRepo(root, name = "repo") {
  const repoRoot = path.join(root, name);
  await fs.mkdir(repoRoot, { recursive: true });
  git(repoRoot, "init", "--initial-branch=main", "--quiet");
  git(repoRoot, "config", "user.name", "Pi Test");
  git(repoRoot, "config", "user.email", "pi-test@example.com");
  git(repoRoot, "config", "commit.gpgsign", "false");
  await fs.writeFile(path.join(repoRoot, "README.md"), "# fixture\n\nfirst line\n");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 1;\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "initial commit");
  return repoRoot;
}

/** A bare repository to push to, wired as `origin`. */
export async function createOrigin(root, repoRoot) {
  const remote = path.join(root, "origin.git");
  git(path.dirname(remote), "init", "--bare", "--quiet", remote);
  git(repoRoot, "remote", "add", "origin", remote);
  git(repoRoot, "push", "--quiet", "-u", "origin", "main");
  return remote;
}

export async function addWorktree(repoRoot, worktreePath, branch) {
  git(repoRoot, "worktree", "add", worktreePath, "-b", branch, "HEAD");
  return worktreePath;
}

export async function loadGitModules() {
  const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
  return {
    workspace: await jiti.import("./workspace.ts"),
    commands: await jiti.import("./commands.ts"),
    errors: await jiti.import("./errors.ts"),
    dashboard: await jiti.import("./dashboard-store.ts"),
    fileAccess: await jiti.import("../file-access.ts"),
  };
}
