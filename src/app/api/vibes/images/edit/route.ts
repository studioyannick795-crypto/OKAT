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
 * POST /api/vibes/images/edit
 *
 * Body: { source_image_ent_id, edit_prompt, project_id? }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.source_image_ent_id || !body?.edit_prompt) {
      return NextResponse.json(
        {
          error: "Fields `source_image_ent_id` and `edit_prompt` are required.",
        },
        { status: 400 },
      );
    }

    const result = await client.editImage({
      sourceImageEntId: body.source_image_ent_id,
      editPrompt: body.edit_prompt,
      projectId: body.project_id,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
