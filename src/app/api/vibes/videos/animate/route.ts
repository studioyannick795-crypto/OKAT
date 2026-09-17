import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 300;

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
 * POST /api/vibes/videos/animate
 *
 * Animate a still image into a video (image-to-video / i2v).
 *
 * Two ways to specify the source image:
 *
 * 1. Direct source image (for uploaded images):
 *    Body: { project_id, source_image: { id, imageUrl, prompt, mediaEntId }, prompt? }
 *    Use this when the image was just uploaded — bypasses batch fetch
 *    (uploaded batches use Firebase-style IDs that /api/generation-batches
 *    can't find, causing "Generation batch not found" errors).
 *
 * 2. Batch reference (for library images):
 *    Body: { project_id, batch_id, content_id?, prompt? }
 *    Fetches the batch to get the full source image content item.
 *
 * Optional:
 *   - prompt — manual animate directive; omit for auto animate
 *   - poll (default false) — wait for completion
 *   - poll_timeout (default 180s)
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.project_id) {
      return NextResponse.json(
        { error: "Field `project_id` is required." },
        { status: 400 },
      );
    }

    let sourceImage: any;

    if (body.source_image) {
      // Direct source image specification (from upload)
      // Construct the full source image object that animateImage needs
      const si = body.source_image;
      const mediaEntId = si.mediaEntId || si.imageEntId || "";
      sourceImage = {
        id: si.id || si.contentItemId || `upload-${mediaEntId}`,
        imageUrl: si.imageUrl || si.cdnUrl || "",
        prompt: si.prompt || si.filename || "Uploaded image",
        imagePrompt: si.prompt || si.filename || "Uploaded image",
        videoPrompt: si.prompt || si.filename || "Uploaded image",
        // data must be a JSON string containing imageEntId for extractImageEntId()
        data: JSON.stringify({ imageEntId: mediaEntId }),
        mediaEntId,
        imageHandle: si.imageHandle || mediaEntId || null,
        config: si.config || {},
        structuredOutput: si.structuredOutput || {},
      };
    } else if (body.batch_id) {
      // Fetch the batch to get the full source image content item (library images)
      const batch = await client.getBatch(body.batch_id);
      const content = batch.content ?? [];

      if (content.length === 0) {
        return NextResponse.json(
          { error: "No content items found in the specified batch." },
          { status: 404 },
        );
      }

      // Find the specific content item by ID, or use the first one
      if (body.content_id) {
        sourceImage = content.find((c: any) => c.id === body.content_id);
        if (!sourceImage) {
          return NextResponse.json(
            { error: `Content item ${body.content_id} not found in batch ${body.batch_id}.` },
            { status: 404 },
          );
        }
      } else {
        sourceImage = content[0];
      }
    } else {
      return NextResponse.json(
        { error: "Either `source_image` or `batch_id` is required." },
        { status: 400 },
      );
    }

    // Check the image has an imageUrl
    if (!sourceImage.imageUrl) {
      return NextResponse.json(
        { error: "The source image does not have an imageUrl. Cannot animate." },
        { status: 400 },
      );
    }

    // Call animateImage with the source image
    const result = await client.animateImage({
      projectId: body.project_id,
      sourceImage,
      prompt: body.prompt,
      poll: body.poll ?? false,
      pollTimeout: body.poll_timeout ?? 180,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
