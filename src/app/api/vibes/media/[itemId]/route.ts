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
  params: Promise<{ itemId: string }>;
}

/**
 * DELETE /api/vibes/media/[itemId]
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { itemId } = await params;
    await client.deleteContentItem(itemId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleError(error);
  }
}
