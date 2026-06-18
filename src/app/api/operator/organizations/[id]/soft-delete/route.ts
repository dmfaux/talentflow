import { runOrgTransition } from "@/lib/operator-lifecycle";
import { NextRequest } from "next/server";

// POST /api/operator/organizations/[id]/soft-delete — mark a tenant deleted
// (from active OR suspended). Reversible via restore until the hard purge.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return runOrgTransition(request, id, "soft_delete");
}
