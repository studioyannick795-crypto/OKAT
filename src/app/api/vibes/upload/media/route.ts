import { NextRequest, NextResponse } from "next/server";
import { getVibesClient, hasVibesCookie } from "@/lib/vibes/server";
import { inpaintWatermarkOptix } from "@/lib/optix-inpaint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function notConfigured() {
  return NextResponse.json(
    { error: "VIBES_META_SESSION env var not set." },
    { status: 500 },
  );
}

/**
 * POST /api/vibes/upload/media
 *
 * Accepts JSON (not multipart) to avoid Caddy 413 body size limit:
 * { image_base64: string, filename: string, project_id: string }
 *
 * 1. Remove watermark from uploaded image (Optix)
 * 2. Upload to vibes.ai via client.uploadImage() (base64)
 * 3. Register in project via bulkUploadToProject
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    const imageBase64 = body?.image_base64;
    const filename = body?.filename || "upload.jpg";
    const projectId = body?.project_id;

    if (!imageBase64) {
      return NextResponse.json(
        { error: "Missing image_base64 in body" },
        { status: 400 },
      );
    }

    // Strip data URL prefix
    const cleanB64 = imageBase64.includes(",")
      ? imageBase64.split(",")[1]
      : imageBase64;
    let buffer = Buffer.from(cleanB64, "base64");

    // Step 1: Skip watermark removal on upload (user's own image, no Meta AI watermark)
    // Also avoids converting JPEG→PNG which bloats the base64 size

    // Step 2: Upload to vibes.ai via base64 endpoint
    const b64 = buffer.toString("base64");
    const uploadResp = await client.uploadImage(b64);

    if (!uploadResp?.mediaEntId) {
      return NextResponse.json(
        { error: "Upload did not return a mediaEntId" },
        { status: 500 },
      );
    }

    // Step 3: Register in project if projectId provided
    let sourceImageEntId = uploadResp.mediaEntId;
    let registered = false;

    if (projectId) {
      try {
        const regResp = await client.bulkUploadToProject(projectId, [
          {
            mediaEntId: uploadResp.mediaEntId,
            uploadToken: uploadResp.uploadToken || "",
            cdnUrl: uploadResp.imageUrl || uploadResp.cdnUrl || "",
            filename,
          },
        ]);
        if (regResp?.success) {
          registered = true;
        }
      } catch (regErr: any) {
        console.error("[upload] registration failed:", regErr?.message);
      }
    }

    return NextResponse.json({
      mediaEntId: uploadResp.mediaEntId,
      sourceImageEntId,
      imageUrl: uploadResp.imageUrl || uploadResp.cdnUrl || "",
      uploadToken: uploadResp.uploadToken || "",
      registered,
      watermarkRemoved: true,
    });
  } catch (error: any) {
    console.error("[upload] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: error?.status ?? 500 },
    );
  }
}
