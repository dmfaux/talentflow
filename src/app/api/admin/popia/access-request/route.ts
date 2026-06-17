import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { handleDataAccessRequest } from "@/lib/popia";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Subject-access returns full candidate PII across the org by email, so it
  // is org_admin+ (Resolved Decision 3) and scoped to the actor's org.
  const denied = authorizeApiOrg(ctx, "run_popia_purge");
  if (denied) return denied;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return error("A valid email address is required");
    }

    const data = await handleDataAccessRequest(email, ctx.effectiveOrgId);

    if (!data) {
      return error("No records found for this email", 404);
    }

    return success(data);
  } catch (err) {
    console.error("POST /api/admin/popia/access-request error:", err);
    return error("Internal server error", 500);
  }
}
