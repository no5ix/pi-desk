import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A session can be read several times at once: opening it (forced), the hydration and
// reconcile paths, the SSE settle handler. The responses land in any order, and an older
// response describes an older transcript — which is how a session opened without its
// final report while a page refresh showed it. Only the newest claim may apply.

const source = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("every read of a session claims a ticket", () => {
  assert.match(source, /import \{ createLoadSequence \} from "@\/lib\/session-load-order";/);
  assert.match(source, /const sessionLoadSequenceRef = useRef\(createLoadSequence\(\)\);/);
  const load = source.match(/const loadSession = useCallback\(async \(sid: string[\s\S]*?\n  const flight = /)[0];
  assert.match(load, /const loadTicket = sessionLoadSequenceRef\.current\.take\(\);/);
  assert.ok(load.indexOf("if (inflight) return await inflight;") < load.indexOf("const loadTicket"),
    "a caller that joins an in-flight read claims nothing: the flight owns the apply");
});

test("a read applies only while its ticket is the newest", () => {
  const guard = source.match(/const isCurrent = \(\) => \(\n\s*sessionIdRef\.current === sid\n\s*&& sessionGenerationRef\.current === sessionGeneration\n\s*&& sessionLoadSequenceRef\.current\.isLatest\(loadTicket\)\n\s*\);/);
  assert.ok(guard, "isCurrent includes the newest-claim test");
  const load = source.match(/const loadSession = useCallback\(async \(sid: string[\s\S]*?\n  \}, \[chatWorkspace, seedStreamingSnapshot, setToolPresetState, syncLiveModel\]\);/);
  assert.ok(load, "loadSession body found");
  const applies = load[0].match(/if \(!isCurrent\(\)\) return null;/g) ?? [];
  assert.equal(applies.length, 2, "the transcript apply and the agent-state apply both respect the guard");
  assert.match(load[0], /if \(isCurrent\(\)\) setError\(String\(e\)\);/, "a superseded failure never paints an error over the fresh read");
});

test("the fast paths that keep the view stable stay intact", () => {
  assert.match(source, /const revisionUnchanged = Boolean\(\s*d\.snapshotRevision\s*&& cached\?\.revision === d\.snapshotRevision/,
    "the view cache's freshness check is unchanged: a session that grew has a new revision");
  assert.match(source, /const cached = promoted \? null : getSessionViewSnapshot\(session\.id\);/);
  assert.match(source, /const openLoad = loadSession\(session\.id, !cached && !promoted, true, \{ force: true \}\);/,
    "opening a session is the authoritative forced read (and ?force=1 evicts a wrapper the disk passed)");
  assert.match(source, /const requestId = \+\+contextLoadIdRef\.current;/,
    "the pagination path keeps its own request-id guard");
  assert.match(source, /if \(d\.wrapperRebuilt\) \{/, "the disk-ahead wrapper rebuild keeps closing and reopening the stream");
});
