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
 * POST /api/vibes/images/generate
 *
 * Body: { project_id, prompt, aspect_ratio?, resolution?, variations?,
 *        image_model?, prompt_model?, ingredients?, create_ingredients?,
 *        moodboard? }
 *
 * Image generation is synchronous — no polling needed.
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.project_id || !body?.prompt) {
      return NextResponse.json(
        { error: "Fields `project_id` and `prompt` are required." },
        { status: 400 },
      );
    }

    const result = await client.generateImage({
      projectId: body.project_id,
      prompt: body.prompt,
      aspectRatio: body.aspect_ratio,
      resolution: body.resolution,
      variations: body.variations,
      imageModel: body.image_model,
      promptModel: body.prompt_model,
      ingredients: body.ingredients,
      createIngredients: body.create_ingredients,
      moodboard: body.moodboard,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
