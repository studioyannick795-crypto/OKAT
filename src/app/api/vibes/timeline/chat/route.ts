import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured() {
  return NextResponse.json(
    { error: "VIBES_META_SESSION env var not set." },
    { status: 500 },
  );
}

function handleError(error: any) {
  const status = error?.status ?? 500;
  return NextResponse.json(
    {
      error: error?.message ?? "Unknown error",
      code: error?.code,
      response: error?.response,
    },
    { status },
  );
}

/**
 * POST /api/vibes/timeline/chat
 *
 * Body: { input, instructions?, tools?, composition? }
 *
 * Collects all SSE events from `client.timelineChat(...)` into an array and
 * returns `{ events: [...] }`. Iteration stops after the first event whose
 * `type` is `completed` or `error`.
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.input) {
      return NextResponse.json(
        { error: "Field `input` is required." },
        { status: 400 },
      );
    }

    const events: any[] = [];
    for await (const ev of client.timelineChat({
      input: body.input,
      instructions: body.instructions,
      tools: body.tools,
      composition: body.composition,
    })) {
      events.push(ev);
      if (ev?.type === "completed" || ev?.type === "error") break;
    }
    return NextResponse.json({ events });
  } catch (error: any) {
    return handleError(error);
  }
}
