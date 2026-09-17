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
 * POST /api/vibes/prompts/enhance
 *
 * Body: { prompt, project_id?, batch_type? }
 * Returns `{ variations: string[] }` of AI-rewritten prompts.
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.prompt) {
      return NextResponse.json(
        { error: "Field `prompt` is required." },
        { status: 400 },
      );
    }

    const variations = await client.enhancePrompt({
      prompt: body.prompt,
      projectId: body.project_id,
      batchType: body.batch_type,
    });
    return NextResponse.json({ variations });
  } catch (error: any) {
    return handleError(error);
  }
}
