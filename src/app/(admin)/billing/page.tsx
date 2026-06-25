"use client";

import { useEffect, useState } from "react";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";

interface LineItem {
  line_type: "base" | "overage" | "chat" | "vat";
  model_tier: string | null;
  description: string;
  quantity_credits: number | null;
  unit_rate_zar: number | null;
  amount_zar: number;
}

interface Invoice {
  id: string;
  invoice_no: string;
  period: string;
  status: "draft" | "issued" | "paid" | "overdue" | "void";
  subtotal_ex_vat: number;
  vat_amount: number;
  total_incl_vat: number;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  line_items: LineItem[];
}

function zar(n: number): string {
  return "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

const STATUS: Record<Invoice["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-canvas-2 text-ink-muted" },
  issued: { label: "Awaiting payment", cls: "bg-cobalt-tint text-cobalt" },
  paid: { label: "Paid", cls: "bg-green-light text-green" },
  overdue: { label: "Overdue", cls: "bg-red-light text-red" },
  void: { label: "Void", cls: "bg-canvas-2 text-ink-faint line-through" },
};

export default function BillingPage() {
  const tenant = useTenant();
  const allowed = canManageOrg(tenant);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/admin/invoices")
      .then((r) => r.json())
      .then((res) => setInvoices(res.data?.invoices ?? []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, [allowed]);

  if (!allowed) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="font-display text-[1.9rem] text-ink tracking-tight">Invoices</h1>
        <p className="mt-2 text-ink-muted text-[0.9rem]">
          Invoices are visible to organisation owners and admins.
        </p>
      </div>
    );
  }

  const outstanding = (invoices ?? [])
    .filter((i) => i.status === "issued" || i.status === "overdue")
    .reduce((s, i) => s + i.total_incl_vat, 0);

  return (
    <div className="p-6 sm:p-8 max-w-[1000px]">
      <div className="mb-8">
        <h1 className="font-display text-[1.9rem] text-ink tracking-tight">Invoices</h1>
        <p className="mt-1.5 text-ink-muted text-[0.9rem]">
          Your monthly tax invoices. Pay by EFT using the invoice number as the reference.
        </p>
      </div>

      {outstanding > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-rule bg-paper p-5">
          <p className="text-[0.82rem] text-ink-muted">Outstanding balance</p>
          <p className="font-display text-[1.6rem] leading-none tracking-tight text-ink">{zar(outstanding)}</p>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !invoices || invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-rule bg-paper p-10 text-center">
          <p className="text-[0.92rem] text-ink">No invoices yet</p>
          <p className="mt-1.5 text-[0.82rem] text-ink-muted">
            Your first invoice arrives after the end of your first billing month.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {invoices.map((inv) => {
            const badge = STATUS[inv.status];
            return (
              <div key={inv.id} className="overflow-hidden rounded-xl border border-rule bg-paper">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-5 py-4">
                  <div>
                    <p className="font-mono text-[0.92rem] text-ink">{inv.invoice_no}</p>
                    <p className="mt-0.5 text-[0.74rem] text-ink-faint">
                      {inv.period} · issued {shortDate(inv.issued_at)} · due {shortDate(inv.due_at)}
                      {inv.paid_at ? ` · paid ${shortDate(inv.paid_at)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.66rem] font-semibold uppercase tracking-[0.1em] ${badge.cls}`}>
                      {badge.label}
                    </span>
                    <span className="font-display text-[1.25rem] leading-none tracking-tight text-ink">
                      {zar(inv.total_incl_vat)}
                    </span>
                  </div>
                </div>
                <dl className="divide-y divide-rule/60 px-5">
                  {inv.line_items.map((l, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5">
                      <dt className="text-[0.82rem] text-ink-soft">
                        {l.description}
                        {l.quantity_credits != null && (
                          <span className="ml-2 text-[0.72rem] text-ink-faint">
                            {Math.round(l.quantity_credits).toLocaleString("en-ZA")} credits
                          </span>
                        )}
                      </dt>
                      <dd className="font-mono text-[0.82rem] tabular-nums text-ink">{zar(l.amount_zar)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
