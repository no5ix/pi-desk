import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitRunOptions {
  /** Added over the inherited environment; a full replacement is never taken. */
  env?: Record<string, string>;
  allowedExitCodes?: readonly number[];
  maxBuffer?: number;
  /**
   * Wall-clock cap for one git process. Branchshift ran git in an extension
   * host the user watched; here a hung command holds a server request, so
   * every run is capped. Network commands pass a longer budget.
   */
  timeoutMs?: number;
}

const DEFAULT_GIT_TIMEOUT_MS = 60_000;
export const GIT_NETWORK_TIMEOUT_MS = 300_000;

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly exitCode: number,
    readonly stderr: string,
  ) {
    super(stderr.trim() || `Git exited with code ${exitCode}`);
    this.name = "GitCommandError";
  }
}

export class GitExecutor {
  constructor(readonly rootPath: string) {}

  async text(
    args: readonly string[],
    options?: GitRunOptions,
  ): Promise<string> {
    return (await this.buffer(args, options)).toString();
  }

  async buffer(
    args: readonly string[],
    options?: GitRunOptions,
  ): Promise<Buffer> {
    try {
      const { stdout } = await execFileAsync("git", args, {
        ...this.execOptions(options),
        encoding: "buffer",
      });
      return stdout as Buffer;
    } catch (error: unknown) {
      const commandError = error as {
        code?: unknown;
        stdout?: string | Buffer;
      };
      if (
        typeof commandError.code === "number" &&
        this.allowed(options).includes(commandError.code)
      ) {
        const stdout = commandError.stdout;
        return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
      }
      throw this.commandError(args, error);
    }
  }

  lines(args: readonly string[], options?: GitRunOptions): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, this.execOptions(options));
      const lines: string[] = [];
      let remainder = "";
      let stderr = "";
      let settled = false;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        const parts = `${remainder}${chunk}`.split("\n");
        remainder = parts.pop() ?? "";
        for (const line of parts) {
          lines.push(line);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        if (remainder) lines.push(remainder);
        const code = exitCode ?? -1;
        if (this.allowed(options).includes(code)) {
          resolve(lines);
          return;
        }
        reject(new GitCommandError(args, code, stderr));
      });
    });
  }

  withInput(
    args: readonly string[],
    input: Buffer | string,
    options?: GitRunOptions,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, this.execOptions(options));
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputLength = 0;
      let settled = false;
      const maxBuffer = options?.maxBuffer ?? 1024 * 1024;

      const addOutput = (chunk: Buffer, target: Buffer[]) => {
        outputLength += chunk.length;
        if (outputLength > maxBuffer) {
          if (settled) return;
          settled = true;
          child.kill();
          reject(new RangeError("Git output exceeds maxBuffer"));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => addOutput(chunk, stdout));
      child.stderr.on("data", (chunk: Buffer) => addOutput(chunk, stderr));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.stdin.once("error", (error) => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(error);
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        const code = exitCode ?? -1;
        if (this.allowed(options).includes(code)) {
          resolve(Buffer.concat(stdout));
          return;
        }
        reject(
          new GitCommandError(args, code, Buffer.concat(stderr).toString()),
        );
      });
      try {
        child.stdin.end(input);
      } catch (error) {
        if (settled) return;
        settled = true;
        child.kill();
        reject(error);
      }
    });
  }

  private execOptions(options?: GitRunOptions) {
    return {
      cwd: this.rootPath,
      maxBuffer: options?.maxBuffer,
      timeout: options?.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      killSignal: "SIGKILL" as const,
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        // A server has no terminal to hand an editor. Without these, a command
        // that wants a commit message (`rebase --continue`, a non-fast-forward
        // merge) opens Vim and hangs until the timeout kills it.
        GIT_EDITOR: "true",
        GIT_SEQUENCE_EDITOR: "true",
        GIT_MERGE_AUTOEDIT: "no",
        GIT_PAGER: "cat",
        ...options?.env,
      },
    };
  }

  private allowed(options?: GitRunOptions): readonly number[] {
    return options?.allowedExitCodes ?? [0];
  }

  private commandError(args: readonly string[], error: unknown): Error {
    const commandError = error as {
      code?: unknown;
      stderr?: string | Buffer;
      stdout?: string | Buffer;
    };
    if (typeof commandError.code === "number") {
      // git reports a merge/rebase conflict on stdout while its exit status is
      // the failure, so the message the panel shows reads both streams.
      const detail = streamText(commandError.stderr) || streamText(commandError.stdout);
      return new GitCommandError(args, commandError.code, detail);
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}

function streamText(value: string | Buffer | undefined): string {
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString() : "";
}
