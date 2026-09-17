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
 * POST /api/vibes/videos/edit
 *
 * Body: { project_id, batch_id, content_id?, prompt, poll?, poll_timeout? }
 *
 * Fetches the source batch, finds the matching content item (or falls back
 * to the first one), and calls `client.editVideo(...)`.
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.project_id || !body?.batch_id || !body?.prompt) {
      return NextResponse.json(
        { error: "Fields `project_id`, `batch_id`, and `prompt` are required." },
        { status: 400 },
      );
    }

    const batch = await client.getBatch(body.batch_id);
    const content = batch?.content ?? [];
    let source =
      content.find((x: any) => x.id === body.content_id) ?? content[0] ?? null;
    if (!source) {
      return NextResponse.json(
        { error: "No content item found" },
        { status: 404 },
      );
    }

    const poll = body.poll === true;
    const result = await client.editVideo({
      projectId: body.project_id,
      sourceVideo: source,
      prompt: body.prompt,
      poll,
      pollTimeout: body.poll_timeout,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
