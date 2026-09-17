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
 * GET /api/vibes/batches?limit=&offset=&project_id=
 * List generation batches.
 */
export async function GET(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 12);
    const offset = Number(searchParams.get("offset") ?? 0);
    const projectId = searchParams.get("project_id") ?? undefined;
    const result = await client.listBatches({ limit, offset, projectId });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
