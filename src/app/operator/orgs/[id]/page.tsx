"use client";

import { TierBadge, type Tier } from "@/components/admin/tier-badge";
import { ImpersonateButton } from "@/components/operator/impersonate-button";
import { LifecycleActions } from "@/components/operator/lifecycle-actions";
import { ThemesCard, type ThemeBrand } from "@/components/operator/themes-card";
import { useToast } from "@/components/ui/toast-provider";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

interface OrgOwner {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
}
interface PendingInvite {
  email: string;
  expires_at: string;
}
type UsageKind =
  | "ai_tokens"
  | "campaign_created"
  | "candidate_created"
  | "chat_message"
  | "email_sent";
interface OrgUsage {
  period: string;
  byKind: Record<
    UsageKind,
    { count: number; inputTokens: number; outputTokens: number }
  >;
  tokens: { input: number; output: number };
  allTime: { input: number; output: number };
}
interface OrgSpendMargin {
  period: string;
  credits: number;
  billedExVat: number;
  rawCostZar: number;
  marginZar: number;
  marginPct: number;
}
type ModelTier = "essential" | "professional" | "executive";
interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  tier: string;
  status: string;
  billing_email: string | null;
  operator_max_model_tier: string;
  hard_ceiling_credits: number | null;
  suspended_at: string | null;
  deleted_at: string | null;
  created_at: string;
  counts: { brands: number; campaigns: number; candidates: number };
  brands: ThemeBrand[];
  owner: OrgOwner | null;
  pendingInvite: PendingInvite | null;
  usage: OrgUsage;
  spend: OrgSpendMargin;
}

const TIER_OPTIONS: Array<{ value: Tier; label: string; helper: string }> = [
  { value: "standard", label: "Standard", helper: "Shared templates · pay per campaign" },
  { value: "premium", label: "Premium", helper: "One bespoke template · reduced rate" },
  { value: "enterprise", label: "Enterprise", helper: "Retainer · unlimited & bespoke" },
];

const MODEL_TIER_OPTIONS: Array<{ value: ModelTier; label: string }> = [
  { value: "essential", label: "Essential" },
  { value: "professional", label: "Professional" },
  { value: "executive", label: "Executive" },
];
const isModelTierValue = (v: string): v is ModelTier =>
  v === "essential" || v === "professional" || v === "executive";
const zar = (n: number) => "R" + Math.round(n).toLocaleString("en-ZA");

const STATUS_BADGE: Record<string, string> = {
  active: "bg-green-light text-green",
  suspended: "bg-warning-light text-warning",
  deleted: "bg-red-light text-red",
};

function normaliseTier(v: string): Tier {
  return v === "premium" || v === "enterprise" ? v : "standard";
}

export default function OperatorOrgDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [tier, setTier] = useState<Tier>("standard");
  const [billingEmail, setBillingEmail] = useState("");
  const [operatorMaxTier, setOperatorMaxTier] = useState<ModelTier>("executive");
  const [hardCeiling, setHardCeiling] = useState("");
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    fetch(`/api/operator/organizations/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(({ data }: { data: OrgDetail }) => {
        setOrg(data);
        setTier(normaliseTier(data.tier));
        setBillingEmail(data.billing_email ?? "");
        setOperatorMaxTier(
          isModelTierValue(data.operator_max_model_tier)
            ? data.operator_max_model_tier
            : "executive"
        );
        setHardCeiling(
          data.hard_ceiling_credits != null ? String(data.hard_ceiling_credits) : ""
        );
      })
      .catch(() => setLoadError("Organisation not found"))
      .finally(() => setLoading(false));
  }, [id]);

  const ceilingValue =
    hardCeiling.trim() === "" ? null : Math.max(0, parseInt(hardCeiling, 10) || 0);
  const orgOperatorMaxTier =
    org && isModelTierValue(org.operator_max_model_tier)
      ? org.operator_max_model_tier
      : "executive";
  const dirty =
    !!org &&
    (tier !== normaliseTier(org.tier) ||
      (billingEmail.trim() || null) !== (org.billing_email ?? null) ||
      operatorMaxTier !== orgOperatorMaxTier ||
      ceilingValue !== (org.hard_ceiling_credits ?? null));

  async function save() {
    if (!org) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/operator/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier,
          billing_email: billingEmail.trim() || null,
          operator_max_model_tier: operatorMaxTier,
          hard_ceiling_credits: ceilingValue,
        }),
      });
      const { data, error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not save", "error");
        return;
      }
      setOrg((prev) => (prev ? { ...prev, ...data } : prev));
      setBillingEmail(data.billing_email ?? "");
      setHardCeiling(
        data.hard_ceiling_credits != null ? String(data.hard_ceiling_credits) : ""
      );
      toast("Billing settings updated", "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite() {
    if (!org) return;
    setResending(true);
    try {
      const res = await fetch(`/api/operator/organizations/${id}/resend-invite`, {
        method: "POST",
      });
      const { data, error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not resend the invite", "error");
        return;
      }
      setOrg((prev) =>
        prev ? { ...prev, pendingInvite: data.invite } : prev
      );
      toast("Invitation resent", "success");
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setResending(false);
    }
  }

  if (loading) {
    return <div className="py-24 text-center text-sm text-ink-muted">Loading…</div>;
  }
  if (loadError || !org) {
    return <div className="py-24 text-center text-sm text-red">{loadError || "Organisation not found"}</div>;
  }

  const counts = [
    { label: "Brands", value: org.counts.brands },
    { label: "Campaigns", value: org.counts.campaigns },
    { label: "Candidates", value: org.counts.candidates },
  ];

  const nf = (n: number) => n.toLocaleString("en-ZA");
  const { usage, spend } = org;
  const usageRows = [
    { label: "AI calls", value: usage.byKind.ai_tokens.count },
    { label: "Candidates created", value: usage.byKind.candidate_created.count },
    { label: "Campaigns created", value: usage.byKind.campaign_created.count },
    { label: "Chat messages", value: usage.byKind.chat_message.count },
    { label: "Emails sent", value: usage.byKind.email_sent.count },
  ];
  const hasUsage =
    usage.tokens.input > 0 ||
    usage.tokens.output > 0 ||
    usageRows.some((r) => r.value > 0);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-5 flex items-center gap-2 text-xs text-ink-muted">
        <Link href="/operator" className="hover:text-ink transition-colors">Organisations</Link>
        <span>/</span>
        <span className="font-mono text-ink-soft">{org.slug}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-2xl text-ink">{org.name}</h1>
            <TierBadge tier={org.tier} size="md" />
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.1em] ${STATUS_BADGE[org.status] ?? "bg-canvas-2 text-ink-muted"}`}>
              {org.status}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-xs text-ink-muted">
            {org.slug} · created {new Date(org.created_at).toLocaleDateString("en-ZA")}
          </p>
        </div>
        <ImpersonateButton orgId={org.id} orgName={org.name} status={org.status} />
      </div>

      {/* Counts */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {counts.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">{c.label}</p>
            <p className="mt-1 font-mono text-2xl text-ink">{c.value}</p>
          </div>
        ))}
      </div>

      {/* Onboarding — accepted Owner vs pending invite + resend (S9) */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-lg text-ink">Onboarding</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              The org Owner — provisioned via an invitation they accept to set a password.
            </p>
          </div>
          {org.owner ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-light px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-green">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green" />
              Owner active
            </span>
          ) : org.pendingInvite ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-light px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-warning">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
              Invite pending
            </span>
          ) : null}
        </div>

        <div className="mt-4">
          {org.owner ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-cream/40 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-ink">
                  {`${org.owner.first_name} ${org.owner.last_name}`.trim() || "Owner"}
                </p>
                <p className="font-mono text-xs text-ink-muted">{org.owner.email}</p>
              </div>
            </div>
          ) : org.pendingInvite ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-cream/40 px-4 py-3">
              <div>
                <p className="font-mono text-sm text-ink">{org.pendingInvite.email}</p>
                <p className="mt-0.5 text-[0.7rem] text-ink-muted">
                  Invite expires{" "}
                  {new Date(org.pendingInvite.expires_at).toLocaleDateString("en-ZA")}
                </p>
              </div>
              <button
                onClick={resendInvite}
                disabled={resending}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-[0.8rem] font-medium text-ink-soft transition-colors hover:bg-canvas disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
              >
                {resending && (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                Resend invite
              </button>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-ink-muted">
              No owner has been provisioned for this organisation yet.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Billing / tier */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="font-serif text-lg text-ink">Plan & billing</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tier is operator-set on the organisation (the authoritative copy).
          </p>

          <div className="mt-5">
            <label className="mb-2 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">Tier</label>
            <div className="grid grid-cols-3 gap-2">
              {TIER_OPTIONS.map((opt) => {
                const selected = tier === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTier(opt.value)}
                    className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                      selected ? "border-cobalt bg-cobalt-tint" : "border-border bg-paper hover:border-border-strong"
                    }`}
                  >
                    <span className="text-[0.8rem] font-semibold text-ink">{opt.label}</span>
                    <span className="text-[0.68rem] leading-snug text-ink-muted">{opt.helper}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5">
            <label htmlFor="billing_email" className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Billing email
            </label>
            <input
              id="billing_email"
              type="email"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="billing@example.com"
              className="h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 font-mono text-sm text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
            />
          </div>

          <div className="mt-5">
            <label className="mb-2 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Max model tier (vendor cap)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_TIER_OPTIONS.map((opt) => {
                const selected = operatorMaxTier === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setOperatorMaxTier(opt.value)}
                    className={`rounded-lg border px-3 py-2 text-[0.8rem] font-medium transition-colors cursor-pointer ${
                      selected
                        ? "border-cobalt bg-cobalt-tint text-ink"
                        : "border-border bg-paper text-ink-soft hover:border-border-strong"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[0.68rem] text-ink-muted">
              Caps which intelligence tiers this org&apos;s campaigns can select.
            </p>
          </div>

          <div className="mt-5">
            <label htmlFor="hard_ceiling" className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              Spend ceiling (credits / month)
            </label>
            <input
              id="hard_ceiling"
              type="number"
              min={0}
              step={1000}
              value={hardCeiling}
              onChange={(e) => setHardCeiling(e.target.value)}
              placeholder="No ceiling"
              className="h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 font-mono text-sm text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-muted focus:border-cobalt focus:ring-1 focus:ring-cobalt/20"
            />
            <p className="mt-1.5 text-[0.68rem] text-ink-muted">
              New candidate intake pauses past this. Blank = uncapped (plan default).
            </p>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-cobalt px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-cobalt-deep disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
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
        </div>

        {/* Usage (S10) — per-org AI token + volume metering */}
        <div className="rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-lg text-ink">Usage</h2>
            <span className="rounded-full bg-canvas-2 px-2 py-0.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-ink-muted">
              Last 30 days
            </span>
          </div>

          {/* AI tokens — the headline cost signal */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-cream/40 p-3.5">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Input tokens
              </p>
              <p className="mt-1 font-mono text-xl tabular-nums text-ink">
                {nf(usage.tokens.input)}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-cream/40 p-3.5">
              <p className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                Output tokens
              </p>
              <p className="mt-1 font-mono text-xl tabular-nums text-ink">
                {nf(usage.tokens.output)}
              </p>
            </div>
          </div>
          <p className="mt-2.5 text-[0.7rem] text-ink-muted">
            All time&nbsp;·&nbsp;
            <span className="font-mono text-ink-soft">{nf(usage.allTime.input)}</span> in&nbsp;/&nbsp;
            <span className="font-mono text-ink-soft">{nf(usage.allTime.output)}</span> out
          </p>

          {/* Operator-only: billed spend vs raw model cost (last 30 days). */}
          <div className="mt-4 rounded-lg border border-border bg-cream/40 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[0.7rem] text-ink-soft">Billed (ex VAT)</span>
              <span className="font-mono text-sm tabular-nums text-ink">{zar(spend.billedExVat)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-[0.7rem] text-ink-soft">Raw model cost</span>
              <span className="font-mono text-sm tabular-nums text-ink-soft">{zar(spend.rawCostZar)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5">
              <span className="text-[0.7rem] font-semibold text-ink">Margin</span>
              <span className="font-mono text-sm tabular-nums text-green">
                {zar(spend.marginZar)}
                <span className="text-ink-muted"> · {Math.round(spend.marginPct * 100)}%</span>
              </span>
            </div>
            <p className="mt-2 text-[0.62rem] uppercase tracking-[0.12em] text-ink-muted">
              {nf(Math.round(spend.credits))} credits · operator-only
            </p>
          </div>

          {/* Per-kind volume */}
          <dl className="mt-5 space-y-2.5 border-t border-border pt-4">
            {usageRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between">
                <dt className="text-[0.8rem] text-ink-soft">{row.label}</dt>
                <dd className="font-mono text-sm tabular-nums text-ink">
                  {nf(row.value)}
                </dd>
              </div>
            ))}
          </dl>

          {!hasUsage && (
            <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-center text-[0.78rem] text-ink-muted">
              No usage recorded in the last 30 days.
            </p>
          )}
        </div>
      </div>

      {/* Themes — per-brand default campaign theme + bespoke builds (CT2) */}
      <div className="mt-6">
        <ThemesCard orgId={org.id} tier={org.tier} brands={org.brands} />
      </div>

      {/* Lifecycle — suspend / soft-delete / restore / purge (S11) */}
      <div className="mt-6">
        <LifecycleActions
          orgId={org.id}
          orgName={org.name}
          orgSlug={org.slug}
          status={org.status}
          onChanged={(updated) =>
            setOrg((prev) => (prev ? { ...prev, ...updated } : prev))
          }
        />
      </div>
    </div>
  );
}
