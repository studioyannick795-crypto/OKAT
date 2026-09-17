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
 * GET /api/vibes/ingredients?owner_filter=LIBRARY&ingredient_type=
 * List studio ingredients.
 */
export async function GET(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const { searchParams } = new URL(request.url);
    const ownerFilter = searchParams.get("owner_filter") ?? "LIBRARY";
    const ingredientType = searchParams.get("ingredient_type") ?? undefined;
    const ingredients = await client.listIngredients({
      ownerFilter,
      ingredientType,
    });
    return NextResponse.json({ ingredients });
  } catch (error: any) {
    return handleError(error);
  }
}

/**
 * POST /api/vibes/ingredients
 * Body: { name, ingredient_type, source_image_ent_id?, image_url?, description? }
 */
export async function POST(request: NextRequest) {
  if (!hasVibesCookie()) return notConfigured();
  try {
    const client = getVibesClient();
    const body = await request.json();

    if (!body?.name || !body?.ingredient_type) {
      return NextResponse.json(
        { error: "Fields `name` and `ingredient_type` are required." },
        { status: 400 },
      );
    }

    const result = await client.createIngredient({
      name: body.name,
      ingredientType: body.ingredient_type,
      sourceImageEntId: body.source_image_ent_id,
      imageUrl: body.image_url,
      description: body.description,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return handleError(error);
  }
}
