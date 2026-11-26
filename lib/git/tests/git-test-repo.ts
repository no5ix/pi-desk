// Ported from Branchshift's src/test/git/gitTestRepo.ts: the suites that already
// cover this backend. mocha's global describe/it become node:test imports.
import {  } from "node:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { GitExecutor } from "../../git/core/git-executor";

export class GitTestRepo {
  readonly executor: GitExecutor;

  private constructor(readonly rootPath: string) {
    this.executor = new GitExecutor(rootPath);
  }

  static async create(): Promise<GitTestRepo> {
    const rootPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "branchshift-git-"),
    );
    const repo = new GitTestRepo(rootPath);
    await repo.git("init");
    await repo.git("config", "user.name", "BranchShift Test");
    await repo.git("config", "user.email", "branchshift@example.com");
    return repo;
  }

  git(...args: string[]): Promise<string> {
    return this.executor.text(args);
  }

  writeFile(relativePath: string, content: Buffer | string): Promise<void> {
    return fs.writeFile(path.join(this.rootPath, relativePath), content);
  }
}
