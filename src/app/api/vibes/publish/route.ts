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
 * POST /api/vibes/publish
 *
 * Body: { content_item_id, batch_id?, caption?, audio_types?, prompt?,
 *        image_prompt?, video_prompt? }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.content_item_id) {
      return NextResponse.json(
        { error: "Field `content_item_id` is required." },
        { status: 400 },
      );
    }

    const result = await client.publishToVibes({
      contentItemId: body.content_item_id,
      batchId: body.batch_id,
      caption: body.caption,
      audioTypes: body.audio_types,
      prompt: body.prompt,
      imagePrompt: body.image_prompt,
      videoPrompt: body.video_prompt,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
