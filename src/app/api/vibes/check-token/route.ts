import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/vibes/check-token
 * Returns `{ valid: boolean }` indicating whether the session cookie is valid.
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
    return NextResponse.json({ valid: await client.checkToken() });
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
