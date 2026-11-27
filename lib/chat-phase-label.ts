import type { AgentPhase } from "@/hooks/useAgentSession";
import type { AgentRunPhase } from "@/lib/agent-run-liveness";
import { formatTurnDurationCompact } from "@/lib/turn-duration";
import type { Translate } from "./i18n/types";

/**
 * The phase a state read (`GET /api/sessions/[id]/state`, `GET /api/agent/[id]`)
 * implies. A tool call the stream already reported running outranks it: the
 * state only says the run is active, and a read landing after `connected` and
 * the replay of the running calls would otherwise say "waiting for model" for
 * the rest of a tool that sends nothing more. `connected` itself starts from no
 * tools, since the replay that follows it lists every call still running.
 */
export function runStatePhase(prev: AgentPhase, isStreaming: boolean): AgentPhase {
  if (prev?.kind === "running_tools" && prev.tools.length > 0) return prev;
  return isStreaming ? { kind: "waiting_model" } : { kind: "running_command" };
}

/**
 * The status line shown while the agent is working.
 *
 * `isCompacting` takes precedence over the phase: auto-compaction can hold a turn for a
 * while before the next token arrives, and reporting the underlying "waiting for model"
 * phase in the meantime reads as a hang. Compaction is what the user needs to know.
 * While compacting, messages queued for after it count beside it (`chat.compactingQueued`).
 *
 * `stall` is the server's word that the run has produced no event at all in one of the
 * phases where only a request the app cannot see inside is outstanding (lib/agent-run-liveness.ts).
 * It replaces the bare "Waiting for model…", which is the sentence that makes a stuck run
 * indistinguishable from a slow one: the same phase, said with the silence attached. The
 * phase still chooses the words, so a user reads *what* is silent, and a run that is
 * streaming, running a tool, compacting or waiting on a person is never described this way.
 */
export function phaseLabel(
  phase: AgentPhase,
  t: Translate,
  isCompacting?: boolean,
  queuedCount = 0,
  stall?: { phase: AgentRunPhase; noProgressMs: number } | null,
): string | null {
  if (isCompacting) return queuedCount > 0 ? t("chat.compactingQueued", { count: queuedCount }) : t("chat.compacting");
  if (stall) {
    const duration = formatTurnDurationCompact(stall.noProgressMs, { withSeconds: true });
    if (stall.phase === "mcp_wait") return t("chat.stalledMcp", { duration });
    if (stall.phase === "prompt_admission") return t("chat.stalledAdmission", { duration });
    if (stall.phase === "waiting_model") return t("chat.stalledModel", { duration });
    return t("chat.stalled", { duration });
  }
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${t("chat.runningNamedTool", { name: latest.name })} ${latest.progress}`;
    }
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1) return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3) return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}
