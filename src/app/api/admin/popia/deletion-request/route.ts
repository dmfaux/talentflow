import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { handleDataDeletionRequest } from "@/lib/popia";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Tenant deletion-by-email is org_admin+ and scoped to the actor's org.
  const denied = authorizeApiOrg(ctx, "run_popia_purge");
  if (denied) return denied;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return error("A valid email address is required");
    }

    const result = await handleDataDeletionRequest(email, ctx.effectiveOrgId);

    return success({
      ...result,
      message: result.purged > 0
        ? `Successfully purged ${result.purged} record(s) for ${email}`
        : `No unpurged records found for ${email}`,
    });
  } catch (err) {
    console.error("POST /api/admin/popia/deletion-request error:", err);
    return error("Internal server error", 500);
  }
}
