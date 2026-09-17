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
 * GET /api/vibes/projects?limit=&offset=&sort=&search=
 * List projects.
 */
export async function GET(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 25);
    const offset = Number(searchParams.get("offset") ?? 0);
    const sort = searchParams.get("sort") ?? "newest";
    const search = searchParams.get("search") ?? undefined;
    const result = await client.listProjects({ limit, offset, sort, search });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}

/**
 * POST /api/vibes/projects
 * Body: { name?: string, composition?: any }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();
    const name = body?.name ?? "Untitled";
    const composition = body?.composition;
    const result = await client.createProject({ name, composition });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
