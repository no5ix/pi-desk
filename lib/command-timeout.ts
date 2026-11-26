import { Type } from "typebox";

/**
 * Command timeouts.
 *
 * pi's shell tool has no default: `timeout` is optional and, left out, the command runs
 * until it exits or the user presses Stop. That is right for the TUI, where a person is
 * watching a terminal. It is not right here, because this app shows the run in a chat
 * window and the shell command sits *inside* an agent run: a command that never returns
 * (a test runner that waits on a server it started itself, a browser it forgot to close,
 * a `watch` mode) leaves the model request that spawned it outstanding, the session
 * running, the composer locked, and the window reading "Running command…". Measured in a
 * real session: one `node e2e/…` that hung and was never stopped occupied the run for
 * 7849 seconds. Nothing downstream can recover from that — the SDK is right to report
 * itself busy, and the client is right to believe it.
 *
 * So the fork's shell tool names a default, in the parameter description the model reads,
 * and the operations that run the command apply it when the model leaves `timeout` out.
 * The model's own timeout always wins, including a longer one, and `0` removes the
 * default for a whole installation.
 */

/** 30 minutes: long enough for a real build, test suite, or e2e run; short of a hung day. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30 * 60_000;

/** Node's timer ceiling; a delay over it fires immediately, so it is treated as unset. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Resolves `PI_WEB_COMMAND_TIMEOUT_MS`: unset/blank is the 30-minute default, `0` runs
 * commands with no default timeout (pi's own behaviour), and positive values are used as
 * given. Out-of-range values fall back to the default with a warning.
 */
export function resolveCommandTimeoutMs(
  rawValue: string | undefined = process.env.PI_WEB_COMMAND_TIMEOUT_MS,
): number {
  if (rawValue === undefined || rawValue.trim() === "") return DEFAULT_COMMAND_TIMEOUT_MS;
  const parsed = Number(rawValue);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_TIMER_DELAY_MS) return Math.floor(parsed);
  console.warn(`[pi-web] invalid PI_WEB_COMMAND_TIMEOUT_MS "${rawValue}", falling back to 30 minutes`);
  return DEFAULT_COMMAND_TIMEOUT_MS;
}

/** Resolved once, like the idle timeout: the tool schema and the runner must agree. */
export const COMMAND_TIMEOUT_MS = resolveCommandTimeoutMs();

/** Seconds, as the shell tool's `timeout` parameter counts, or undefined for "no timeout". */
export function commandTimeoutSeconds(timeoutMs: number): number | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return undefined;
  return Math.max(1, Math.round(timeoutMs / 1000));
}

/**
 * The `timeout` a command runs with: the model's, when it gave one (pi validates it),
 * otherwise the installation's default.
 */
export function resolveEffectiveTimeoutSeconds(
  requestedTimeout: unknown,
  defaultMs: number = COMMAND_TIMEOUT_MS,
): number | undefined {
  if (typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout) && requestedTimeout > 0) {
    return requestedTimeout;
  }
  return commandTimeoutSeconds(defaultMs);
}

/** The line the model reads for the `timeout` parameter, naming the default that applies. */
export function commandTimeoutParameterDescription(defaultMs: number = COMMAND_TIMEOUT_MS): string {
  const seconds = commandTimeoutSeconds(defaultMs);
  if (seconds === undefined) return "Timeout in seconds (optional, no default timeout)";
  return `Timeout in seconds. A command with no timeout is stopped after ${seconds} seconds; pass a larger value for a build, test suite, or long-running server.`;
}

/**
 * The shell tool's parameters, with the timeout described the way this installation
 * enforces it. pi's own schema says "no default timeout", and a model that believes it
 * never passes one — the description is the whole contract with the model.
 */
export function commandTimeoutParametersSchema(defaultMs: number = COMMAND_TIMEOUT_MS) {
  return Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    timeout: Type.Optional(Type.Number({ description: commandTimeoutParameterDescription(defaultMs) })),
  });
}

/** The tool description's closing sentence, so the default is stated where the model reads it. */
export function commandTimeoutDescriptionSuffix(defaultMs: number = COMMAND_TIMEOUT_MS): string {
  const seconds = commandTimeoutSeconds(defaultMs);
  if (seconds === undefined) return " Optionally provide a timeout in seconds.";
  return ` Provide a timeout in seconds for long work; commands without one are stopped after ${seconds} seconds.`;
}
