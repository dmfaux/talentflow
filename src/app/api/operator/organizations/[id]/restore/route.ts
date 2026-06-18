import { runOrgTransition } from "@/lib/operator-lifecycle";
import { NextRequest } from "next/server";

// POST /api/operator/organizations/[id]/restore — re-enable a tenant (from
// suspended OR soft-deleted). Clears both suspended_at and deleted_at.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return runOrgTransition(request, id, "restore");
}
