import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";
import { inpaintWatermarkOptix } from "@/lib/optix-inpaint";

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
 * POST /api/vibes/images/edit
 *
 * 1. Edit image via vibes.ai /api/generate/image-edit
 * 2. Remove Meta AI watermark using Optix inpainting algorithm
 *    (Fast Marching Radial, adaptive stroke detection)
 *
 * Body: { source_image_ent_id, edit_prompt, project_id? }
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

    // Step 2: Remove the Meta AI watermark using Optix inpainting
    if (result?.success !== false && result?.contentItem?.imageUrl) {
      try {
        const imgResp = await fetch(result.contentItem.imageUrl, {
          signal: AbortSignal.timeout(60000),
        });
        if (imgResp.ok) {
          const imgBuffer = Buffer.from(await imgResp.arrayBuffer());

          // Use the Optix inpainting algorithm (no ratio needed — auto-detects watermark)
          const cleaned = await inpaintWatermarkOptix(imgBuffer, {
            // Bottom-right watermark zone (covers sparkle + text)
            xmin: 870, ymin: 940, xmax: 970, ymax: 980,
          });

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
