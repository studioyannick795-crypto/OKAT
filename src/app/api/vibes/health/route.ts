import { NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/vibes/health
 * Health check — pings vibes.ai to confirm the cookie works.
 */
export async function GET() {
  if (!hasVibesCookie()) {
    return NextResponse.json(
      { status: "unhealthy", error: "VIBES_META_SESSION env var not set." },
      { status: 200 },
    );
  }
  try {
    const client = getVibesClient();
    const user = await client.getMe();
    return NextResponse.json({ status: "healthy", user: user?.username ?? null });
  } catch (error: any) {
    return NextResponse.json(
      { status: "unhealthy", error: error?.message ?? String(error) },
      { status: 200 },
    );
  }
}
