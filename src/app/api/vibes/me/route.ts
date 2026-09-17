import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/vibes/me
 * Returns the authenticated vibes.ai user.
 */
export async function GET(_request: NextRequest) {
  if (!hasVibesCookie()) {
    return NextResponse.json(
      { error: "VIBES_META_SESSION env var not set." },
      { status: 500 },
    );
  }
  try {
    const client = getVibesClient();
    return NextResponse.json(await client.getMe());
  } catch (error: any) {
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
}
