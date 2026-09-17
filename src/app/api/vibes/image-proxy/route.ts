import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 30;

/**
 * GET /api/vibes/image-proxy?url=...
 *
 * Proxies an image URL with CORS headers so OpenCV.js (running in the
 * browser) can read the pixel data from a canvas without tainting it.
 *
 * This does NOT remove the watermark — it just fetches the raw image
 * bytes and returns them with Access-Control-Allow-Origin: *.
 * OpenCV.js does the watermark removal client-side.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json(
      { error: "Missing `url` query parameter" },
      { status: 400 },
    );
  }

  try {
    const resp = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: HTTP ${resp.status}` },
        { status: 502 },
      );
    }

    const contentType =
      resp.headers.get("content-type") || "image/jpeg";
    const buffer = await resp.arrayBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
