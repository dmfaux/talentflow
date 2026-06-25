import { and, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, candidates, memberships, users } from "@/db/schema";
import {
  pendingRejectionReminderEmail,
  sendTransactionalEmail,
} from "@/lib/email";
import { appHostOrigin } from "@/lib/host";
import { getOrgStatus } from "@/lib/org-status";

// ── Stale pending-rejection reminder sweep ───────────────────────────
//
// Candidates the AI recommends for rejection wait in `pending_rejection` forever
// — they are NEVER auto-rejected (no default reject). To stop them rotting
// unseen, this sweep reminds a brand's recruiters/admins about items that have
// waited too long: a first nudge after REMINDER_AFTER_DAYS, then repeating every
// REMINDER_REPEAT_DAYS. Designed to be fired by an external cron, exactly like
// the billing-close tick. Idempotent within a window via rejection_reminded_at.

const DAY_MS = 24 * 60 * 60 * 1000;
/** First reminder fires once an item has waited this long since recommendation. */
export const REMINDER_AFTER_DAYS = 3;
/** Subsequent reminders repeat on this cadence while the item stays pending. */
export const REMINDER_REPEAT_DAYS = 7;

const REVIEW_URL = () => `${appHostOrigin()}/candidates?status=pending_rejection`;

export interface PendingRejectionReminderResult {
  /** Distinct (org, brand) groups that had stale items this run. */
  brandsScanned: number;
  /** Candidates whose rejection_reminded_at was advanced. */
  candidatesReminded: number;
  /** Reminder emails successfully sent across all recipients. */
  emailsSent: number;
  /** Groups skipped because no active staff recipient could be found. */
  brandsWithoutRecipients: number;
}

/** Active staff who should action a brand's rejections: the brand's own
 *  recruiters/admins PLUS the org's owners/admins (who can manage every brand).
 *  Deduped by email. */
async function reminderRecipients(
  orgId: string,
  brandId: string
): Promise<{ email: string; name: string }[]> {
  const brandStaff = await db
    .select({ email: users.email, name: users.first_name })
    .from(memberships)
    .innerJoin(users, eq(memberships.user_id, users.id))
    .where(
      and(
        eq(memberships.client_id, brandId),
        inArray(memberships.brand_role, ["brand_admin", "recruiter"]),
        eq(users.is_active, true)
      )
    );

  const orgAdmins = await db
    .select({ email: users.email, name: users.first_name })
    .from(users)
    .where(
      and(
        eq(users.org_id, orgId),
        inArray(users.org_role, ["owner", "org_admin"]),
        eq(users.is_active, true)
      )
    );

  const byEmail = new Map<string, { email: string; name: string }>();
  for (const r of [...brandStaff, ...orgAdmins]) {
    if (!byEmail.has(r.email)) byEmail.set(r.email, r);
  }
  return [...byEmail.values()];
}

export async function runPendingRejectionReminderSweep(
  now: Date = new Date()
): Promise<PendingRejectionReminderResult> {
  const firstCutoff = new Date(now.getTime() - REMINDER_AFTER_DAYS * DAY_MS);
  const repeatCutoff = new Date(now.getTime() - REMINDER_REPEAT_DAYS * DAY_MS);

  // Stale = pending_rejection, recommended long enough ago, and either never
  // reminded or last reminded beyond the repeat cadence. (lte excludes NULL
  // rejection_recommended_at, so only properly-parked candidates qualify.)
  const stale = await db
    .select({
      id: candidates.id,
      orgId: candidates.org_id,
      brandId: campaigns.client_id,
      recommendedAt: candidates.rejection_recommended_at,
    })
    .from(candidates)
    .innerJoin(campaigns, eq(candidates.campaign_id, campaigns.id))
    .where(
      and(
        eq(candidates.status, "pending_rejection"),
        lte(candidates.rejection_recommended_at, firstCutoff),
        or(
          isNull(candidates.rejection_reminded_at),
          lte(candidates.rejection_reminded_at, repeatCutoff)
        )
      )
    );

  // Group by (org, brand) so each recipient gets ONE summarising email per brand
  // rather than one per candidate.
  const groups = new Map<
    string,
    { orgId: string; brandId: string; ids: string[]; oldest: Date }
  >();
  for (const row of stale) {
    const key = `${row.orgId}:${row.brandId}`;
    const oldest = row.recommendedAt ?? now;
    const g = groups.get(key);
    if (g) {
      g.ids.push(row.id);
      if (oldest < g.oldest) g.oldest = oldest;
    } else {
      groups.set(key, {
        orgId: row.orgId,
        brandId: row.brandId,
        ids: [row.id],
        oldest,
      });
    }
  }

  const result: PendingRejectionReminderResult = {
    brandsScanned: 0,
    candidatesReminded: 0,
    emailsSent: 0,
    brandsWithoutRecipients: 0,
  };

  for (const g of groups.values()) {
    // Don't email a suspended/deleted org's staff.
    if ((await getOrgStatus(g.orgId)) !== "active") continue;
    result.brandsScanned += 1;

    const recipients = await reminderRecipients(g.orgId, g.brandId);
    const oldestDays = Math.max(
      1,
      Math.floor((now.getTime() - g.oldest.getTime()) / DAY_MS)
    );
    // Resolve the brand name for the email copy.
    const brand = await db.query.clients.findFirst({
      where: (c, { eq: eqc }) => eqc(c.id, g.brandId),
      columns: { name: true },
    });
    const brandName = brand?.name ?? "your brand";

    let sentForGroup = 0;
    for (const r of recipients) {
      const messageId = await sendTransactionalEmail(
        r.email,
        `${g.ids.length} candidate${g.ids.length === 1 ? "" : "s"} awaiting your rejection decision`,
        pendingRejectionReminderEmail({
          recipientName: r.name,
          brandName,
          count: g.ids.length,
          oldestDays,
          reviewUrl: REVIEW_URL(),
        })
      );
      if (messageId) sentForGroup += 1;
    }
    result.emailsSent += sentForGroup;

    // Advance the guard when we either reached someone OR there's no one to
    // reach (otherwise a recipient-less brand re-selects every run forever).
    // If recipients existed but ALL sends failed, leave the guard so the next
    // tick retries.
    const noRecipients = recipients.length === 0;
    if (noRecipients) result.brandsWithoutRecipients += 1;
    if (sentForGroup > 0 || noRecipients) {
      await db
        .update(candidates)
        .set({ rejection_reminded_at: now })
        .where(inArray(candidates.id, g.ids));
      result.candidatesReminded += g.ids.length;
    }
  }

  return result;
}
