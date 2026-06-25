import { NextRequest, NextResponse } from "next/server";
import { activeOrgIdsForClose, runOverdueSweep } from "@/lib/billing";
import { findAndPurgeExpiredCandidates } from "@/lib/popia";
import { previousPeriodLabel } from "@/lib/pricing";
import { getQueue } from "@/lib/queue";
import { runSpendAlertSweep } from "@/lib/spend-alerts";

// Monthly billing tick (usage-based pricing, Phase 6). Secret-gated exactly like
// /api/jobs/process; fired by an external cron (e.g. `0 2 1 * *`). It enqueues an
// org-scoped billing-close job per active org for the just-ended period (the
// per-org work runs in the worker, off the request path), then runs the overdue
// + spend-alert sweeps and the POPIA expired-data purge — the cron that finally
// closes the popia.ts TODO. Idempotent: closes dedup per (org, period) and the
// close itself is a no-op once an invoice exists.

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-worker-secret");
  if (process.env.WORKER_SECRET && secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Default to the just-ended calendar month; allow ?period=YYYY-MM for backfill.
  const requested = request.nextUrl.searchParams.get("period");
  if (requested && !PERIOD_RE.test(requested)) {
    return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  }
  const period = requested ?? previousPeriodLabel(now);

  try {
    const orgIds = await activeOrgIdsForClose();
    const queue = getQueue();
    await Promise.all(
      orgIds.map((orgId) =>
        queue.enqueue(
          { type: "billing-close", orgId, period },
          { orgId, deduplicationId: `billing-close-${period}` },
        ),
      ),
    );

    const overdue = await runOverdueSweep(now);
    const alerts = await runSpendAlertSweep(now);
    const purge = await findAndPurgeExpiredCandidates(null);

    return NextResponse.json({
      data: {
        period,
        closesEnqueued: orgIds.length,
        overdue,
        alerts,
        purged: purge.purged,
      },
    });
  } catch (err) {
    console.error("POST /api/jobs/billing-close error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
