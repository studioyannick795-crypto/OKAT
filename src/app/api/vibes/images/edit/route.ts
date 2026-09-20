import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function notConfigured() {
  return NextResponse.json(
    { error: "VIBES_META_SESSION env var not set." },
    { status: 500 },
  );
}

function handleError(error: any) {
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

/**
 * Remove the Meta AI watermark from an image buffer using content-aware fill.
 * The watermark is in the bottom-right corner (sparkle + "Meta AI" text).
 *
 * Strategy: extract the watermark zone, sample pixels from above, blur,
 * and composite back with feathered edges.
 */
async function removeWatermarkLocal(imageBuffer: Buffer): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 64 || h < 64) return imageBuffer;

  // Meta AI watermark zone (bottom-right, covers sparkle + text + halo)
  const zone = { xmin: 0.70, ymin: 0.85, xmax: 1.0, ymax: 1.0 };
  const wmX = Math.round(zone.xmin * w);
  const wmY = Math.round(zone.ymin * h);
  const wmW = Math.min(w - wmX, Math.round((zone.xmax - zone.xmin) * w));
  const wmH = Math.min(h - wmY, Math.round((zone.ymax - zone.ymin) * h));

  // Sample pixels from above the watermark
  const bandH = Math.min(wmH, wmY);
  const bandY = Math.max(0, wmY - bandH);
  const bandX = Math.max(0, wmX - Math.round(wmW * 0.1));
  const bandW = Math.min(w - bandX, wmW + Math.round(wmW * 0.2));

  try {
    const fillPatch = await sharp(imageBuffer)
      .extract({ left: bandX, top: bandY, width: bandW, height: bandH })
      .blur(25)
      .resize(wmW, wmH, { fit: "fill" })
      .blur(12)
      .ensureAlpha()
      .png()
      .toBuffer();

    // Feathered mask for smooth edges
    const inset = Math.max(6, Math.round(Math.min(wmW, wmH) * 0.08));
    const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wmW}" height="${wmH}" viewBox="0 0 ${wmW} ${wmH}">
  <rect x="${inset}" y="${inset}" width="${wmW - inset * 2}" height="${wmH - inset * 2}" fill="#ffffff" rx="${inset * 2}" ry="${inset * 2}"/>
</svg>`;
    const maskBuf = await sharp(Buffer.from(maskSvg))
      .blur(Math.max(20, Math.round(Math.min(wmW, wmH) * 0.25)))
      .png()
      .toBuffer();

    const featheredPatch = await sharp(fillPatch)
      .composite([{ input: maskBuf, blend: "dest-in" }])
      .png()
      .toBuffer();

    return sharp(imageBuffer)
      .composite([{ input: featheredPatch, top: wmY, left: wmX, blend: "over" }])
      .toFormat(meta.format ?? "png", { quality: 95 })
      .toBuffer();
  } catch {
    return imageBuffer;
  }
}

/**
 * POST /api/vibes/images/edit
 *
 * Body: { source_image_ent_id, edit_prompt, project_id?, aspect_ratio? }
 *
 * 1. Edit the image via vibes.ai /api/generate/image-edit
 * 2. Remove the Meta AI watermark locally (content-aware fill, no ratio needed)
 * 3. Return the cleaned image as base64 data URL
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.source_image_ent_id || !body?.edit_prompt) {
      return NextResponse.json(
        { error: "Fields `source_image_ent_id` and `edit_prompt` are required." },
        { status: 400 },
      );
    }

    // Step 1: Edit the image
    const result = await client.editImage({
      sourceImageEntId: body.source_image_ent_id,
      editPrompt: body.edit_prompt,
      projectId: body.project_id,
    });

    // Step 2: Remove the Meta AI watermark locally
    if (result?.success !== false && result?.contentItem?.imageUrl) {
      try {
        const imgResp = await fetch(result.contentItem.imageUrl, {
          signal: AbortSignal.timeout(60000),
        });
        if (imgResp.ok) {
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
          const cleaned = await removeWatermarkLocal(imgBuffer);

          // Return as base64 data URL
          const b64 = cleaned.toString("base64");
          result.contentItem.imageUrl = `data:image/png;base64,${b64}`;
          result.contentItem.watermarkRemoved = true;
        }
      } catch (wmErr: any) {
        console.error("[edit] watermark removal failed:", wmErr?.message);
      }
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
