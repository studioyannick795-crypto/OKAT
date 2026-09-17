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
 * POST /api/vibes/lipsync
 *
 * Body: { project_id, image_prompt, script, audio_url, audio_duration_ms,
 *        engine?, ingredients?, aspect_ratio?, music_track?,
 *        custom_motion_prompt? }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (
      !body?.project_id ||
      !body?.image_prompt ||
      !body?.script ||
      !body?.audio_url ||
      body?.audio_duration_ms === undefined
    ) {
      return NextResponse.json(
        {
          error:
            "Fields `project_id`, `image_prompt`, `script`, `audio_url`, and `audio_duration_ms` are required.",
        },
        { status: 400 },
      );
    }

    const result = await client.generateLipsync({
      projectId: body.project_id,
      imagePrompt: body.image_prompt,
      script: body.script,
      audioUrl: body.audio_url,
      audioDurationMs: body.audio_duration_ms,
      engine: body.engine,
      ingredients: body.ingredients,
      aspectRatio: body.aspect_ratio,
      musicTrack: body.music_track,
      customMotionPrompt: body.custom_motion_prompt,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
