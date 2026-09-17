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

/**
 * GET /api/vibes/share-links?entity_type=&entity_id=
 * List all active share links for an entity.
 */
export async function GET(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entity_type") ?? "";
    const entityId = searchParams.get("entity_id") ?? "";
    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "Query params `entity_type` and `entity_id` are required." },
        { status: 400 },
      );
    }
    const shareLinks = await client.listShareLinks(entityType, entityId);
    return NextResponse.json({ shareLinks });
  } catch (error: any) {
    return handleError(error);
  }
}

/**
 * POST /api/vibes/share-links
 * Body: { entity_type, entity_id, expires_at?, max_uses? }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.entity_type || !body?.entity_id) {
      return NextResponse.json(
        { error: "Fields `entity_type` and `entity_id` are required." },
        { status: 400 },
      );
    }

    const result = await client.createShareLink({
      entityType: body.entity_type,
      entityId: body.entity_id,
      expiresAt: body.expires_at,
      maxUses: body.max_uses,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
