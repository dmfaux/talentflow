import { error, getApiTenant, success } from "@/lib/api";
import { resolveOwnedResource } from "@/lib/tenant";
import { validateSlug, findAvailableCampaignSlug } from "@/lib/slug";
import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const slug = request.nextUrl.searchParams.get("slug");
  // When editing an existing campaign, the client passes its id here so its own
  // (unchanged) slug doesn't report as "taken" against itself.
  const excludeId = request.nextUrl.searchParams.get("exclude_id");
  // S8: the brand comes from the active-brand context, not a trusted query param.
  // An explicit client_id (edit mode, where the active brand may differ from the
  // campaign's brand) is honoured ONLY after an ownership check.
  const clientIdParam = request.nextUrl.searchParams.get("client_id");

  if (!slug) return error("slug parameter is required");

  let brandId: string | null;
  if (clientIdParam) {
    const brand = await resolveOwnedResource(clients, clientIdParam, ctx);
    if (!brand) return success({ available: false });
    brandId = brand.id;
  } else {
    brandId = ctx.activeBrandId;
  }
  if (!brandId) {
    return success({ available: false, error: "Select a brand first" });
  }

  const validation = validateSlug(slug);
  if (!validation.valid) {
    return success({ available: false, error: validation.error });
  }

  const existing = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.client_id, brandId), eq(campaigns.slug, slug)),
    columns: { id: true },
  });

  if (existing && existing.id !== excludeId) {
    const suggestion = await findAvailableCampaignSlug(brandId, slug);
    return success({ available: false, suggestion });
  }

  return success({ available: true });
}
