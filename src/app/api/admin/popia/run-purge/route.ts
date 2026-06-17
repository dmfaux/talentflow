import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { findAndPurgeExpiredCandidates } from "@/lib/popia";

export async function POST() {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Tenant POPIA purge is org_admin+ and scoped to the actor's org. The
  // operator-wide cross-org purge is S11; here a non-acting operator
  // (effectiveOrgId null) purges nothing.
  const denied = authorizeApiOrg(ctx, "run_popia_purge");
  if (denied) return denied;

  try {
    const result = await findAndPurgeExpiredCandidates(ctx.effectiveOrgId);

    return success({
      ...result,
      message: result.purged > 0
        ? `Purged ${result.purged} expired record(s)`
        : "No expired records to purge",
    });
  } catch (err) {
    console.error("POST /api/admin/popia/run-purge error:", err);
    return error("Internal server error", 500);
  }
}
