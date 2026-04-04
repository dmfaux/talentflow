import { error, requireApiAuth, success } from "@/lib/api";
import { handleDataDeletionRequest } from "@/lib/popia";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return error("A valid email address is required");
    }

    const result = await handleDataDeletionRequest(email);

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
