import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/vibes
 * Root info endpoint — mirrors Python FastAPI `/`.
 */
export async function GET() {
  return NextResponse.json({
    name: "VibesAI API",
    version: "1.5.1",
    docs: "/api/vibes",
  });
}
