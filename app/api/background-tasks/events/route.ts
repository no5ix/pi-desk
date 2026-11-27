import { subscribeBackgroundTasksChanges } from "@/lib/background-tasks/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/background-tasks/events?session= — SSE of the extension's change frames.
 *
 * The change feed is an invalidation, not data: the extension publishes at most one
 * coalesced frame per 100 ms, carrying only counts and a revision, and the panel re-reads
 * `list` on it. That is the whole refresh story while a task runs, so the panel polls only as
 * a safety net for a stream this tab lost.
 *
 * The stream belongs to the panel that opened it (a monitor the user is looking at), so it
 * opens its own connection rather than joining a shared one — unlike the sidebar's
 * running-sessions stream, every tab's open panel wants its own frames.
 *
 * The frames also say when a bridge joins or leaves (`type: "bridges"`): opening another
 * conversation of the same project adds its registry to the panel, and closing one removes
 * the tasks it owned.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "session is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  let dispose = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        request.signal?.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* already closed */ }
      };
      dispose = cleanup;
      request.signal?.addEventListener("abort", cleanup);
      const encode = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const subscribe = subscribeBackgroundTasksChanges(sessionId, (change) => {
        if (change.type === "bridges") {
          encode({ type: "bridges" });
          return;
        }
        const frame = change.frame;
        if (!frame) return;
        // Deduplication keys the client uses: the task list is refetched, never inferred.
        encode({
          type: "change",
          sessionId: change.sessionId,
          kind: frame.kind,
          activationId: frame.activationId,
          revision: frame.revision,
          counts: frame.counts,
        });
      });
      unsubscribe = subscribe;
      // The first frame tells the client the stream is alive, so an open panel refetches
      // once here: the snapshot it asked for may have raced a change.
      encode({ type: "hello" });
      if (!closed) {
        heartbeat = setInterval(() => {
          if (closed) return;
          try { controller.enqueue(encoder.encode(":\n\n")); } catch { cleanup(); }
        }, 30_000);
      }
    },
    cancel() {
      dispose();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
