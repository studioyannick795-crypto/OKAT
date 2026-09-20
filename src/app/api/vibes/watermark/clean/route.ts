import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { inpaintWatermarkOptix } from "@/lib/optix-inpaint";
import { stampLogo } from "@/lib/logo-stamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const REMOVE_API = "https://remove-ai.space-z.ai/api/remove-watermark";

/**
 * POST /api/vibes/watermark/clean
 *
 * 1. Optix inpainting (removes watermark, auto-detects ratio)
 * 2. Stamp Nelth-IA logo (auto-detects ratio for correct zone)
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

    // Step 1: Optix inpainting (auto-detects ratio)
    let cleaned = await inpaintWatermarkOptix(imageBuffer);

    // Step 2: Stamp the Nelth-IA logo (auto-detects ratio from dimensions)
    try {
      cleaned = await stampLogo(cleaned);
    } catch (e: any) {
      console.error("[watermark] logo stamp failed:", e?.message);
    }

    return new Response(cleaned, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(cleaned.byteLength),
        "Cache-Control": "no-store",
        "X-Watermark-Removed": "true",
        "X-Method": "optix-inpainting + logo",
      },
    });
  } catch (error: any) {
    console.error("[watermark] error:", error);
    return NextResponse.json({ error: error?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ service: "optix-inpainting + logo", method: "fast-marching-radial" });
}
