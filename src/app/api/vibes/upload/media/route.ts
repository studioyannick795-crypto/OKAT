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

/**
 * POST /api/vibes/upload/media
 *
 * Multipart form: file + filename + project_id
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const filename = formData.get("filename") as string | null;
    const projectId = formData.get("project_id") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Missing 'file' in form data" },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const vibesForm = new FormData();
    const blob = new Blob([buffer], { type: file.type });
    vibesForm.append("file", blob, filename || file.name || "upload.jpg");

    const uploadResp = await client.uploadMedia(vibesForm as any);

    if (!uploadResp?.mediaEntId) {
      return NextResponse.json(
        { error: "Upload did not return a mediaEntId" },
        { status: 500 },
      );
    }

    let sourceImageEntId = uploadResp.mediaEntId;
    let registered = false;

    if (projectId) {
      try {
        const regResp = await client.bulkUploadToProject(projectId, [
          {
            mediaEntId: uploadResp.mediaEntId,
            uploadToken: uploadResp.uploadToken,
            cdnUrl: uploadResp.cdnUrl || uploadResp.imageUrl,
            filename: filename || file.name || "upload.jpg",
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
      uploadToken: uploadResp.uploadToken,
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
