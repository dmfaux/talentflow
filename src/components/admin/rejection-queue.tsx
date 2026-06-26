"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useToast } from "@/components/ui/toast-provider";
import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";

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
      <div className="rounded-xl border border-rule bg-surface px-5 py-16 text-center">
        <p className="text-sm font-medium text-ink">Nothing waiting on you</p>
        <p className="mt-1 text-sm text-ink-muted">
          When the AI recommends rejecting a candidate, they&rsquo;ll appear here
          for you to accept or dismiss.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-rule bg-surface">
      {/* Controls / selection bar */}
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h3 className="text-sm font-semibold text-ink">
          Awaiting your decision
          <span className="ml-2 font-mono text-xs font-normal text-ink-muted">
            {rows.length}
          </span>
        </h3>
        {canManage && selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-soft">{selected.size} selected</span>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => setConfirmAccept(true)}>
              Accept rejection
            </Button>
            <Button size="sm" disabled={busy} onClick={() => runBulk("dismiss")}>
              Dismiss — keep
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-rule">
            {canManage && (
              <th className="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                  className="h-4 w-4 rounded border-rule accent-cobalt cursor-pointer"
                />
              </th>
            )}
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Candidate</th>
            <th className="px-5 py-3 text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Role &amp; brand</th>
            <th className="px-5 py-3 text-center text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Score</th>
            <th className="px-5 py-3 text-right text-[0.63rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Waiting</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule">
          {rows.map((r) => {
            const days = waitingDays(r.recommendedAt);
            const isSelected = selected.has(r.id);
            return (
              <tr
                key={r.id}
                className={`transition-colors hover:bg-canvas/60 ${isSelected ? "bg-canvas/50" : ""}`}
              >
                {canManage && (
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.name}`}
                      className="h-4 w-4 rounded border-rule accent-cobalt cursor-pointer"
                    />
                  </td>
                )}
                <td className="px-5 py-3">
                  <Link href={`/candidates/${r.id}`} className="group block">
                    <p className="text-sm font-medium text-ink transition-colors group-hover:text-cobalt">
                      {r.name}
                    </p>
                    <p className="font-mono text-[0.65rem] text-ink-muted">{r.email}</p>
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <p className="text-sm text-ink">{r.roleTitle}</p>
                  <p className="text-[0.7rem] text-ink-muted">{r.brandName}</p>
                </td>
                <td className="px-5 py-3 text-center">
                  <span className={`font-mono text-sm font-semibold ${r.score !== null && r.score < 5 ? "text-red" : "text-ink-soft"}`}>
                    {r.score !== null ? r.score.toFixed(1) : "—"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <span
                    className={`font-mono text-xs ${days !== null && days >= 3 ? "text-saffron-deep" : "text-ink-muted"}`}
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
      <ConfirmModal
        open={confirmAccept}
        title={`Reject ${selected.size} candidate${selected.size === 1 ? "" : "s"}?`}
        description="Each selected candidate is rejected and sent a rejection email. To add a personal note, reject them one at a time from their profile instead."
        confirmLabel="Reject candidates"
        variant="danger"
        loading={busy}
        onConfirm={() => runBulk("accept")}
        onCancel={() => setConfirmAccept(false)}
      />
    </div>
  );
}
