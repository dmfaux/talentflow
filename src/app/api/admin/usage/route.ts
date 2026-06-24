import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { getOrgSpend } from "@/lib/pricing";
import { NextRequest } from "next/server";

const ALLOWED_DAYS = [7, 30, 90];

// Tenant Usage & Spend read. orgScope-isolated (inside getOrgSpend) and gated by
// the org_admin-floor `view_spend` action — never the operator raw-org-id path.
export async function GET(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const forbidden = authorizeApiOrg(ctx, "view_spend");
  if (forbidden) return forbidden;

  try {
    const requested = Number(request.nextUrl.searchParams.get("days"));
    const days = ALLOWED_DAYS.includes(requested) ? requested : 30;
    const spend = await getOrgSpend(ctx, days);
    return success(spend);
  } catch (err) {
    console.error("GET /api/admin/usage error:", err);
    return error("Internal server error", 500);
  }
}
