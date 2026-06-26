"use client";

import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";
import { useToast } from "@/components/ui/toast-provider";
import { Card, SectionHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
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

  // Borderless tinted wells — depth from tone, not a nested bordered box.
  const row = "flex items-start gap-3 rounded-lg bg-canvas/40 px-4 py-3";
  const checkbox = "mt-0.5 h-4 w-4 rounded border-rule accent-cobalt cursor-pointer";
  const subLabel =
    "mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

  return (
    <Card className="mb-6">
      <SectionHeading
        className="mb-5"
        title="Spend alerts"
        icon={
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2a3.5 3.5 0 0 0-3.5 3.5c0 2.5-1 4-1.5 4.5h10c-.5-.5-1.5-2-1.5-4.5A3.5 3.5 0 0 0 8 2Z" />
            <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
          </svg>
        }
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !sub ? (
        <p className="text-sm text-ink-muted">Could not load spend-alert settings.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-ink-muted">
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
              className={checkbox}
            />
            <div className="flex-1">
              <label htmlFor="alert-threshold" className="block text-sm font-medium text-ink">
                Allowance threshold
              </label>
              <p className="mt-0.5 text-xs text-ink-muted">
                Alert once per month when usage reaches a share of the plan allowance.
              </p>
              {sub.alert_on_threshold && (
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={sub.threshold_pct}
                    onChange={(e) => set("threshold_pct", Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-sm text-ink-muted">% of allowance</span>
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
              className={checkbox}
            />
            <div className="flex-1">
              <label htmlFor="alert-hardcap" className="block text-sm font-medium text-ink">
                Spend ceiling reached
              </label>
              <p className="mt-0.5 text-xs text-ink-muted">
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
              className={checkbox}
            />
            <div className="flex-1">
              <label htmlFor="alert-summary" className="block text-sm font-medium text-ink">
                Spend summary
              </label>
              <p className="mt-0.5 text-xs text-ink-muted">
                A recurring digest of current spend.
              </p>
              {sub.alert_on_summary && (
                <div className="mt-2">
                  <label htmlFor="summary-cadence" className={subLabel}>
                    Cadence
                  </label>
                  <Select
                    id="summary-cadence"
                    value={sub.summary_cadence}
                    onChange={(e) =>
                      set("summary_cadence", e.target.value as "weekly" | "monthly")
                    }
                    className="w-40"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
