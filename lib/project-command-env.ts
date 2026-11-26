import {
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
  COMMAND_TIMEOUT_MS,
  commandTimeoutDescriptionSuffix,
  commandTimeoutParametersSchema,
  resolveEffectiveTimeoutSeconds,
} from "./command-timeout";

const HOST_EXTENSION_NAME = "pi-web-project-command-environment";
const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;
// Pi's own abort path settles well within this once the process tree is gone.
const ABORT_SETTLE_GRACE_MS = 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ProjectShellSettings = {
  getShellCommandPrefix(): string | undefined;
  getShellPath(): string | undefined;
};

type ProjectCommandBashOperationsOptions = {
  abortSettleGraceMs?: number;
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
  /**
   * Timeout for a command that asked for none, in ms (lib/command-timeout.ts).
   * `0` runs it with no default, pi's own behaviour.
   */
  defaultTimeoutMs?: number;
};

type BashExecResult = Awaited<ReturnType<BashOperations["exec"]>>;

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_")
    // The browser login password guards this server; commands run on behalf of
    // a project (and the model reading their output) have no use for it.
    || comparableName === "PI_WEB_PASSWORD";
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

function withAgentBinDirectory(
  environment: NodeJS.ProcessEnv,
  agentBinDir: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathKey = platform === "win32"
    ? Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const currentPath = environment[pathKey] ?? "";
  const pathEntries = currentPath.split(pathDelimiter).filter(Boolean);
  if (!pathEntries.includes(agentBinDir)) {
    environment[pathKey] = [agentBinDir, currentPath].filter(Boolean).join(pathDelimiter);
  }
  return environment;
}

export function createProjectCommandBashOperations(
  options: ProjectCommandBashOperationsOptions = {},
): BashOperations {
  const {
    abortSettleGraceMs = ABORT_SETTLE_GRACE_MS,
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    localOperations = createLocalBashOperations({ shellPath: options.shellPath }),
    platform = process.platform,
    defaultTimeoutMs = COMMAND_TIMEOUT_MS,
  } = options;

  return {
    exec(command, cwd, executionOptions) {
      const environment = withAgentBinDirectory(
        sanitizeProjectCommandEnvironment(executionOptions.env ?? baseEnvironment, platform),
        agentBinDir,
        platform,
      );
      const { onData, signal, timeout } = executionOptions;
      // pi's shell tool has no default timeout, so a command that never returns holds
      // the whole run (lib/command-timeout.ts). The default goes *into* the spawn: pi
      // then kills the process tree at the deadline, which a promise-side timer alone
      // cannot do — it would abandon a live child and orphan it.
      const effectiveTimeoutSeconds = resolveEffectiveTimeoutSeconds(timeout, defaultTimeoutMs);
      let released = false;
      const execution = localOperations.exec(command, cwd, {
        ...executionOptions,
        timeout: effectiveTimeoutSeconds,
        env: environment,
        // Callers finalize their output once the command is released; a
        // survivor must not append to it afterwards.
        onData: (data) => {
          if (!released) onData(data);
        },
      });
      // Pi rejects any other timeout before it starts the command.
      const timeoutMs = effectiveTimeoutSeconds === undefined
        ? undefined
        : effectiveTimeoutSeconds * 1000;
      if (!signal && timeoutMs === undefined) return execution;

      // On Stop or a timeout, pi kills the shell's process tree but then keeps
      // reading until every inherited stdout/stderr handle falls idle. A
      // descendant the kill cannot reach (its own session on POSIX, an orphan
      // `taskkill /T` misses on Windows) can keep writing and hold the tool
      // call, and with it Stop and any steering, until the script ends on its
      // own (#647). The errors are pi's own, so the bash tool reports them as
      // "Command aborted" and "Command timed out".
      return new Promise<BashExecResult>((resolve, reject) => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        const release = () => {
          released = true;
          for (const timer of timers) clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };
        const releaseAfter = (delayMs: number, error: Error) => {
          const timer = setTimeout(() => {
            release();
            reject(error);
          }, Math.min(delayMs, MAX_TIMER_DELAY_MS));
          // A command whose spawn never settles must not keep a quitting process alive:
          // the bound is a safety net for a live server, not a reason to stay up.
          timer.unref?.();
          timers.push(timer);
        };
        const onAbort = () => releaseAfter(abortSettleGraceMs, new Error("aborted"));
        if (timeoutMs !== undefined && effectiveTimeoutSeconds !== undefined) {
          // The seconds pi's own message names: the model's number when it gave one,
          // the default otherwise, so "Command timed out after N seconds" is the truth.
          releaseAfter(timeoutMs + abortSettleGraceMs, new Error(`timeout:${effectiveTimeoutSeconds}`));
        }
        execution.then((result) => {
          release();
          resolve(result);
        }, (error: unknown) => {
          release();
          reject(error);
        });
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
  /** Timeout for a command that asked for none, in ms; `0` leaves pi's no-default behaviour. */
  defaultTimeoutMs?: number;
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createBashToolDefinition(options.cwd);
      const defaultTimeoutMs = options.defaultTimeoutMs ?? COMMAND_TIMEOUT_MS;
      pi.registerTool({
        ...displayDefinition,
        // pi's schema says "no default timeout", and the operations below impose one. The
        // parameter description is the model's whole contract about timeouts, so it is
        // restated here: a model that reads a default asks for more time for a long build.
        description: `${displayDefinition.description.split("Optionally provide a timeout in seconds.")[0].trimEnd()}${commandTimeoutDescriptionSuffix(defaultTimeoutMs)}`.trim(),
        parameters: commandTimeoutParametersSchema(defaultTimeoutMs),
        // This stands in for pi's built-in bash, so like it, it is active only when named:
        // by `defaultTools` (pi's default list names it), a preset or `set_tools`. Otherwise
        // pi turns it on at every start and reload, as it does any extension tool, whatever
        // `defaultTools` leaves out (#1235).
        defaultActive: false,
        execute(toolCallId, params, signal, onUpdate, context) {
          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix(),
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath(),
              defaultTimeoutMs,
            }),
          });
          return executionDefinition.execute(toolCallId, params, signal, onUpdate, context);
        },
      });
    },
  };
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userBashOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("bash"));
  if (!userBashOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_EXTENSION_PATH
      && error.error === `Tool "bash" conflicts with ${userBashOwner.path}`
    )),
  };
}
