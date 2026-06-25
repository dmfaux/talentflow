"use client";

import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { useToast } from "@/components/ui/toast-provider";
import { FormEvent, useEffect, useState } from "react";

interface SpendSubscription {
  alert_on_threshold: boolean;
  threshold_pct: number;
  alert_on_summary: boolean;
  summary_cadence: "weekly" | "monthly";
  alert_on_hardcap: boolean;
  enabled: boolean;
}

// Spend-alert preferences (usage-based pricing, Phase 5). Per-user, per-org opt-in
// to threshold / summary / hard-cap emails. Gated by canManageOrg (the view_spend
// floor the server PATCH enforces); hidden from members entirely.
export function SpendAlertCard() {
  const tenant = useTenant();
  const { toast } = useToast();

  const [sub, setSub] = useState<SpendSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/spend-subscription")
      .then(async (r) => {
        if (!r.ok) throw new Error("Could not load");
        return r.json();
      })
      .then(({ data }: { data: SpendSubscription }) => setSub(data))
      .catch(() => setSub(null))
      .finally(() => setLoading(false));
  }, []);

  if (!canManageOrg(tenant)) return null;

  function set<K extends keyof SpendSubscription>(key: K, value: SpendSubscription[K]) {
    setSub((s) => (s ? { ...s, [key]: value } : s));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!sub) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/spend-subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      const { data, error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not save", "error");
        return;
      }
      setSub(data);
      toast("Spend alerts updated", "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20";
  const labelClass =
    "mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted";
  const row =
    "flex items-start gap-3 rounded-lg border border-border bg-cream/30 px-4 py-3";

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-6">
      <div className="mb-5 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1b4332" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 2.5-1 4-1.5 4.5h10c-.5-.5-1.5-2-1.5-4.5A3.5 3.5 0 0 0 8 2Z" />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
        </svg>
        <h2 className="text-sm font-semibold text-charcoal">Spend alerts</h2>
      </div>

      {loading ? (
        <p className="text-sm text-txt-muted">Loading…</p>
      ) : !sub ? (
        <p className="text-sm text-txt-muted">Could not load spend-alert settings.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-txt-muted">
            Email me when this organisation&rsquo;s AI spend needs attention. You can
            unsubscribe from any alert email.
          </p>

          {/* Threshold */}
          <div className={row}>
            <input
              id="alert-threshold"
              type="checkbox"
              checked={sub.alert_on_threshold}
              onChange={(e) => set("alert_on_threshold", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <div className="flex-1">
              <label htmlFor="alert-threshold" className="block text-sm font-medium text-charcoal">
                Allowance threshold
              </label>
              <p className="mt-0.5 text-xs text-txt-muted">
                Alert once per month when usage reaches a share of the plan allowance.
              </p>
              {sub.alert_on_threshold && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={sub.threshold_pct}
                    onChange={(e) => set("threshold_pct", Number(e.target.value))}
                    className={`${inputClass} w-24`}
                  />
                  <span className="text-sm text-txt-muted">% of allowance</span>
                </div>
              )}
            </div>
          </div>

          {/* Hard cap */}
          <div className={row}>
            <input
              id="alert-hardcap"
              type="checkbox"
              checked={sub.alert_on_hardcap}
              onChange={(e) => set("alert_on_hardcap", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <div className="flex-1">
              <label htmlFor="alert-hardcap" className="block text-sm font-medium text-charcoal">
                Spend ceiling reached
              </label>
              <p className="mt-0.5 text-xs text-txt-muted">
                Alert when the ceiling pauses new candidate scoring.
              </p>
            </div>
          </div>

          {/* Summary */}
          <div className={row}>
            <input
              id="alert-summary"
              type="checkbox"
              checked={sub.alert_on_summary}
              onChange={(e) => set("alert_on_summary", e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <div className="flex-1">
              <label htmlFor="alert-summary" className="block text-sm font-medium text-charcoal">
                Spend summary
              </label>
              <p className="mt-0.5 text-xs text-txt-muted">
                A recurring digest of current spend.
              </p>
              {sub.alert_on_summary && (
                <div className="mt-2">
                  <label htmlFor="summary-cadence" className={labelClass}>
                    Cadence
                  </label>
                  <select
                    id="summary-cadence"
                    value={sub.summary_cadence}
                    onChange={(e) =>
                      set("summary_cadence", e.target.value as "weekly" | "monthly")
                    }
                    className={`${inputClass} w-40`}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.78rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {saving && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Save changes
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
