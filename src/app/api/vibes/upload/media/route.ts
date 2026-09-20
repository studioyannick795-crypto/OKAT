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
 * Accepts JSON: { image_base64, filename, project_id }
 *
 * 1. Compress image to JPEG (reduces base64 size for Vercel)
 * 2. Upload to vibes.ai via client.uploadImage()
 * 3. Register in project
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

    // Compress to JPEG to reduce base64 size (avoids Vercel 4.5MB body limit)
    try {
      buffer = await sharp(buffer)
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch {
      // If compression fails, use original
    }

    // Upload to vibes.ai
    const b64 = buffer.toString("base64");
    const uploadResp = await client.uploadImage(b64);

    if (!uploadResp?.mediaEntId) {
      return NextResponse.json(
        { error: "Upload did not return a mediaEntId" },
        { status: 500 },
      );
    }

    // Register in project
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
    });
  } catch (error: any) {
    console.error("[upload] error:", error);
    return NextResponse.json(
      { error: error?.message ?? "Unknown error" },
      { status: error?.status ?? 500 },
    );
  }
}
