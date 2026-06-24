import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import {
  getCampaignSpend,
  getOrgCampaignBreakdown,
  getOrgSpend,
  getSpendProjection,
} from "@/lib/pricing";
import { resolveOwnedResource } from "@/lib/tenant";
import { campaigns } from "@/db/schema";
import { NextRequest } from "next/server";

const ALLOWED_DAYS = [7, 30, 90];

// Tenant Usage & Spend read. orgScope-isolated (inside the pricing helpers) and
// gated by the org_admin-floor `view_spend` action — never the operator raw-org-id
// path. Returns billed credits + ZAR only; never raw cost or margin.
export async function GET(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const forbidden = authorizeApiOrg(ctx, "view_spend");
  if (forbidden) return forbidden;

  try {
    const params = request.nextUrl.searchParams;
    const requested = Number(params.get("days"));
    const days = ALLOWED_DAYS.includes(requested) ? requested : 30;
    const campaignId = params.get("campaign_id");

    // Single-campaign view — ownership-checked (a cross-org id 404s).
    if (campaignId) {
      const owned = await resolveOwnedResource(campaigns, campaignId, ctx);
      if (!owned) return error("Campaign not found", 404);
      const spend = await getCampaignSpend(ctx, campaignId, days);
      return success({ spend });
    }

    const [spend, projection, campaignBreakdown] = await Promise.all([
      getOrgSpend(ctx, days),
      getSpendProjection(ctx),
      getOrgCampaignBreakdown(ctx, days),
    ]);
    return success({ spend, projection, campaigns: campaignBreakdown });
  } catch (err) {
    console.error("GET /api/admin/usage error:", err);
    return error("Internal server error", 500);
  }
}
