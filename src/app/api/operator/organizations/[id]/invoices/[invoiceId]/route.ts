import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { clientIp, error, requireApiOperator, success } from "@/lib/api";
import { recordOperatorAudit } from "@/lib/operator-audit";

// Operator invoice reconciliation (usage-based pricing, Phase 6). There is no
// payment processor: an operator marks an EFT invoice paid (with the bank
// reference) or voids it. Operator-only (requireApiOperator reads any org — no
// orgScope); every mutation is audited, mirroring the org PATCH precedent.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; invoiceId: string }> },
) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id, invoiceId } = await params;
    const body = await request.json();
    const action = body.action;
    if (action !== "mark_paid" && action !== "void") {
      return error("action must be 'mark_paid' or 'void'");
    }

    const invoice = await db.query.invoices.findFirst({
      where: and(eq(invoices.id, invoiceId), eq(invoices.org_id, id)),
    });
    if (!invoice) return error("Invoice not found", 404);

    const ip = clientIp(request);
    const now = new Date();

    if (action === "mark_paid") {
      if (invoice.status === "paid") return error("Invoice is already paid");
      if (invoice.status === "void") return error("Cannot pay a void invoice");
      const eftRef =
        typeof body.eft_ref === "string" && body.eft_ref.trim()
          ? body.eft_ref.trim()
          : null;
      const [row] = await db
        .update(invoices)
        .set({ status: "paid", paid_at: now, eft_ref: eftRef, updated_at: now })
        .where(eq(invoices.id, invoiceId))
        .returning();
      await recordOperatorAudit({
        operatorUserId: ctx.userId,
        action: "mark_invoice_paid",
        targetOrgId: id,
        metadata: {
          invoiceId,
          invoiceNo: invoice.invoice_no,
          eftRef,
          total: invoice.total_incl_vat,
        },
        ip,
        endedAt: now,
      });
      return success(row);
    }

    // void
    if (invoice.status === "paid") return error("Cannot void a paid invoice");
    if (invoice.status === "void") return error("Invoice is already void");
    const reason =
      typeof body.reason === "string" ? body.reason.trim() || null : null;
    const [row] = await db
      .update(invoices)
      .set({ status: "void", updated_at: now })
      .where(eq(invoices.id, invoiceId))
      .returning();
    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "void_invoice",
      targetOrgId: id,
      metadata: { invoiceId, invoiceNo: invoice.invoice_no, reason },
      ip,
      endedAt: now,
    });
    return success(row);
  } catch (err) {
    console.error(
      "PATCH /api/operator/organizations/[id]/invoices/[invoiceId] error:",
      err,
    );
    return error("Internal server error", 500);
  }
}
