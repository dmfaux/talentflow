import { db } from "@/db";
import { invoices } from "@/db/schema";
import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { orgScope } from "@/lib/tenant";

// Tenant invoice statement (usage-based pricing, Phase 6). orgScope-isolated and
// gated by view_spend (org_admin+) — the same floor as the Usage & Spend page,
// never the operator raw-org-id path. Returns the org's invoices with line items;
// reads the FROZEN invoice/line-item rows (Phase 7), not live usage.
export async function GET() {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const forbidden = authorizeApiOrg(ctx, "view_spend");
  if (forbidden) return forbidden;

  try {
    const rows = await db.query.invoices.findMany({
      where: orgScope(invoices, ctx),
      with: { lineItems: true },
      orderBy: (t, { desc }) => [desc(t.created_at)],
    });

    const view = rows.map((inv) => ({
      id: inv.id,
      invoice_no: inv.invoice_no,
      period: inv.period,
      status: inv.status,
      currency: inv.currency,
      subtotal_ex_vat: inv.subtotal_ex_vat,
      vat_amount: inv.vat_amount,
      total_incl_vat: inv.total_incl_vat,
      issued_at: inv.issued_at,
      due_at: inv.due_at,
      paid_at: inv.paid_at,
      line_items: inv.lineItems
        .slice()
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map((l) => ({
          line_type: l.line_type,
          model_tier: l.model_tier,
          description: l.description,
          quantity_credits: l.quantity_credits,
          unit_rate_zar: l.unit_rate_zar,
          amount_zar: l.amount_zar,
        })),
    }));

    return success({ invoices: view });
  } catch (err) {
    console.error("GET /api/admin/invoices error:", err);
    return error("Internal server error", 500);
  }
}
