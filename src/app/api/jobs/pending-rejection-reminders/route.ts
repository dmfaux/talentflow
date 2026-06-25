import { NextRequest, NextResponse } from "next/server";
import { runPendingRejectionReminderSweep } from "@/lib/pending-rejection-reminders";

// Stale pending-rejection reminder tick. Secret-gated exactly like
// /api/jobs/billing-close and /api/jobs/process; fired by an external cron
// (e.g. daily `0 8 * * *`). Reminds a brand's recruiters/admins about candidates
// recommended for rejection that are still waiting on a human decision — first
// after a few days, then weekly. Idempotent within each window.
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-worker-secret");
  if (process.env.WORKER_SECRET && secret !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runPendingRejectionReminderSweep();
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error("POST /api/jobs/pending-rejection-reminders error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
