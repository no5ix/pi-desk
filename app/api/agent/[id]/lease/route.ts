import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { recordPageMemory, type DebugPageMemory } from "@/lib/server-memory";
import { hasUnsettledSubagentRun } from "@/lib/subagent-runtime";

const MAX_COUNT = 10_000_000;

/**
 * The page's own numbers, taken from its lease renewal. Never trusted: every
 * field is coerced to a bounded number, and a body that is not shaped like a
 * sample is ignored — a lease renewal must work exactly as before when the page
 * sends nothing (an older client, a proxy that strips bodies).
 */
function readPageMemory(id: string, body: unknown): DebugPageMemory | null {
  if (typeof body !== "object" || body === null) return null;
  const memory = (body as { memory?: unknown }).memory;
  if (typeof memory !== "object" || memory === null) return null;
  const record = memory as Record<string, unknown>;
  const count = (value: unknown): number => (
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_COUNT ? Math.round(value) : 0
  );
  const jsHeap = typeof record.jsHeapBytes === "number" && Number.isFinite(record.jsHeapBytes) && record.jsHeapBytes >= 0
    ? Math.round(Math.min(record.jsHeapBytes, MAX_COUNT * 1024))
    : null;
  return {
    sessionId: id,
    at: Date.now(),
    jsHeapBytes: jsHeap,
    domNodes: count(record.domNodes),
    messages: count(record.messages),
    renderedRows: count(record.renderedRows),
    queuedPrompts: count(record.queuedPrompts),
  };
}

// POST /api/agent/[id]/lease - A page renews the session it has selected, whether or not it
// holds the event stream: the session's idle countdown starts over (renewIdleTimer()), so it
// is reaped one idle timeout after the last page let go. The reply says what is under way:
// a hidden page lets go of an idle stream and opens it again when this reports activity
// (#1283). Never starts a wrapper.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // The metered side of the same renewal (lib/server-memory.ts): a page reports
  // its own heap, DOM node count and loaded-message count once a minute. Optional
  // and untrusted; a body that is not JSON leaves the renewal untouched.
  try {
    const body: unknown = await req.json();
    const sample = readPageMemory(id, body);
    if (sample) recordPageMemory(sample);
  } catch {
    // No body, or not JSON: the renewal is the whole point of this request.
  }
  const session = getRpcSession(id);
  const alive = Boolean(session?.isAlive());
  // A wrapper built before a hot reload lacks the method; its own timer still runs.
  if (alive && typeof session!.renewIdleTimer === "function") session!.renewIdleTimer();
  return NextResponse.json({
    success: true,
    // A run, a queued prompt, a `!` command or a compaction (isRunning()).
    running: alive && session!.isRunning(),
    // An extension dialog waiting for an answer.
    awaitingInput: alive && session!.isAwaitingInput(),
    // A subagent under this session, at any depth, whose end starts a turn here.
    subagentsActive: hasUnsettledSubagentRun(id),
  }, { headers: { "Cache-Control": "no-store" } });
}
