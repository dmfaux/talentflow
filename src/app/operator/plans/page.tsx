"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TierBadge } from "@/components/admin/tier-badge";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast-provider";

interface Plan {
  tier: string;
  base_fee_zar: number;
  included_credits: number;
  overage_discount_pct: number;
  hard_ceiling_credits: number | null;
  public_visible: boolean;
  show_pricing: boolean;
}

type Field = "public_visible" | "show_pricing";

const zar = (n: number) => "R" + Math.round(n).toLocaleString("en-ZA");
const nf = (n: number) => n.toLocaleString("en-ZA");

// How the public pricing page will render this plan, given its two flags.
function publicState(plan: Plan): { label: string; tone: BadgeTone } {
  if (!plan.public_visible) return { label: "Hidden", tone: "neutral" };
  return plan.show_pricing
    ? { label: "Shown · priced", tone: "moss" }
    : { label: "Shown · redacted", tone: "saffron" };
}

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-cobalt" : "bg-ink/20"
      } ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function OperatorPlansPage() {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/operator/plans")
      .then(async (r) => {
        if (!r.ok) throw new Error("Failed");
        return r.json();
      })
      .then(({ data }: { data: { plans: Plan[] } }) => setPlans(data.plans))
      .catch(() => setLoadError("Could not load plans"))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(tier: string, field: Field, value: boolean) {
    setSavingKey(`${tier}:${field}`);
    // Optimistic — revert the single field on failure.
    setPlans(
      (prev) => prev?.map((p) => (p.tier === tier ? { ...p, [field]: value } : p)) ?? prev,
    );
    try {
      const res = await fetch("/api/operator/plans", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, [field]: value }),
      });
      const { data, error } = await res.json();
      if (!res.ok) {
        setPlans(
          (prev) =>
            prev?.map((p) => (p.tier === tier ? { ...p, [field]: !value } : p)) ?? prev,
        );
        toast(error || "Could not update plan", "error");
        return;
      }
      setPlans(
        (prev) => prev?.map((p) => (p.tier === tier ? { ...p, ...data } : p)) ?? prev,
      );
      toast("Pricing page updated", "success");
    } catch {
      setPlans(
        (prev) =>
          prev?.map((p) => (p.tier === tier ? { ...p, [field]: !value } : p)) ?? prev,
      );
      toast("Something went wrong", "error");
    } finally {
      setSavingKey(null);
    }
  }

  if (loading) {
    return <div className="py-24 text-center text-sm text-ink-muted">Loading…</div>;
  }
  if (loadError || !plans) {
    return (
      <div className="py-24 text-center text-sm text-red">
        {loadError || "Could not load plans"}
      </div>
    );
  }

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/operator" className="transition-colors hover:text-ink">
          Organisations
        </Link>
        <span>/</span>
        <span className="text-ink-soft">Plans</span>
      </div>

      <div className="mb-6">
        <p className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-ink-muted">
          Control plane
        </p>
        <h1 className="mt-1 font-serif text-2xl text-ink">Public pricing</h1>
        <p className="mt-1 max-w-2xl text-xs text-ink-muted">
          Controls only the public marketing page — every tier stays fully usable
          internally. <strong className="font-semibold text-ink-soft">Show on pricing page</strong>{" "}
          hides the card entirely; <strong className="font-semibold text-ink-soft">Advertise price &amp; credits</strong>{" "}
          keeps the card but swaps the numbers for a &ldquo;let&rsquo;s talk&rdquo; CTA.
        </p>
      </div>

      <div className="space-y-3">
        {plans.map((plan) => {
          const state = publicState(plan);
          return (
            <div
              key={plan.tier}
              className="rounded-xl border border-rule bg-surface p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <TierBadge tier={plan.tier} size="md" />
                    <Badge tone={state.tone} uppercase dot>
                      {state.label}
                    </Badge>
                  </div>
                  <p className="mt-2 font-mono text-xs text-ink-muted">
                    {zar(plan.base_fee_zar)} / mo · {nf(plan.included_credits)} credits
                    {plan.overage_discount_pct > 0
                      ? ` · ${plan.overage_discount_pct}% overage discount`
                      : ""}
                  </p>
                </div>

                {/* Toggles */}
                <div className="flex flex-col gap-3 sm:min-w-[260px]">
                  <label className="flex items-center justify-between gap-4">
                    <span className="text-[0.8rem] text-ink-soft">Show on pricing page</span>
                    <Switch
                      label={`Show ${plan.tier} on pricing page`}
                      checked={plan.public_visible}
                      disabled={savingKey === `${plan.tier}:public_visible`}
                      onChange={(v) => toggle(plan.tier, "public_visible", v)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4">
                    <span
                      className={`text-[0.8rem] ${
                        plan.public_visible ? "text-ink-soft" : "text-ink-muted"
                      }`}
                    >
                      Advertise price &amp; credits
                    </span>
                    <Switch
                      label={`Advertise ${plan.tier} price and credits`}
                      checked={plan.show_pricing}
                      disabled={
                        !plan.public_visible ||
                        savingKey === `${plan.tier}:show_pricing`
                      }
                      onChange={(v) => toggle(plan.tier, "show_pricing", v)}
                    />
                  </label>
                  {!plan.public_visible && (
                    <p className="text-[0.68rem] text-ink-muted">
                      Card is hidden, so this has no effect.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-[0.68rem] text-ink-muted">
        To negotiate per-client commercials, set overrides on the organisation&rsquo;s
        Plan &amp; billing card.
      </p>
    </div>
  );
}
