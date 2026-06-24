import { db } from "@/db";
import { clients } from "@/db/schema";
import { error, requireApiOperator, success } from "@/lib/api";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// GET /api/operator/clients/[id] — the brand's configured kit the operator theme
// builder needs to author a bespoke theme from the brand's CORPORATE identity:
// its brand_* palette colours and its logo. Operator-gated. The bespoke AI prompt
// embeds these so a Premium brand's bespoke landing + matching email use the REAL
// corporate colours, and the new theme's seeds default to them — falling back to
// the theme's own seeds only when the brand has no defined palette.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;
    const brand = await db.query.clients.findFirst({
      where: eq(clients.id, id),
      columns: {
        id: true,
        name: true,
        brand_primary_color: true,
        brand_secondary_color: true,
        brand_accent_color: true,
        brand_text_color: true,
        branding_logo_url: true,
        logo_background: true,
        logo_position: true,
      },
    });
    if (!brand) return error("Brand not found", 404);
    return success(brand);
  } catch (err) {
    console.error("GET /api/operator/clients/[id] error:", err);
    return error("Internal server error", 500);
  }
}
