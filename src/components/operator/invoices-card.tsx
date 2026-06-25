"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast-provider";

interface OperatorInvoice {
  id: string;
  invoice_no: string;
  period: string;
  status: "draft" | "issued" | "paid" | "overdue" | "void";
  total_incl_vat: number;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  eft_ref: string | null;
}

const zar = (n: number) =>
  "R" + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—";

const STATUS: Record<OperatorInvoice["status"], string> = {
  draft: "bg-canvas-2 text-ink-muted",
  issued: "bg-cobalt-tint text-cobalt",
  paid: "bg-green-light text-green",
  overdue: "bg-red-light text-red",
  void: "bg-canvas-2 text-ink-faint",
};

export function OperatorInvoicesCard({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const [invoices, setInvoices] = useState<OperatorInvoice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [eftRef, setEftRef] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/operator/organizations/${orgId}/invoices`)
      .then((r) => r.json())
      .then((res) => setInvoices(res.data?.invoices ?? []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false));
  }, [orgId]);

  function apply(updated: OperatorInvoice) {
    setInvoices((prev) => (prev ? prev.map((i) => (i.id === updated.id ? updated : i)) : prev));
  }

  async function markPaid(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/operator/organizations/${orgId}/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_paid", eft_ref: eftRef.trim() || null }),
      });
      const { data, error } = await res.json();
      if (!res.ok) return toast(error || "Could not mark paid", "error");
      apply(data);
      setPayingId(null);
      setEftRef("");
      toast(`${data.invoice_no} marked paid`, "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  }

  async function voidInvoice(id: string, invoiceNo: string) {
    if (!confirm(`Void ${invoiceNo}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/operator/organizations/${orgId}/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void" }),
      });
      const { data, error } = await res.json();
      if (!res.ok) return toast(error || "Could not void", "error");
      apply(data);
      toast(`${invoiceNo} voided`, "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg text-ink">Invoices</h2>
        <span className="rounded-full bg-canvas-2 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-muted">
          EFT · operator-reconciled
        </span>
      </div>

      {loading ? (
        <p className="mt-5 text-sm text-ink-muted">Loading…</p>
      ) : !invoices || invoices.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-border px-4 py-3 text-center text-[0.78rem] text-ink-muted">
          No invoices issued yet.
        </p>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {invoices.map((inv) => {
            const canAct = inv.status === "issued" || inv.status === "overdue";
            return (
              <li key={inv.id} className="rounded-lg border border-border bg-cream/40 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-ink">{inv.invoice_no}</p>
                    <p className="mt-0.5 text-[0.7rem] text-ink-muted">
                      {inv.period} · due {shortDate(inv.due_at)}
                      {inv.eft_ref ? ` · ref ${inv.eft_ref}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.1em] ${STATUS[inv.status]}`}>
                      {inv.status}
                    </span>
                    <span className="font-mono text-sm tabular-nums text-ink">{zar(inv.total_incl_vat)}</span>
                  </div>
                </div>

                {canAct && payingId !== inv.id && (
                  <div className="mt-2.5 flex justify-end gap-2">
                    <button
                      onClick={() => voidInvoice(inv.id, inv.invoice_no)}
                      disabled={busy}
                      className="h-8 rounded-lg border border-border px-3 text-[0.72rem] font-medium text-ink-soft transition-colors hover:bg-canvas disabled:opacity-40 cursor-pointer"
                    >
                      Void
                    </button>
                    <button
                      onClick={() => { setPayingId(inv.id); setEftRef(""); }}
                      disabled={busy}
                      className="h-8 rounded-lg bg-cobalt px-3 text-[0.72rem] font-medium text-white transition-colors hover:bg-cobalt-deep disabled:opacity-40 cursor-pointer"
                    >
                      Mark paid
                    </button>
                  </div>
                )}

                {payingId === inv.id && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
                    <input
                      type="text"
                      value={eftRef}
                      onChange={(e) => setEftRef(e.target.value)}
                      placeholder="EFT reference (optional)"
                      className="h-8 flex-1 min-w-[10rem] rounded-lg border border-border bg-paper px-3 font-mono text-[0.72rem] text-ink outline-none focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
                    />
                    <button
                      onClick={() => { setPayingId(null); setEftRef(""); }}
                      disabled={busy}
                      className="h-8 rounded-lg border border-border px-3 text-[0.72rem] font-medium text-ink-soft transition-colors hover:bg-canvas disabled:opacity-40 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => markPaid(inv.id)}
                      disabled={busy}
                      className="h-8 rounded-lg bg-green px-3 text-[0.72rem] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-40 cursor-pointer"
                    >
                      Confirm paid
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
