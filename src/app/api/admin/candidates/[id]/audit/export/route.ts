import { db } from "@/db";
import { candidates } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant } from "@/lib/api";
import { getCandidateAuditTrail } from "@/lib/rejection";
import { orgScope } from "@/lib/tenant";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// POPIA compliance export: the full, append-only action trail for one candidate
// as CSV — who did what, when, and why (incl. the recruiter-add consent
// attestation). Recruiter+ on the candidate's brand; org-scoped.

function csvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Quote when the cell contains a comma, quote, or newline; escape quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = [
  "timestamp",
  "action",
  "from_status",
  "to_status",
  "actor_name",
  "actor_email",
  "reason",
  "reason_sent_to_candidate",
  "metadata",
];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    const candidate = await db.query.candidates.findFirst({
      where: and(eq(candidates.id, id), orgScope(candidates, ctx)),
      with: { campaign: { columns: { client_id: true } } },
    });
    if (!candidate) return error("Candidate not found", 404);

    const denied = await authorizeApiBrand(
      ctx,
      candidate.campaign.client_id,
      "recruiter"
    );
    if (denied) return denied;

    const trail = await getCandidateAuditTrail(id);
    const rows = trail.map((e) =>
      [
        e.created_at.toISOString(),
        e.action,
        e.from_status,
        e.to_status,
        e.actor_name,
        e.actor_email,
        e.reason,
        e.reason_sent_to_candidate,
        e.metadata,
      ]
        .map(csvCell)
        .join(",")
    );
    const csv = [HEADER.join(","), ...rows].join("\r\n");

    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="candidate-${id}-audit.csv"`,
      },
    });
  } catch (err) {
    console.error("GET /api/admin/candidates/[id]/audit/export error:", err);
    return error("Internal server error", 500);
  }
}
