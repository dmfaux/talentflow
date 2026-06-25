import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  invoiceCounters,
  invoiceLineItems,
  invoices,
  organizations,
  plans,
  usageRollups,
} from "@/db/schema";
import { invoiceEmail, sendTransactionalEmail } from "@/lib/email";
import {
  getOrgUsageForPeriod,
  periodBounds,
  priceInvoice,
  type ModelTier,
} from "@/lib/pricing";

// ── Billing close + invoicing (usage-based pricing, Phase 6) ─────────
//
// A monthly close folds a closed period's usage into a frozen usage_rollups row
// per (org, period, model_tier), prices an invoice off it, and auto-issues +
// emails a South African EFT tax invoice. Idempotent per (org, period): the
// unique constraint guards a re-run, and invoice numbers come from a counter
// locked FOR UPDATE inside the txn so they are gapless even under concurrency.
// There is no payment processor — an operator marks invoices paid by hand.

const DUE_DAYS = 30;
type InvoiceRow = typeof invoices.$inferSelect;

const formatInvoiceNo = (seq: number, year: number) =>
  `INV-${year}-${String(seq).padStart(6, "0")}`;

export interface CloseResult {
  invoice: InvoiceRow;
  created: boolean; // false = the period was already closed (idempotent no-op)
}

/**
 * Close one org's period: freeze the rollup, price + persist the invoice (issued)
 * + its line items, then email it. Safe to call twice — a second call returns the
 * existing invoice without consuming an invoice number or re-sending the email.
 */
export async function closeOrgPeriod(
  orgId: string,
  period: string,
): Promise<CloseResult> {
  const { start, end } = periodBounds(period);
  const year = start.getFullYear();

  const usage = await getOrgUsageForPeriod(orgId, start, end);
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { id: true, name: true, tier: true, billing_email: true },
  });
  if (!org) throw new Error(`closeOrgPeriod: org ${orgId} not found`);

  const plan = await db.query.plans.findFirst({ where: eq(plans.tier, org.tier) });
  if (!plan) throw new Error(`closeOrgPeriod: no plan for tier ${org.tier}`);

  const creditsByTier = {
    essential: usage.byTier.essential.credits,
    professional: usage.byTier.professional.credits,
    executive: usage.byTier.executive.credits,
  } satisfies Record<ModelTier, number>;
  const priced = priceInvoice(plan, creditsByTier, usage.chatCredits);

  const { invoice, created } = await db.transaction(async (tx) => {
    // Idempotency + gapless numbering both hinge on this lock: serialise all
    // closes on the singleton counter row, THEN check for an existing invoice —
    // so a re-run consumes no number and a concurrent run can't double-insert.
    let [counter] = await tx
      .select()
      .from(invoiceCounters)
      .where(eq(invoiceCounters.id, 1))
      .for("update");
    if (!counter) {
      await tx.insert(invoiceCounters).values({ id: 1, next_seq: 1 }).onConflictDoNothing();
      [counter] = await tx
        .select()
        .from(invoiceCounters)
        .where(eq(invoiceCounters.id, 1))
        .for("update");
    }

    const existing = await tx.query.invoices.findFirst({
      where: and(eq(invoices.org_id, orgId), eq(invoices.period, period)),
    });
    if (existing) return { invoice: existing, created: false };

    const seq = counter?.next_seq ?? 1;
    const now = new Date();
    const dueAt = new Date(now.getTime() + DUE_DAYS * 24 * 60 * 60 * 1000);

    const [inv] = await tx
      .insert(invoices)
      .values({
        org_id: orgId,
        invoice_no: formatInvoiceNo(seq, year),
        period,
        period_start: start,
        period_end: end,
        subtotal_ex_vat: priced.subtotalExVat,
        vat_amount: priced.vat,
        total_incl_vat: priced.totalInclVat,
        status: "issued",
        issued_at: now,
        due_at: dueAt,
      })
      .returning();

    await tx.insert(invoiceLineItems).values(
      priced.lines.map((l) => ({
        invoice_id: inv.id,
        line_type: l.lineType,
        model_tier: l.modelTier,
        description: l.description,
        quantity_credits: l.quantityCredits,
        unit_rate_zar: l.unitRateZar,
        amount_zar: l.amountZar,
      })),
    );

    // Freeze the per-tier rollup (the durable billing basis, Phase 7). Upsert so
    // a manual re-freeze of an open period before close stays consistent.
    for (const tier of Object.keys(usage.byTier) as ModelTier[]) {
      const t = usage.byTier[tier];
      await tx
        .insert(usageRollups)
        .values({
          org_id: orgId,
          period,
          model_tier: tier,
          credits: t.credits,
          input_tokens: t.inputTokens,
          output_tokens: t.outputTokens,
        })
        .onConflictDoUpdate({
          target: [usageRollups.org_id, usageRollups.period, usageRollups.model_tier],
          set: {
            credits: t.credits,
            input_tokens: t.inputTokens,
            output_tokens: t.outputTokens,
            frozen_at: now,
          },
        });
    }

    await tx
      .update(invoiceCounters)
      .set({ next_seq: seq + 1 })
      .where(eq(invoiceCounters.id, 1));

    return { invoice: inv, created: true };
  });

  // Auto-issue: email the tax invoice once, after commit. A missing billing_email
  // is logged, not fatal — the invoice still exists for the operator to chase.
  if (created) {
    if (org.billing_email) {
      await sendTransactionalEmail(
        org.billing_email,
        `Tax invoice ${invoice.invoice_no} — ${org.name}`,
        invoiceEmail({ variant: "issued", orgName: org.name, invoice, priced }),
      );
    } else {
      console.warn(`closeOrgPeriod: org ${orgId} has no billing_email; invoice ${invoice.invoice_no} not emailed`);
    }
  }

  return { invoice, created };
}

export interface OverdueSweepResult {
  flipped: number;
  remindersSent: number;
}

/**
 * Flip past-due issued invoices to `overdue` and email a reminder. NO auto-
 * suspend — suspension stays a manual operator action. Idempotent: an invoice
 * already `overdue` is not re-flagged (only `issued` rows are swept).
 */
export async function runOverdueSweep(
  now: Date = new Date(),
): Promise<OverdueSweepResult> {
  const due = await db
    .select({
      invoice: invoices,
      orgName: organizations.name,
      billingEmail: organizations.billing_email,
    })
    .from(invoices)
    .innerJoin(organizations, eq(invoices.org_id, organizations.id))
    .where(and(eq(invoices.status, "issued"), lt(invoices.due_at, now)));

  let remindersSent = 0;
  for (const { invoice, orgName, billingEmail } of due) {
    await db
      .update(invoices)
      .set({ status: "overdue", updated_at: now })
      .where(eq(invoices.id, invoice.id));
    if (billingEmail) {
      const sent = await sendTransactionalEmail(
        billingEmail,
        `Payment overdue: ${invoice.invoice_no} — ${orgName}`,
        invoiceEmail({
          variant: "overdue",
          orgName,
          invoice: { ...invoice, status: "overdue" },
        }),
      );
      if (sent) remindersSent++;
    }
  }
  return { flipped: due.length, remindersSent };
}

/** Active orgs that should get a billing-close job for `period`. An org with no
 *  usage still owes its base fee, so this enumerates every active org. */
export async function activeOrgIdsForClose(): Promise<string[]> {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.status, "active"));
  return rows.map((r) => r.id);
}
