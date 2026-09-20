import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
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

/**
 * POST /api/vibes/upload/media
 *
 * Accepts JSON (from frontend): { image_base64, filename, project_id }
 * Sends multipart to vibes.ai (backend → vibes.ai, no size limit)
 *
 * 1. Compress image to JPEG
 * 2. Upload via /api/upload-media (multipart — returns uploadToken!)
 * 3. Register in project via bulkUploadToProject (needs uploadToken)
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

    // Compress to JPEG (reduces size)
    try {
      buffer = await sharp(buffer)
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch {
      // If compression fails, use original
    }

    // Upload via /api/upload-media (multipart) — returns uploadToken!
    const formData = new FormData();
    const blob = new Blob([buffer], { type: "image/jpeg" });
    formData.append("file", blob, filename);

    const uploadResp = await client.uploadMedia(formData as any);

    if (!uploadResp?.mediaEntId) {
      return NextResponse.json(
        { error: "Upload did not return a mediaEntId" },
        { status: 500 },
      );
    }

    // Register in project (needs uploadToken from upload-media)
    let sourceImageEntId = uploadResp.mediaEntId;
    let registered = false;

    if (projectId) {
      try {
        const regResp = await client.bulkUploadToProject(projectId, [
          {
            mediaEntId: uploadResp.mediaEntId,
            uploadToken: uploadResp.uploadToken || "",
            cdnUrl: uploadResp.cdnUrl || uploadResp.imageUrl || "",
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
      imageUrl: uploadResp.cdnUrl || uploadResp.imageUrl || "",
      uploadToken: uploadResp.uploadToken || "",
      registered,
    });
  } catch (error: any) {
    console.error("[upload] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: error?.status ?? 500 },
    );
  }
}
