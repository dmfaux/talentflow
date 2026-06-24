"use client";

import { useEffect, useState } from "react";
import { canManageOrg, useTenant } from "@/components/admin/tenant-provider";

type ModelTier = "essential" | "professional" | "executive";

interface TierSpend {
  tier: ModelTier;
  label: string;
  credits: number;
  zar: number;
}

interface OrgSpend {
  periodDays: number;
  totalCredits: number;
  estCandidates: number;
  byTier: TierSpend[];
  subtotalExVat: number;
  vat: number;
  totalInclVat: number;
}

const RANGES = [7, 30, 90] as const;

const TIER_BAR: Record<ModelTier, string> = {
  essential: "bg-moss",
  professional: "bg-cobalt",
  executive: "bg-saffron",
};

function zar(n: number): string {
  return "R" + Math.round(n).toLocaleString("en-ZA");
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-xl border border-rule bg-paper p-5">
      <p className="text-[0.78rem] text-ink-muted">{label}</p>
      <p className={`mt-2 font-display text-[2rem] leading-none tracking-tight ${accent}`}>{value}</p>
      <p className="mt-2 text-[0.74rem] text-ink-faint">{sub}</p>
    </div>
  );
}

export default function UsagePage() {
  const tenant = useTenant();
  const allowed = canManageOrg(tenant);
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<OrgSpend | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    fetch(`/api/admin/usage?days=${days}`)
      .then((r) => r.json())
      .then((res) => setData(res.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days, allowed]);

  if (!allowed) {
    return (
      <div className="p-6 sm:p-8">
        <h1 className="font-display text-[1.9rem] text-ink tracking-tight">Usage &amp; Spend</h1>
        <p className="mt-2 text-ink-muted text-[0.9rem]">
          Spend is visible to organisation owners and admins.
        </p>
      </div>
    );
  }

  const maxTierZar = data ? Math.max(1, ...data.byTier.map((t) => t.zar)) : 1;

  return (
    <div className="p-6 sm:p-8 max-w-[1100px]">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-[1.9rem] text-ink tracking-tight">Usage &amp; Spend</h1>
          <p className="mt-1.5 text-ink-muted text-[0.9rem]">
            Estimated AI spend for the last {days} days. Final amounts appear on your monthly invoice.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-rule bg-paper p-1">
          {RANGES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`px-3.5 h-8 rounded-full text-[0.8rem] font-medium transition-colors cursor-pointer ${
                days === d ? "bg-ink text-canvas" : "text-ink-muted hover:text-ink"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-rule bg-paper animate-pulse" />
          ))}
        </div>
      ) : !data || data.totalCredits === 0 ? (
        <div className="rounded-xl border border-rule bg-paper p-8 text-center">
          <p className="text-ink-muted text-[0.9rem]">No AI usage recorded in this period yet.</p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard
              label="Spend (incl. VAT)"
              value={zar(data.totalInclVat)}
              sub={`${zar(data.subtotalExVat)} + ${zar(data.vat)} VAT`}
              accent="text-ink"
            />
            <StatCard
              label="AI credits used"
              value={Math.round(data.totalCredits).toLocaleString("en-ZA")}
              sub="billed at R1.20 / credit (ex VAT)"
              accent="text-cobalt"
            />
            <StatCard
              label="≈ Candidates analysed"
              value={Math.round(data.estCandidates).toLocaleString("en-ZA")}
              sub="≈ 3–18 credits each, by tier"
              accent="text-moss"
            />
          </div>

          <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[1.1rem] text-ink">Spend by intelligence tier</h2>
              <span className="font-mono text-[0.7rem] text-ink-faint uppercase tracking-wide">ex VAT</span>
            </div>
            <div className="space-y-4">
              {data.byTier.map((t) => (
                <div key={t.tier}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-[0.88rem] text-ink-soft">{t.label}</span>
                    <span className="font-mono text-[0.9rem] text-ink">
                      {zar(t.zar)}
                      <span className="text-ink-faint ml-2 text-[0.78rem]">
                        {Math.round(t.credits).toLocaleString("en-ZA")} cr
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-canvas-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${TIER_BAR[t.tier]}`}
                      style={{ width: `${(t.zar / maxTierZar) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-6 pt-5 border-t border-rule font-mono text-[0.7rem] text-ink-faint tracking-wide">
              CANDIDATE CHATS ALWAYS BILL AT ESSENTIAL · FIGURES ESTIMATED FROM METERED USAGE
            </p>
          </div>
        </>
      )}
    </div>
  );
}
