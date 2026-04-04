import { error, requireApiAuth, success } from "@/lib/api";
import { handleDataAccessRequest } from "@/lib/popia";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return error("A valid email address is required");
    }

    const data = await handleDataAccessRequest(email);

    if (!data) {
      return error("No records found for this email", 404);
    }

    return success(data);
  } catch (err) {
    console.error("POST /api/admin/popia/access-request error:", err);
    return error("Internal server error", 500);
  }
}
