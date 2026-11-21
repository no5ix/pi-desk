import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The completion notification's sentence needs the run's start and end. The several
// paths that end a run (agent_end, the settle/timeout path, a stopped prompt) must all
// report the same span, and a run that never started must not invent one.

const source = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("AgentEndInfo carries the run's clock, and the type stays optional", () => {
  const info = source.match(/export interface AgentEndInfo \{[\s\S]*?\n\}/);
  assert.ok(info, "AgentEndInfo found");
  assert.match(info[0], /startedAt\?: number;/);
  assert.match(info[0], /endedAt\?: number;/);
  assert.match(source, /onAgentEnd\?: \(end: AgentEndInfo\) => void;/);
});

test("the start is stamped once per run and cleared when the run ends", () => {
  assert.match(source, /const runStartedAtRef = useRef<number \| null>\(null\);/);
  assert.match(source, /const beginRunTiming = useCallback\(\(\) => \{\s*if \(runStartedAtRef\.current === null\) runStartedAtRef\.current = Date\.now\(\);/);
  const end = source.match(/const endRunTiming = useCallback[\s\S]*?\n  \}, \[\]\);/);
  assert.ok(end, "endRunTiming found");
  assert.match(end[0], /runStartedAtRef\.current = null;/, "a second end reports no second run");
  assert.match(end[0], /return startedAt === null \? \{ aborted \} : \{ aborted, startedAt, endedAt: Date\.now\(\) \};/,
    "no fabricated zero-length notification for a run that never started");
});

test("every path that ends a run goes through endRunTiming", () => {
  const emits = source.match(/onAgentEnd\?\.\(endRunTiming\([^)]*\)\)/g) ?? [];
  assert.ok(emits.length >= 3, `agent_end, the settle path and the prompt-stage notice all report timing (${emits.length} found)`);
  assert.match(source, /if \(wasRunning\) onAgentEnd\?\.\(endRunTiming\(event\.aborted === true\)\);/,
    "the agent_end event keeps its aborted flag and adds the span");
  const bareEmits = source.match(/onAgentEnd\?\.\(\{[^}]*\}\)/g) ?? [];
  assert.deepEqual(bareEmits, [], "no path emits an AgentEndInfo that skipped endRunTiming");
});

test("sending a prompt starts the clock", () => {
  const begins = source.match(/^\s*beginRunTiming\(\);$/gm) ?? [];
  assert.ok(begins.length >= 2, "the running-session send and the new-session send both stamp the start");
  assert.match(source, /beginRunTiming, cancelEventStreamGrace, endRunTiming/, "the deps are declared, so the refs are not stale");
});
