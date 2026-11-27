import { listBackgroundTasksRunning, subscribeBackgroundTasksRunning } from "@/lib/background-tasks/running-index";

export const dynamic = "force-dynamic";

/**
 * GET /api/background-tasks/running/events — SSE of the running-task index.
 *
 * One frame per change: `{ type: "running", sessions }`, the whole map, so a client that
 * reconnects mid-stream cannot miss a conversation. The frames are pushed by the extensions
 * themselves (each live conversation's activation publishes its counts), so the composer's stop
 * control and the sidebar's running mark move when the work moves, without a poll.
 */
export async function GET(request: Request) {
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
        try { controller.close(); } catch { /* already closed or cancelled */ }
      };
      dispose = cleanup;
      request.signal?.addEventListener("abort", cleanup);
      const encode = (data: unknown) => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          cleanup();
          return false;
        }
      };

      // Subscribe before the snapshot, so a change in the gap is not lost. A duplicate frame is
      // harmless: the client sets the same map.
      const nextUnsubscribe = subscribeBackgroundTasksRunning((sessions) => {
        encode({ type: "running", sessions });
      });
      if (closed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;

      encode({ type: "running", sessions: listBackgroundTasksRunning() });

      // Heartbeat, so a proxy with an idle timeout does not close the stream.
      if (!closed) heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(":\n\n")); }
        catch { cleanup(); }
      }, 30_000);
    },
    cancel() {
      dispose();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // Next compresses route-handler responses; `no-transform` keeps that middleware off this
      // stream, whose events a gzipper would hold in its buffer. Same pair as the other streams.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
