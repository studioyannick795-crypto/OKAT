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
 * POST /api/vibes/timeline/export?project_id=...
 *
 * Body: { composition }
 *
 * Renders the timeline to an MP4 and returns the binary response.
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("project_id") ?? "";
    if (!projectId) {
      return NextResponse.json(
        { error: "Query param `project_id` is required." },
        { status: 400 },
      );
    }

    const body = await request.json();
    if (!body?.composition) {
      return NextResponse.json(
        { error: "Field `composition` is required." },
        { status: 400 },
      );
    }

    const buffer = await client.exportTimeline(projectId, body.composition);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return handleError(error);
  }
}
