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
 * POST /api/vibes/tts
 *
 * Body: { text, voice, output_format?, language? }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.text || !body?.voice) {
      return NextResponse.json(
        { error: "Fields `text` and `voice` are required." },
        { status: 400 },
      );
    }

    const result = await client.tts({
      text: body.text,
      voice: body.voice,
      outputFormat: body.output_format,
      language: body.language,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
