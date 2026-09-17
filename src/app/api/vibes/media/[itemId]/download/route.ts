import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";
import {
  removeMetaWatermark,
  hasWatermarkModel,
} from "@/lib/watermark/remove";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Increase the max execution time for this route — MI-GAN inference can take
// a few seconds on the first call while the model warms up.
export const maxDuration = 120;

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

interface Params {
  params: Promise<{ itemId: string }>;
}

/**
 * GET /api/vibes/media/[itemId]/download?type=video|image
 *
 * Returns the binary content with the appropriate content-type.
 * Defaults to `video` (MP4). Use `?type=image` for PNG.
 *
 * Query params:
 *   - type:  "video" (default) or "image"
 *   - clean: "1" or "true" to remove the Meta AI watermark from images
 *            (MI-GAN inpainting, server-side). Videos are returned as-is.
 *            When clean=true and the type is image, the watermark in the
 *            bottom-right corner is automatically inpainted before sending.
 *
 * If the direct download endpoint returns 404 (which happens when the
 * batch is not yet marked isComplete=true on the server), this route
 * falls back to fetching the batch and using the videoUrl / imageUrl
 * directly from the content item.
 */
export async function GET(request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { itemId } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "video";
    const clean =
      searchParams.get("clean") === "1" ||
      searchParams.get("clean") === "true";

    let buffer: ArrayBuffer;
    let contentType: string;
    if (type === "image") {
      contentType = "image/png";
      try {
        buffer = await client.downloadImage(itemId);
      } catch (dlError: any) {
        // Fallback: fetch the batch and use the imageUrl directly
        const fallbackBuffer = await fetchContentUrl(client, itemId, "image");
        if (fallbackBuffer) {
          buffer = fallbackBuffer;
        } else {
          throw dlError;
        }
      }

      // Remove the Meta AI watermark if requested (images only)
      if (clean && hasWatermarkModel()) {
        try {
          const cleaned = await removeMetaWatermark(buffer);
          buffer = cleaned.buffer.slice(
            cleaned.byteOffset,
            cleaned.byteOffset + cleaned.byteLength,
          );
        } catch (wmError: any) {
          // If watermark removal fails, return the original image
          console.error("[watermark] removal failed:", wmError?.message);
        }
      }
    } else {
      contentType = "video/mp4";
      try {
        buffer = await client.downloadVideo(itemId);
      } catch (dlError: any) {
        // Fallback: fetch the batch and use the videoUrl directly
        const fallbackBuffer = await fetchContentUrl(client, itemId, "video");
        if (fallbackBuffer) {
          buffer = fallbackBuffer;
        } else {
          throw dlError;
        }
      }

      // Remove the Meta AI watermark from video poster frames if requested
      // (we only clean images — video frame inpainting would require decoding
      // every frame, which is too slow. The video poster/thumbnail is cleaned
      // in the media card display instead.)
      if (clean && hasWatermarkModel()) {
        // For videos, we return the video as-is. The dashboard displays
        // cleaned image thumbnails separately.
      }
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return handleError(error);
  }
}

/**
 * Fallback: find the content item's URL by listing recent batches,
 * then download the binary directly from the CDN URL.
 */
async function fetchContentUrl(
  client: ReturnType<typeof getVibesClient>,
  contentId: string,
  type: "video" | "image",
): Promise<ArrayBuffer | null> {
  // The content ID format is: batch-{uuid}-content-{n}
  // Extract the batch ID by removing the -content-{n} suffix
  const m = contentId.match(/^(.+)-content-\d+$/);
  if (!m) return null;
  const batchId = m[1];
  try {
    const batch = await client.getBatch(batchId);
    const content = batch.content ?? [];
    const item = content.find((c: any) => c.id === contentId);
    if (!item) return null;
    const url = type === "video" ? item.videoUrl : item.imageUrl;
    if (!url) return null;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) return null;
    return resp.arrayBuffer();
  } catch {
    return null;
  }
}
