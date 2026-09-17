import { NextRequest, NextResponse } from "next/server";
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

interface Params {
  params: Promise<{ pid: string }>;
}

/**
 * GET /api/vibes/projects/[pid]
 */
export async function GET(_request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { pid } = await params;
    return NextResponse.json(await client.getProject(pid));
  } catch (error: any) {
    return handleError(error);
  }
}

/**
 * PUT /api/vibes/projects/[pid]
 * Body: { name?: string, composition?: any }
 */
export async function PUT(request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { pid } = await params;
    const body = await request.json();
    const result = await client.updateProject(pid, {
      name: body?.name,
      composition: body?.composition,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}

/**
 * DELETE /api/vibes/projects/[pid]?deleteAssets=true
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { pid } = await params;
    const { searchParams } = new URL(request.url);
    const deleteAssets = searchParams.get("deleteAssets") === "true";
    await client.deleteProject(pid, deleteAssets);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleError(error);
  }
}
