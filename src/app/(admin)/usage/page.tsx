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
  // Optional on the wire: an older API response (mid hot-reload or mid-deploy)
  // may predate these fields, so the component derives safe fallbacks.
  overageCredits?: number;
  creditPriceInclVat?: number;
  hardCeilingCredits: number | null;
  inFlightCount: number;
  costToFinishInclVat: number;
  costToFinishCredits?: number;
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
      <div className="mb-8">
        <h1 className="font-display text-[1.9rem] text-ink tracking-tight">Usage &amp; Spend</h1>
        <p className="mt-1.5 text-ink-muted text-[0.9rem]">
          How much of your monthly AI allowance you&apos;ve used, and whether anything costs extra.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="h-56 rounded-2xl border border-rule bg-paper animate-pulse" />
          <div className="grid sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-28 rounded-xl border border-rule bg-paper animate-pulse" />
            ))}
          </div>
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
                Usage cap reached — new candidate intake is paused
              </p>
              <p className="mt-1 text-[0.82rem] text-ink-muted">
                {projection.heldCount > 0
                  ? `${projection.heldCount.toLocaleString("en-ZA")} application${
                      projection.heldCount === 1 ? "" : "s"
                    } held — they won't be scored until you raise the cap below. Candidates already in process and open chats continue.`
                  : "New applications won't be scored until you raise the cap below. Candidates already in process and open chats continue."}
              </p>
            </div>
          )}
          {projection && <AllowanceHero p={projection} />}

          {projection && (
            <CeilingControls
              key={String(projection.hardCeilingCredits)}
              current={projection.hardCeilingCredits}
              onSaved={load}
            />
          )}

          <div className="mt-10 mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[0.7rem] text-ink-faint uppercase tracking-[0.12em]">
                Usage history
              </p>
              <h2 className="mt-1 font-display text-[1.25rem] text-ink">Last {days} days</h2>
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

          <div className="grid sm:grid-cols-3 gap-4">
            <StatCard
              label="AI credits used"
              value={credits(spend.totalCredits)}
              sub={`in the last ${days} days`}
              accent="text-cobalt"
            />
            <StatCard
              label="Candidates analysed"
              value={credits(spend.estCandidates)}
              sub="≈ 3–18 credits each, by tier"
              accent="text-moss"
            />
            <StatCard
              label="Usage value (incl. VAT)"
              value={zar(spend.totalInclVat)}
              sub={(projection?.includedCredits ?? 0) > 0 ? "Included in your plan" : "Billed this period"}
              accent="text-ink"
            />
          </div>

          <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[1.1rem] text-ink">Usage by intelligence tier</h2>
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
              CANDIDATE CHATS ALWAYS COUNT AT THE ESSENTIAL RATE · ESTIMATED FROM METERED USAGE
            </p>
          </div>

          {campaigns.length > 0 && (
            <div className="mt-8 rounded-2xl border border-rule bg-paper p-6">
              <h2 className="font-display text-[1.1rem] text-ink mb-5">Usage by campaign</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[0.86rem]">
                  <thead>
                    <tr className="text-left text-[0.7rem] uppercase tracking-[0.1em] text-ink-faint border-b border-rule">
                      <th className="pb-2 font-medium">Campaign</th>
                      <th className="pb-2 font-medium text-right">Credits</th>
                      <th className="pb-2 font-medium text-right">Value (incl. VAT)</th>
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
      <h2 className="font-display text-[1.1rem] text-ink mb-1.5">Monthly usage cap</h2>
      <p className="text-[0.82rem] text-ink-muted mb-4">
        Pause new candidate intake once this month&apos;s usage reaches a credit cap you set.
        Candidates already in process and open chats always finish. Leave blank for no cap — your
        included allowance still applies.
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          type="number"
          min={0}
          step={1000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="No cap"
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

// ── This-month allowance: what's included, and what (if anything) costs extra ──
//
// The page's trust anchor. Within the allowance the largest figure on the page
// is a green "R0" — usage is included; the only path to an extra charge (passing
// the allowance, then R{creditPriceInclVat}/credit) is stated plainly. Flips to an
// honest overage readout once the allowance is genuinely used up.
function AllowanceHero({ p }: { p: SpendProjection }) {
  const metered = p.includedCredits <= 0;
  // Derive fallbacks for the newer projection fields so a brief client/server
  // shape skew (hot-reload or deploy) degrades gracefully instead of crashing.
  // The credit price falls back to the exact rate implied by month-to-date usage.
  const creditPriceInclVat =
    p.creditPriceInclVat ?? (p.mtdCredits > 0 ? p.mtdInclVat / p.mtdCredits : 1.38);
  const overageCredits =
    p.overageCredits ?? (metered ? 0 : Math.max(0, p.mtdCredits - p.includedCredits));
  const costToFinishCredits = p.costToFinishCredits ?? 0;
  const usedPct = metered ? 0 : Math.min(1, p.mtdCredits / p.includedCredits);
  const remaining = Math.max(0, p.includedCredits - p.mtdCredits);
  const overNow = overageCredits > 0;
  const projExtra = metered ? 0 : p.projectedCredits - p.includedCredits;
  const projOver = projExtra >= 0.5;
  const unitPrice = `R${creditPriceInclVat.toFixed(2)}`;
  const hasCeiling = p.hardCeilingCredits != null && p.hardCeilingCredits > 0;

  const pill = metered
    ? { text: "Pay as you go", cls: "bg-cobalt/10 text-cobalt border-cobalt/25" }
    : overNow
      ? { text: "Allowance used up", cls: "bg-saffron/10 text-saffron border-saffron/30" }
      : { text: "Included in your plan", cls: "bg-moss/10 text-moss border-moss/30" };

  return (
    <div className="rounded-2xl border border-rule bg-paper p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[0.7rem] text-ink-faint uppercase tracking-[0.12em]">
          This month · {p.periodLabel}
        </span>
        <span
          className={`rounded-full border px-2.5 py-1 font-mono text-[0.62rem] uppercase tracking-[0.1em] ${pill.cls}`}
        >
          {pill.text}
        </span>
      </div>

      <h2 className="mt-3 font-display text-[1.6rem] sm:text-[1.8rem] leading-tight tracking-tight text-ink">
        {metered
          ? `${zar(p.mtdInclVat)} used this month`
          : `${credits(p.mtdCredits)} of ${credits(p.includedCredits)} credits used`}
      </h2>
      <p className="mt-1.5 max-w-[48ch] text-[0.92rem] text-ink-muted">
        {metered
          ? "Pay-as-you-go usage — this is your running total for the month."
          : overNow
            ? "You've used your full monthly allowance. Anything beyond it is billed below."
            : "Everything you've used is included in your subscription — no extra charge."}
      </p>

      {!metered && (
        <div className="mt-5">
          <div className="h-2.5 rounded-full bg-canvas-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${overNow ? "bg-saffron" : "bg-cobalt"}`}
              style={{ width: `${Math.max(usedPct * 100, p.mtdCredits > 0 ? 1.5 : 0)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between font-mono text-[0.72rem] text-ink-faint">
            <span>{credits(p.mtdCredits)} used</span>
            <span>
              {overNow
                ? `${credits(overageCredits)} over allowance`
                : `${credits(remaining)} still included`}
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 border-t border-rule pt-6 sm:grid-cols-2">
        {/* What lands on top of the subscription — the question users actually have */}
        <div>
          <p className="font-mono text-[0.68rem] text-ink-faint uppercase tracking-[0.1em]">
            {metered ? "Billed this month" : "Extra charges this month"}
          </p>
          <p
            className={`mt-1.5 font-display text-[2rem] leading-none tracking-tight ${
              metered ? "text-ink" : overNow ? "text-saffron" : "text-moss"
            }`}
          >
            {metered ? zar(p.mtdInclVat) : overNow ? zar(overageCredits * creditPriceInclVat) : "R0"}
          </p>
          <p className="mt-2 max-w-[42ch] text-[0.78rem] text-ink-muted">
            {metered
              ? "Charged on your monthly invoice, incl. VAT."
              : overNow
                ? `${credits(overageCredits)} credits past your ${credits(
                    p.includedCredits,
                  )} allowance, at ${unitPrice} / credit incl. VAT.`
                : `You only pay more if you pass ${credits(
                    p.includedCredits,
                  )} credits this month. After that it's ${unitPrice} per credit, incl. VAT.`}
          </p>
        </div>

        {/* Where the month is heading */}
        <div className="sm:border-l sm:border-rule sm:pl-6">
          <p className="font-mono text-[0.68rem] text-ink-faint uppercase tracking-[0.1em]">
            Projected this month
          </p>
          <p
            className={`mt-1.5 font-display text-[2rem] leading-none tracking-tight ${
              projOver ? "text-saffron" : "text-ink"
            }`}
          >
            {metered ? zar(p.projectedInclVat) : `≈ ${credits(p.projectedCredits)} cr`}
          </p>
          <p className="mt-2 max-w-[42ch] text-[0.78rem] text-ink-muted">
            {metered
              ? "At your current pace, incl. VAT."
              : projOver
                ? `About ${credits(projExtra)} credits over your allowance at this pace — roughly ${zar(
                    projExtra * creditPriceInclVat,
                  )} extra, incl. VAT.`
                : `Comfortably within your ${credits(p.includedCredits)} allowance.`}
            {hasCeiling ? ` Intake pauses at your ${credits(p.hardCeilingCredits!)}-credit cap.` : ""}
          </p>
        </div>
      </div>

      {p.inFlightCount > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-rule pt-5">
          <p className="text-[0.84rem] text-ink-soft">
            <span className="font-medium text-ink">{p.inFlightCount.toLocaleString("en-ZA")}</span> candidate
            {p.inFlightCount === 1 ? "" : "s"} still in process
            <span className="text-ink-muted">
              {metered
                ? ` · ≈ ${zar(p.costToFinishInclVat)} to finish, incl. VAT`
                : ` · ≈ ${credits(costToFinishCredits)} credits to finish, from your allowance`}
            </span>
          </p>
          <span className="font-mono text-[0.66rem] text-ink-faint uppercase tracking-wide">
            in-flight scoring &amp; chats
          </span>
        </div>
      )}
    </div>
  );
}
