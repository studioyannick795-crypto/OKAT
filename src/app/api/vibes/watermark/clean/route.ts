import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { removeWatermarks } from "@/lib/watermarkPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/vibes/watermark/clean
 *
 * 100% LOCAL backend (no external API call).
 * Uses the remove-ai backend code (watermarkPipeline.ts) directly.
 *
 * Body: { image_url: string, ratio: string }
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

    const ratio = body.ratio || "1:1";

    const result = await removeWatermarks(imageBuffer, {
      ratio,
      exportFormat: "png",
      maskConfig: {
        thresholdMode: "otsu",
        sensitivity: 75,
        dilationRadius: 2,
        invertMask: false,
      },
      inpaintConfig: {
        algorithm: "telea",
        radius: 5,
      },
    });

    return new Response(result.imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(result.imageBuffer.byteLength),
        "Cache-Control": "no-store",
        "X-Watermark-Removed": "true",
        "X-Method": "local-backend",
        "X-Ratio": ratio,
        "X-Detection-Source": result.metrics.detectionSource,
        "X-Inpaint-Engine": result.metrics.engineUsed,
        "X-Inpaint-Time-Ms": String(result.metrics.totalTimeMs),
        "X-Pixels-Inpainted": String(result.metrics.pixelsInpainted),
      },
    });
  } catch (error: any) {
    console.error("[watermark] error:", error);
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ service: "local-backend", method: "watermarkPipeline" });
}
