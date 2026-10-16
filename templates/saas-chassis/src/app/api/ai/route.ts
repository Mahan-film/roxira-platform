import { z } from "zod";
import { chatStream } from "@/lib/ai";
import { getSession } from "@/lib/tenant";

export const runtime = "nodejs";

const Body = z.object({ prompt: z.string().min(1).max(8000) });

/** Example streaming AI endpoint. Requires a session; add assertWithinLimit() for metering. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("bad request", { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        for await (const delta of chatStream([{ role: "user", content: parsed.data.prompt }])) {
          controller.enqueue(enc.encode(delta));
        }
      } catch {
        controller.enqueue(enc.encode("\n[error]"));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-AI-Generated": "true" },
  });
}
