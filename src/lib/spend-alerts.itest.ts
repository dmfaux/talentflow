import { beforeAll, describe, expect, it, vi } from "vitest";

// Email is mocked so the sweep "sends" without a transport and we can count fires.
const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn(async () => "msg-id") }));
vi.mock("@/lib/email", () => ({
  sendTransactionalEmail: sendMock,
  spendAlertEmail: () => "<html></html>",
}));

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  organizations,
  plans,
  spendAlertSubscriptions,
  usageEvents,
  users,
} from "@/db/schema";
import { periodLabel } from "@/lib/pricing";
import { runSpendAlertSweep } from "@/lib/spend-alerts";
import { GET as unsubscribe } from "@/app/api/spend-alert/unsubscribe/route";

const RUN = !!process.env.DATABASE_URL;
const TOKEN = "spend-alert-token-known";
const NOW = new Date();

const fx = { org: "", user: "", sub: "" };

async function reload() {
  return db.query.spendAlertSubscriptions.findFirst({
    where: eq(spendAlertSubscriptions.id, fx.sub),
  });
}

describe.skipIf(!RUN)("spend-alert sweep + unsubscribe (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(organizations); // cascades users + subscriptions + usage_events
    await db.delete(plans);
    await db.insert(plans).values({
      tier: "standard",
      base_fee_zar: 7500,
      included_credits: 6000,
      overage_discount_pct: 0,
    });

    fx.org = (
      await db.insert(organizations).values({ slug: "alert-org", name: "Alert Org" }).returning({ id: organizations.id })
    )[0].id;
    fx.user = (
      await db
        .insert(users)
        .values({
          org_id: fx.org,
          org_role: "owner",
          first_name: "Owen",
          last_name: "Owner",
          email: "owner@alert-org.test",
          password_hash: "x",
        })
        .returning({ id: users.id })
    )[0].id;
    fx.sub = (
      await db
        .insert(spendAlertSubscriptions)
        .values({
          user_id: fx.user,
          org_id: fx.org,
          alert_on_threshold: true,
          threshold_pct: 50,
          alert_on_hardcap: false,
          alert_on_summary: false,
          enabled: true,
          unsubscribe_token: TOKEN,
        })
        .returning({ id: spendAlertSubscriptions.id })
    )[0].id;

    // 4000 professional credits this month = 66% of the 6000 allowance (> 50%).
    await db.insert(usageEvents).values({
      org_id: fx.org,
      kind: "ai_tokens",
      model: "claude-sonnet-4-6",
      model_tier: "professional",
      input_tokens: 4_000_000,
      output_tokens: 0,
      created_at: NOW,
    });
  });

  it("fires the threshold alert once per period", async () => {
    sendMock.mockClear();
    const first = await runSpendAlertSweep(NOW);
    expect(first.escalationSent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const sub = await reload();
    expect(sub?.last_alerted_period).toBe(periodLabel(NOW));

    // Same period again → guarded, no re-fire.
    sendMock.mockClear();
    const second = await runSpendAlertSweep(NOW);
    expect(second.escalationSent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("unsubscribe disables the row; the sweep then skips it", async () => {
    const res = await unsubscribe(
      new NextRequest(`http://localhost/api/spend-alert/unsubscribe?token=${TOKEN}`),
    );
    expect(res.status).toBe(200);
    expect((await reload())?.enabled).toBe(false);

    // Clear the once-per-period guard so the ONLY reason not to fire is disabled.
    await db
      .update(spendAlertSubscriptions)
      .set({ last_alerted_period: null })
      .where(eq(spendAlertSubscriptions.id, fx.sub));

    sendMock.mockClear();
    const result = await runSpendAlertSweep(NOW);
    expect(result.evaluated).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("unsubscribe with an unknown token is a graceful no-op", async () => {
    const res = await unsubscribe(
      new NextRequest("http://localhost/api/spend-alert/unsubscribe?token=does-not-exist"),
    );
    expect(res.status).toBe(200);
    // The known row is untouched (still disabled from the previous test).
    expect((await reload())?.enabled).toBe(false);
  });
});
