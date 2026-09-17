import { NextRequest, NextResponse } from "next/server";
import { removeMetaWatermark, hasWatermarkModel } from "@/lib/watermark/remove";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 120;

/**
 * POST /api/vibes/watermark/clean
 *
 * Body: { image_url: string }  or  raw image bytes (Content-Type: image/*)
 *
 * Removes the Meta AI watermark from the bottom-right corner of an image
 * using the MI-GAN inpainting model, and returns the cleaned PNG.
 *
 * If the model is unavailable or inpainting fails, the original image is
 * returned unchanged (graceful degradation).
 */
export async function POST(request: NextRequest) {
  try {
    let imageBuffer: Buffer;

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.startsWith("image/")) {
      // Raw image bytes uploaded directly
      const ab = await request.arrayBuffer();
      imageBuffer = Buffer.from(ab);
    } else {
      // JSON body with an image_url
      const body = await request.json();
      const imageUrl = body?.image_url;
      if (!imageUrl || typeof imageUrl !== "string") {
        return NextResponse.json(
          { error: "Body must be { image_url: string } or raw image bytes" },
          { status: 400 },
        );
      }
      // Download the image from the CDN
      const resp = await fetch(imageUrl, {
        signal: AbortSignal.timeout(60000),
      });
      if (!resp.ok) {
        return NextResponse.json(
          { error: `Failed to fetch image: HTTP ${resp.status}` },
          { status: 502 },
        );
      }
      const ab = await resp.arrayBuffer();
      imageBuffer = Buffer.from(ab);
    }

    // Check if the model is available
    if (!hasWatermarkModel()) {
      // No model — return the original image
      return new Response(imageBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(imageBuffer.byteLength),
          "Cache-Control": "no-store",
          "X-Watermark-Removed": "false",
        },
      });
    }

    // Remove the watermark
    try {
      const cleaned = await removeMetaWatermark(imageBuffer);
      return new Response(cleaned, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(cleaned.byteLength),
          "Cache-Control": "no-store",
          "X-Watermark-Removed": "true",
        },
      });
    } catch (wmError: any) {
      console.error("[watermark] clean failed:", wmError?.message);
      // Return the original image on failure
      return new Response(imageBuffer, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(imageBuffer.byteLength),
          "Cache-Control": "no-store",
          "X-Watermark-Removed": "false",
        },
      });
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
