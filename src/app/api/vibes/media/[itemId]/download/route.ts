import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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

export async function GET(request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { itemId } = await params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") ?? "video";

    let buffer: ArrayBuffer;
    let contentType: string;
    if (type === "image") {
      contentType = "image/png";
      try {
        buffer = await client.downloadImage(itemId);
      } catch (dlError: any) {
        const fallbackBuffer = await fetchContentUrl(client, itemId, "image");
        if (fallbackBuffer) {
          buffer = fallbackBuffer;
        } else {
          throw dlError;
        }
      }
    } else {
      contentType = "video/mp4";
      try {
        buffer = await client.downloadVideo(itemId);
      } catch (dlError: any) {
        const fallbackBuffer = await fetchContentUrl(client, itemId, "video");
        if (fallbackBuffer) {
          buffer = fallbackBuffer;
        } else {
          throw dlError;
        }
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

async function fetchContentUrl(
  client: ReturnType<typeof getVibesClient>,
  contentId: string,
  type: "video" | "image",
): Promise<ArrayBuffer | null> {
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
    const resp = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!resp.ok) return null;
    return resp.arrayBuffer();
  } catch {
    return null;
  }
}
