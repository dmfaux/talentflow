import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  plans,
  spendAlertSubscriptions,
  users,
} from "@/db/schema";
import { sendTransactionalEmail, spendAlertEmail } from "@/lib/email";
import { appHostOrigin } from "@/lib/host";
import {
  CREDIT_PRICE_ZAR,
  VAT_RATE,
  creditsForOrgSince,
  periodLabel,
} from "@/lib/pricing";
import { getCeilingStatus } from "@/lib/spend-ceiling";

// ── Spend-alert sweep (usage-based pricing, Phase 5) ─────────────────
//
// Driven by the scheduled billing-close tick (src/app/api/jobs/billing-close).
// For each enabled subscription it sends at most ONE escalation email per period
// (threshold or, more urgently, hard-cap — guarded by last_alerted_period) plus a
// cadence-driven summary (guarded by last_summary_sent_at). Org spend is computed
// live (MTD) and cached per org so multiple subscribers don't re-query. The guard
// is advanced only on a successful send, so a transient mail failure simply
// retries on the next tick.

export interface SpendAlertSweepResult {
  evaluated: number;
  escalationSent: number; // threshold or hard-cap
  summarySent: number;
}

const unsubscribeUrl = (token: string) =>
  `${appHostOrigin()}/api/spend-alert/unsubscribe?token=${encodeURIComponent(token)}`;
const usageUrl = () => `${appHostOrigin()}/usage`;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function runSpendAlertSweep(
  now: Date = new Date(),
): Promise<SpendAlertSweepResult> {
  const period = periodLabel(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const subs = await db
    .select({
      sub: spendAlertSubscriptions,
      userEmail: users.email,
      orgName: organizations.name,
      orgTier: organizations.tier,
    })
    .from(spendAlertSubscriptions)
    .innerJoin(users, eq(spendAlertSubscriptions.user_id, users.id))
    .innerJoin(
      organizations,
      eq(spendAlertSubscriptions.org_id, organizations.id),
    )
    .where(eq(spendAlertSubscriptions.enabled, true));

  // Plan allowance by org tier — small reference table, load once.
  const planRows = await db.select().from(plans);
  const includedByTier = new Map(planRows.map((p) => [p.tier, p.included_credits]));

  // Per-org caches (one org may have many subscribers).
  const creditsByOrg = new Map<string, number>();
  const overByOrg = new Map<string, boolean>();
  const periodCreditsFor = async (orgId: string) => {
    let v = creditsByOrg.get(orgId);
    if (v === undefined) {
      v = await creditsForOrgSince(orgId, monthStart);
      creditsByOrg.set(orgId, v);
    }
    return v;
  };
  const ceilingOverFor = async (orgId: string) => {
    let v = overByOrg.get(orgId);
    if (v === undefined) {
      v = (await getCeilingStatus(orgId)).over;
      overByOrg.set(orgId, v);
    }
    return v;
  };

  const result: SpendAlertSweepResult = { evaluated: 0, escalationSent: 0, summarySent: 0 };

  for (const { sub, userEmail, orgName, orgTier } of subs) {
    result.evaluated++;

    const usedCredits = await periodCreditsFor(sub.org_id);
    const includedCredits = includedByTier.get(orgTier) ?? 0;
    const pctUsed =
      includedCredits > 0 ? Math.round((usedCredits / includedCredits) * 100) : 0;
    const spendInclVat = usedCredits * CREDIT_PRICE_ZAR * (1 + VAT_RATE);

    const updates: Partial<typeof spendAlertSubscriptions.$inferInsert> = {};

    // One escalation per period: hard-cap takes precedence over threshold.
    if (sub.last_alerted_period !== period) {
      const overCeiling = sub.alert_on_hardcap && (await ceilingOverFor(sub.org_id));
      const overThreshold =
        sub.alert_on_threshold &&
        sub.threshold_pct != null &&
        includedCredits > 0 &&
        pctUsed >= sub.threshold_pct;

      const variant = overCeiling ? "hardcap" : overThreshold ? "threshold" : null;
      if (variant) {
        const sent = await sendTransactionalEmail(
          userEmail,
          variant === "hardcap"
            ? `Spend ceiling reached — ${orgName}`
            : `Spend alert: ${pctUsed}% of your allowance used — ${orgName}`,
          spendAlertEmail({
            variant,
            orgName,
            period,
            usedCredits,
            includedCredits,
            pctUsed,
            spendInclVat,
            usageUrl: usageUrl(),
            unsubscribeUrl: unsubscribeUrl(sub.unsubscribe_token),
          }),
        );
        if (sent) {
          updates.last_alerted_period = period;
          result.escalationSent++;
        }
      }
    }

    // Cadence-driven summary, independent of the escalation guard.
    if (sub.alert_on_summary && sub.summary_cadence) {
      const last = sub.last_summary_sent_at;
      const due =
        sub.summary_cadence === "weekly"
          ? last == null || now.getTime() - last.getTime() >= WEEK_MS
          : last == null ||
            last.getFullYear() !== now.getFullYear() ||
            last.getMonth() !== now.getMonth();
      if (due) {
        const sent = await sendTransactionalEmail(
          userEmail,
          `Your spend summary for ${period} — ${orgName}`,
          spendAlertEmail({
            variant: "summary",
            orgName,
            period,
            usedCredits,
            includedCredits,
            pctUsed,
            spendInclVat,
            usageUrl: usageUrl(),
            unsubscribeUrl: unsubscribeUrl(sub.unsubscribe_token),
          }),
        );
        if (sent) {
          updates.last_summary_sent_at = now;
          result.summarySent++;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = now;
      await db
        .update(spendAlertSubscriptions)
        .set(updates)
        .where(eq(spendAlertSubscriptions.id, sub.id));
    }
  }

  return result;
}
