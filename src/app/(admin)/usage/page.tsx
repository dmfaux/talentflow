"use client";

import { useCallback, useEffect, useState } from "react";
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

interface SpendProjection {
  periodLabel: string;
  mtdCredits: number;
  mtdInclVat: number;
  projectedCredits: number;
  projectedInclVat: number;
  includedCredits: number;
  hardCeilingCredits: number | null;
  inFlightCount: number;
  costToFinishInclVat: number;
  paused: boolean;
  heldCount: number;
}

interface CampaignSpendRow {
  campaignId: string;
  roleTitle: string;
  clientName: string | null;
  credits: number;
  zarInclVat: number;
}

interface UsageData {
  spend: OrgSpend;
  projection: SpendProjection;
  campaigns: CampaignSpendRow[];
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
function credits(n: number): string {
  return Math.round(n).toLocaleString("en-ZA");
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
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/usage?days=${days}`)
      .then((r) => r.json())
      .then((res) => setData(res.data ?? null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => {
    if (!allowed) return;
    // load() flips a loading flag before an async fetch — the standard
    // fetch-on-mount/range-change idiom, not a render cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [allowed, load]);

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

  const spend = data?.spend ?? null;
  const projection = data?.projection ?? null;
  const campaigns = data?.campaigns ?? [];
  const maxTierZar = spend ? Math.max(1, ...spend.byTier.map((t) => t.zar)) : 1;

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
      ) : !spend ? (
        <div className="rounded-xl border border-rule bg-paper p-8 text-center">
          <p className="text-ink-muted text-[0.9rem]">Couldn&apos;t load usage. Try again shortly.</p>
        </div>
      ) : (
        <>
          {projection?.paused && (
            <div className="mb-6 rounded-xl border border-saffron/40 bg-saffron/10 px-5 py-4">
              <p className="text-[0.9rem] font-medium text-ink">
                Spend ceiling reached — new candidate intake is paused
              </p>
              <p className="mt-1 text-[0.82rem] text-ink-muted">
                {projection.heldCount > 0
                  ? `${projection.heldCount.toLocaleString("en-ZA")} application${
                      projection.heldCount === 1 ? "" : "s"
                    } held — they won't be scored until you raise the ceiling below. Candidates already in process and open chats continue.`
                  : "New applications won't be scored until you raise the ceiling below. Candidates already in process and open chats continue."}
              </p>
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard
              label="Spend (incl. VAT)"
              value={zar(spend.totalInclVat)}
              sub={`${zar(spend.subtotalExVat)} + ${zar(spend.vat)} VAT`}
              accent="text-ink"
            />
            <StatCard
              label="AI credits used"
              value={credits(spend.totalCredits)}
              sub="billed at R1.20 / credit (ex VAT)"
              accent="text-cobalt"
            />
            <StatCard
              label="≈ Candidates analysed"
              value={credits(spend.estCandidates)}
              sub="≈ 3–18 credits each, by tier"
              accent="text-moss"
            />
          </div>

          {projection && <ThisMonth p={projection} />}

          {projection && (
            <CeilingControls
              key={String(projection.hardCeilingCredits)}
              current={projection.hardCeilingCredits}
              onSaved={load}
            />
          )}

          <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[1.1rem] text-ink">Spend by intelligence tier</h2>
              <span className="font-mono text-[0.7rem] text-ink-faint uppercase tracking-wide">ex VAT</span>
            </div>
            {spend.totalCredits === 0 ? (
              <p className="text-ink-muted text-[0.88rem]">No AI usage recorded in this period yet.</p>
            ) : (
              <div className="space-y-4">
                {spend.byTier.map((t) => (
                  <div key={t.tier}>
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className="text-[0.88rem] text-ink-soft">{t.label}</span>
                      <span className="font-mono text-[0.9rem] text-ink">
                        {zar(t.zar)}
                        <span className="text-ink-faint ml-2 text-[0.78rem]">{credits(t.credits)} cr</span>
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
            )}
            <p className="mt-6 pt-5 border-t border-rule font-mono text-[0.7rem] text-ink-faint tracking-wide">
              CANDIDATE CHATS ALWAYS BILL AT ESSENTIAL · FIGURES ESTIMATED FROM METERED USAGE
            </p>
          </div>

          {campaigns.length > 0 && (
            <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
              <h2 className="font-display text-[1.1rem] text-ink mb-5">Spend by campaign</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.86rem]">
                  <thead>
                    <tr className="text-left text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint border-b border-rule">
                      <th className="pb-2 font-medium">Campaign</th>
                      <th className="pb-2 font-medium text-right">Credits</th>
                      <th className="pb-2 font-medium text-right">Spend (incl. VAT)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.campaignId} className="border-b border-rule/60 last:border-0">
                        <td className="py-2.5 pr-4">
                          <span className="text-ink-soft">{c.roleTitle}</span>
                          {c.clientName && <span className="text-ink-faint"> · {c.clientName}</span>}
                        </td>
                        <td className="py-2.5 text-right font-mono text-ink-muted">{credits(c.credits)}</td>
                        <td className="py-2.5 text-right font-mono text-ink">{zar(c.zarInclVat)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Spend-ceiling editor (owner self-service; Phase 4) ───────────────
function CeilingControls({ current, onSaved }: { current: number | null; onSaved: () => void }) {
  const [value, setValue] = useState(current != null ? String(current) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function save(next: number | null) {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hard_ceiling_credits: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setErr(d.error || "Could not save");
        return;
      }
      onSaved();
    } catch {
      setErr("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const parsed = value.trim() === "" ? null : Math.max(0, parseInt(value, 10) || 0);

  return (
    <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
      <h2 className="font-display text-[1.1rem] text-ink mb-1.5">Spend ceiling</h2>
      <p className="text-[0.82rem] text-ink-muted mb-4">
        New candidate intake pauses once this month&apos;s credits reach the ceiling. Candidates
        already in process and open chats always finish. Leave blank for no cap.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="number"
          min={0}
          step={1000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No ceiling"
          className="h-10 w-44 rounded-lg border border-rule bg-canvas px-3.5 font-mono text-sm text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-faint focus:border-cobalt"
        />
        <span className="text-[0.8rem] text-ink-faint">credits / month</span>
        <button
          type="button"
          onClick={() => save(parsed)}
          disabled={saving}
          className="h-9 rounded-lg bg-ink px-4 text-[0.8rem] font-medium text-canvas transition-colors hover:opacity-90 disabled:opacity-40 cursor-pointer"
        >
          Save
        </button>
        {current != null && (
          <button
            type="button"
            onClick={() => {
              setValue("");
              save(null);
            }}
            disabled={saving}
            className="h-9 rounded-lg border border-rule px-4 text-[0.8rem] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40 cursor-pointer"
          >
            Remove cap
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-[0.78rem] text-red">{err}</p>}
    </div>
  );
}

// ── This-month projection + allowance + pipeline ─────────────────────
function ThisMonth({ p }: { p: SpendProjection }) {
  const allowancePct = p.includedCredits > 0 ? Math.min(1, p.mtdCredits / p.includedCredits) : 0;
  const projOver = p.includedCredits > 0 && p.projectedCredits > p.includedCredits;
  const ceilingPct =
    p.hardCeilingCredits && p.hardCeilingCredits > 0
      ? Math.min(1, p.projectedCredits / p.hardCeilingCredits)
      : null;

  return (
    <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-display text-[1.1rem] text-ink">This month ({p.periodLabel})</h2>
        <span className="font-mono text-[0.7rem] text-ink-faint uppercase tracking-wide">run-rate projection</span>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Allowance drawdown */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[0.82rem] text-ink-muted">Included allowance used</span>
            <span className="font-mono text-[0.84rem] text-ink">
              {credits(p.mtdCredits)}
              {p.includedCredits > 0 && (
                <span className="text-ink-faint"> / {credits(p.includedCredits)} cr</span>
              )}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-canvas-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${allowancePct >= 1 ? "bg-saffron" : "bg-cobalt"}`}
              style={{ width: `${allowancePct * 100}%` }}
            />
          </div>
          <p className="mt-2 text-[0.76rem] text-ink-faint">
            {p.includedCredits > 0
              ? `${credits(Math.max(0, p.includedCredits - p.mtdCredits))} credits left in this month's allowance`
              : "Usage billed per credit; no included allowance on this plan"}
          </p>
        </div>

        {/* Projection vs ceiling */}
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[0.82rem] text-ink-muted">Projected month-end</span>
            <span className={`font-mono text-[0.84rem] ${projOver ? "text-saffron" : "text-ink"}`}>
              {credits(p.projectedCredits)} cr
              <span className="text-ink-faint"> · {zar(p.projectedInclVat)}</span>
            </span>
          </div>
          {ceilingPct !== null ? (
            <>
              <div className="h-2.5 rounded-full bg-canvas-2 overflow-hidden">
                <div
                  className={`h-full rounded-full ${ceilingPct >= 1 ? "bg-saffron" : "bg-ink/70"}`}
                  style={{ width: `${ceilingPct * 100}%` }}
                />
              </div>
              <p className="mt-2 text-[0.76rem] text-ink-faint">
                Spend ceiling at {credits(p.hardCeilingCredits!)} credits — new candidate intake pauses there.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[0.76rem] text-ink-faint">
              No spend ceiling set. Ask your operator to set one to cap a viral month.
            </p>
          )}
        </div>
      </div>

      {/* In-flight pipeline (viral-cap visibility) */}
      {p.inFlightCount > 0 && (
        <div className="mt-6 pt-5 border-t border-rule flex flex-wrap items-center justify-between gap-3">
          <p className="text-[0.86rem] text-ink-soft">
            <span className="font-medium text-ink">{p.inFlightCount.toLocaleString("en-ZA")}</span> candidate
            {p.inFlightCount === 1 ? "" : "s"} still in process
            <span className="text-ink-muted"> ≈ {zar(p.costToFinishInclVat)} to complete (incl. VAT)</span>
          </p>
          <span className="font-mono text-[0.68rem] text-ink-faint uppercase tracking-wide">
            in-flight scoring &amp; chats
          </span>
        </div>
      )}
    </div>
  );
}
