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

interface Params {
  params: Promise<{ bid: string }>;
}

/**
 * POST /api/vibes/batches/[bid]/poll?timeout=180
 *
 * Polls the batch until completion or `timeout` seconds elapse.
 */
export async function POST(request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { bid } = await params;
    const { searchParams } = new URL(request.url);
    const timeout = Number(searchParams.get("timeout") ?? 180);
    const result = await client.pollBatch(bid, { timeout });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
