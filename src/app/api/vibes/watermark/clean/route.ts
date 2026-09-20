import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { inpaintWatermarkOptix } from "@/lib/optix-inpaint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/vibes/watermark/clean
 *
 * Uses the Optix inpainting algorithm (Fast Marching Radial).
 * 100% local — no external API.
 *
 * Body: { image_url: string, ratio?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let imageBuffer: Buffer;
    let body: any = {};

    if (contentType.startsWith("image/")) {
      const ab = await request.arrayBuffer();
      imageBuffer = Buffer.from(ab);
    } else {
      body = await request.json();
      if (body?.image_url) {
        const resp = await fetch(body.image_url, { signal: AbortSignal.timeout(60000) });
        if (!resp.ok) {
          return NextResponse.json({ error: `Failed to fetch image: HTTP ${resp.status}` }, { status: 502 });
        }
        const ab = await resp.arrayBuffer();
        imageBuffer = Buffer.from(ab);
      } else if (body?.imageBase64) {
        const b64 = body.imageBase64.includes(",") ? body.imageBase64.split(",")[1] : body.imageBase64;
        imageBuffer = Buffer.from(b64, "base64");
      } else {
        return NextResponse.json(
          { error: "Body must contain image_url or imageBase64" },
          { status: 400 },
        );
      }
    }

    const meta = await sharp(imageBuffer).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < 64 || h < 64) {
      return new Response(imageBuffer, {
        status: 200,
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store", "X-Watermark-Removed": "false" },
      });
    }

    // Use Optix inpainting (auto-detects watermark strokes, no ratio needed)
    const cleaned = await inpaintWatermarkOptix(imageBuffer, {
      xmin: 870, ymin: 940, xmax: 970, ymax: 980,
    });

    return new Response(cleaned, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(cleaned.byteLength),
        "Cache-Control": "no-store",
        "X-Watermark-Removed": "true",
        "X-Method": "optix-inpainting",
      },
    });
  } catch (error: any) {
    console.error("[watermark] error:", error);
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ service: "optix-inpainting", method: "fast-marching-radial" });
}
