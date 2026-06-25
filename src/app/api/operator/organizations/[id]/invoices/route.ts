import { desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { invoices } from "@/db/schema";
import { error, requireApiOperator, success } from "@/lib/api";

// Operator invoice list for one org (usage-based pricing, Phase 6). Operator-only
// (reads any org by raw id — no orgScope), unlike the tenant /api/admin/invoices.
// Returns every status + the EFT reconciliation fields the operator acts on.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { response } = await requireApiOperator();
  if (response) return response;

  try {
    const { id } = await params;
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.org_id, id))
      .orderBy(desc(invoices.created_at));

    return success({
      invoices: rows.map((inv) => ({
        id: inv.id,
        invoice_no: inv.invoice_no,
        period: inv.period,
        status: inv.status,
        total_incl_vat: inv.total_incl_vat,
        issued_at: inv.issued_at,
        due_at: inv.due_at,
        paid_at: inv.paid_at,
        eft_ref: inv.eft_ref,
      })),
    });
  } catch (err) {
    console.error("GET /api/operator/organizations/[id]/invoices error:", err);
    return error("Internal server error", 500);
  }
}
