import { error, requireApiAuth, success } from "@/lib/api";
import { findAndPurgeExpiredCandidates } from "@/lib/popia";

export async function POST() {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const result = await findAndPurgeExpiredCandidates();

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
