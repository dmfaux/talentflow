import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { spendAlertSubscriptions } from "@/db/schema";

// Public one-click unsubscribe (usage-based pricing, Phase 5). Token-only, no
// session — mirrors the password-reset confirm pattern. Idempotent: an unknown or
// missing token still returns the same friendly page (never leaks whether a token
// exists), and disabling an already-disabled subscription is a no-op.

const PAGE = (msg: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spend alerts</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#faf8f5;color:#2b2b2b;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{max-width:420px;padding:2.5rem;background:#fff;border:1px solid #ece7df;border-radius:16px;text-align:center}
  h1{font-size:1.15rem;margin:0 0 .5rem}
  p{font-size:.9rem;color:#6b6b6b;margin:0}
</style></head>
<body><div class="card"><h1>Unsubscribed</h1><p>${msg}</p></div></body></html>`;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (token) {
    try {
      await db
        .update(spendAlertSubscriptions)
        .set({ enabled: false, updated_at: new Date() })
        .where(eq(spendAlertSubscriptions.unsubscribe_token, token));
    } catch (err) {
      console.error("GET /api/spend-alert/unsubscribe error:", err);
    }
  }
  return new NextResponse(
    PAGE("You won&rsquo;t receive any more spend alerts. Manage alerts anytime in Settings."),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
