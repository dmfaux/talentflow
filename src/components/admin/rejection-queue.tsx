"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast-provider";

interface QueueRow {
  id: string;
  name: string;
  email: string;
  score: number | null;
  brandName: string;
  roleTitle: string;
  recommendedAt: string | null;
}

interface Props {
  rows: QueueRow[];
  /** Whether the viewer can action rejections (recruiter+). Viewers see the
   *  queue read-only. The server re-checks per candidate regardless. */
  canManage: boolean;
}

function waitingDays(recommendedAt: string | null): number | null {
  if (!recommendedAt) return null;
  const ms = Date.now() - new Date(recommendedAt).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export function RejectionQueue({ rows, canManage }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmAccept, setConfirmAccept] = useState(false);
  const [busy, setBusy] = useState(false);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function runBulk(decision: "accept" | "dismiss") {
    if (selectedIds.length === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/candidates/rejections/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, ids: selectedIds }),
      });
      if (res.ok) {
        const { data } = await res.json();
        const n = data.actioned.length;
        const skipped = data.skipped.length;
        toast(
          `${n} candidate${n === 1 ? "" : "s"} ${decision === "accept" ? "rejected" : "kept"}` +
            (skipped ? ` · ${skipped} skipped` : ""),
          decision === "accept" ? "warning" : "success"
        );
        setSelected(new Set());
        setConfirmAccept(false);
      } else {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? "Bulk action failed", "error");
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface px-5 py-16 text-center">
        <p className="text-sm font-medium text-charcoal">Nothing waiting on you</p>
        <p className="mt-1 text-sm text-txt-muted">
          When the AI recommends rejecting a candidate, they&rsquo;ll appear here
          for you to accept or dismiss.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface">
      {/* Controls / selection bar */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h3 className="text-sm font-semibold text-charcoal">
          Awaiting your decision
          <span className="ml-2 font-mono text-xs font-normal text-txt-muted">
            {rows.length}
          </span>
        </h3>
        {canManage && selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-txt-secondary">{selected.size} selected</span>
            <button
              onClick={() => setConfirmAccept(true)}
              disabled={busy}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
            >
              Accept rejection
            </button>
            <button
              onClick={() => runBulk("dismiss")}
              disabled={busy}
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light cursor-pointer disabled:opacity-50"
            >
              Dismiss — keep
            </button>
            <button
              onClick={() => setSelected(new Set())}
              disabled={busy}
              className="inline-flex h-8 items-center rounded-lg px-2 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            {canManage && (
              <th className="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                  className="h-4 w-4 rounded border-border accent-accent cursor-pointer"
                />
              </th>
            )}
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Candidate</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Role &amp; brand</th>
            <th className="px-5 py-3 text-center text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Score</th>
            <th className="px-5 py-3 text-right text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">Waiting</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const days = waitingDays(r.recommendedAt);
            const isSelected = selected.has(r.id);
            return (
              <tr
                key={r.id}
                className={`transition-colors hover:bg-cream/60 ${isSelected ? "bg-cream/50" : ""}`}
              >
                {canManage && (
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                      className="h-4 w-4 rounded border-border accent-accent cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-5 py-3">
                  <Link href={`/candidates/${r.id}`} className="group block">
                    <p className="text-sm font-medium text-charcoal transition-colors group-hover:text-accent">
                      {r.name}
                    </p>
                    <p className="font-mono text-[0.65rem] text-txt-muted">{r.email}</p>
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <p className="text-sm text-charcoal">{r.roleTitle}</p>
                  <p className="text-[0.7rem] text-txt-muted">{r.brandName}</p>
                </td>
                <td className="px-5 py-3 text-center">
                  <span className={`font-mono text-sm font-semibold ${r.score !== null && r.score < 5 ? "text-red" : "text-txt-secondary"}`}>
                    {r.score !== null ? r.score.toFixed(1) : "—"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <span
                    className={`font-mono text-xs ${days !== null && days >= 3 ? "text-warning" : "text-txt-muted"}`}
                  >
                    {days === null ? "—" : days === 0 ? "today" : `${days}d`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Bulk-accept confirmation — accept sends rejection emails, so confirm. */}
      {confirmAccept && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-charcoal">
              Reject {selected.size} candidate{selected.size === 1 ? "" : "s"}?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-txt-secondary">
              Each selected candidate is rejected and sent a rejection email. To
              add a personal note, reject them one at a time from their profile
              instead.
            </p>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmAccept(false)}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => runBulk("accept")}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg bg-red px-4 text-[0.78rem] font-medium text-white transition-colors hover:bg-red/90 cursor-pointer disabled:opacity-50"
              >
                {busy ? "Processing..." : "Reject candidates"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
