import { sendTestPush } from "@/lib/web-push";
import { readEndpoint } from "@/lib/push-endpoint-body";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

// POST /api/push/test  body: { endpoint } - send a test notification to this device only.
export async function POST(req: Request): Promise<Response> {
  const endpoint = await readEndpoint(req);
  if (!endpoint) return Response.json({ error: "Invalid push endpoint" }, { status: 400 });
  try {
    const sent = await sendTestPush(endpoint);
    if (!sent) return Response.json({ error: "This device is not subscribed" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: 502 },
    );
  }
}
