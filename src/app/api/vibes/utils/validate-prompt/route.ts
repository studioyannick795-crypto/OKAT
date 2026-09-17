import { NextRequest, NextResponse } from "next/server";
import { VibesClient } from "@/lib/vibes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/vibes/utils/validate-prompt
 *
 * Body: { prompt }
 * Validates the prompt length. Does not require authentication.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body?.prompt !== "string") {
      return NextResponse.json(
        { error: "Field `prompt` is required." },
        { status: 400 },
      );
    }
    return NextResponse.json(VibesClient.validatePromptLength(body.prompt));
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
