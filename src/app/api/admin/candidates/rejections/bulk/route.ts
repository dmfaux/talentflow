import { db } from "@/db";
import { candidates } from "@/db/schema";
import { authorizeApiBrand, error, getApiTenant, success } from "@/lib/api";
import { orgScope } from "@/lib/tenant";
import { acceptRejection, dismissRejection } from "@/lib/rejection";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Bulk human-in-the-loop rejection decisions. Each candidate is authorised and
// transitioned independently — a row that's missing, on a brand the caller
// can't manage, or no longer in pending_rejection is SKIPPED (not a batch
// failure). Every accepted/dismissed row still writes its own audit entry. No
// per-row reason on bulk (by design); accepts never notify the candidate here.
//
// POST body: { ids: string[], decision: "accept" | "dismiss" }
const MAX_BULK = 200;

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const body = await request.json();
    const decision = body.decision;
    if (decision !== "accept" && decision !== "dismiss") {
      return error("decision must be 'accept' or 'dismiss'", 400);
    }
    const ids: unknown = body.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return error("ids must be a non-empty array", 400);
    }
    if (ids.length > MAX_BULK) {
      return error(`Cannot action more than ${MAX_BULK} candidates at once`, 400);
    }
    // De-dupe and keep only strings.
    const uniqueIds = [...new Set(ids.filter((x): x is string => typeof x === "string"))];

    const actioned: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const id of uniqueIds) {
      const existing = await db.query.candidates.findFirst({
        where: and(eq(candidates.id, id), orgScope(candidates, ctx)),
        with: { campaign: { columns: { client_id: true } } },
      });
      if (!existing) {
        skipped.push({ id, reason: "not_found" });
        continue;
      }

      const denied = await authorizeApiBrand(
        ctx,
        existing.campaign.client_id,
        "recruiter"
      );
      if (denied) {
        skipped.push({ id, reason: "forbidden" });
        continue;
      }

      if (existing.status !== "pending_rejection") {
        skipped.push({ id, reason: "not_pending" });
        continue;
      }

      const candidate = {
        id: existing.id,
        org_id: existing.org_id,
        status: existing.status,
        rejection_reason: existing.rejection_reason,
        ai_score: existing.ai_score,
        ai_rationale: existing.ai_rationale,
      };

      const result =
        decision === "accept"
          ? await acceptRejection({ candidate, actorUserId: ctx.userId })
          : await dismissRejection({ candidate, actorUserId: ctx.userId });

      if (result.ok) {
        actioned.push(id);
      } else {
        skipped.push({ id, reason: "already_actioned" });
      }
    }

    return success({ decision, actioned, skipped });
  } catch (err) {
    console.error("POST /api/admin/candidates/rejections/bulk error:", err);
    return error("Internal server error", 500);
  }
}
