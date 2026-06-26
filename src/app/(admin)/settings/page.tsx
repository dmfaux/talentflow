"use client";

import { FormEvent, useState } from "react";
import { OrgSettingsCard } from "@/components/admin/org-settings-card";
import { ActiveBrandCard } from "@/components/admin/active-brand-card";
import { SpendAlertCard } from "@/components/admin/spend-alert-card";
import { Card, SectionHeading } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ConfirmModal } from "@/components/ui/confirm-modal";

interface AccessRecord {
  candidate_id: string;
  campaign: { role_title: string; slug: string; client_name: string | null };
  personal_data: { name: string; email: string; phone: string | null };
  application_data: { status: string; applied_at: string };
  ai_assessment: { score: number | null; confidence: string | null; rationale: string | null };
  consent: { popia_consent_at: string | null; data_purge_at: string | null; purged_at: string | null };
}

// Section icons — stroke="currentColor" so they inherit Ink Muted from SectionHeading.
const DocIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="2" width="10" height="12" rx="1.5" />
    <path d="M6 5h4M6 8h4M6 11h2" />
  </svg>
);
const ClockIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3l2 1.5" />
  </svg>
);
const PersonIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="5" r="2.5" />
    <path d="M3 14c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5" />
  </svg>
);

export default function SettingsPage() {
  const [lookupEmail, setLookupEmail] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ records: AccessRecord[] } | null>(null);
  const [lookupError, setLookupError] = useState("");

  const [deleteEmail, setDeleteEmail] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteResult, setDeleteResult] = useState("");

  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeResult, setPurgeResult] = useState("");

  async function handleLookup(e: FormEvent) {
    e.preventDefault();
    if (!lookupEmail) return;
    setLookupLoading(true);
    setLookupError("");
    setLookupResult(null);

    try {
      const res = await fetch("/api/admin/popia/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lookupEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLookupError(data.error || "No records found");
        return;
      }
      setLookupResult(data.data);
    } catch {
      setLookupError("Something went wrong");
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteEmail) return;
    setDeleteLoading(true);
    setDeleteResult("");

    try {
      const res = await fetch("/api/admin/popia/deletion-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: deleteEmail }),
      });
      const data = await res.json();
      setDeleteResult(data.data?.message || "Done");
      setShowDeleteConfirm(false);
      setDeleteEmail("");
    } catch {
      setDeleteResult("Deletion failed");
    } finally {
      setDeleteLoading(false);
    }
  }

  async function handlePurge() {
    setPurgeLoading(true);
    setPurgeResult("");

    try {
      const res = await fetch("/api/admin/popia/run-purge", { method: "POST" });
      const data = await res.json();
      setPurgeResult(data.data?.message || "Done");
    } catch {
      setPurgeResult("Purge failed");
    } finally {
      setPurgeLoading(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-ink">Settings</h1>
      <p className="mb-8 text-xs text-ink-muted">
        Organisation, brand, data privacy, and compliance controls
      </p>

      {/* ── Organization + Active brand (S9) ─────────────────── */}
      <OrgSettingsCard />
      <ActiveBrandCard />

      {/* ── Spend alerts (usage-based pricing, Phase 5) ───────── */}
      <SpendAlertCard />

      {/* ── POPIA data requests ─────────────────────────────── */}
      <Card className="mb-6">
        <SectionHeading title="POPIA data requests" icon={DocIcon} className="mb-5" />

        {/* Lookup */}
        <form onSubmit={handleLookup} className="mb-5">
          <label htmlFor="popia-lookup" className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">
            Look up candidate data
          </label>
          <div className="flex gap-2">
            <Input
              id="popia-lookup"
              type="email"
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.target.value)}
              placeholder="candidate@example.com"
            />
            <Button type="submit" loading={lookupLoading} disabled={!lookupEmail} className="shrink-0">
              Look up
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Returns all personal data held for this email across all campaigns
          </p>
        </form>

        {lookupError && (
          <Callout tone="warning" className="mb-4">
            {lookupError}
          </Callout>
        )}

        {lookupResult && (
          <div className="mb-5 space-y-3">
            <p className="text-xs font-medium text-ink-soft">
              Found {lookupResult.records.length} record(s)
            </p>
            {lookupResult.records.map((r) => (
              <div
                key={r.candidate_id}
                className="space-y-2 rounded-lg bg-canvas/40 p-4 text-xs"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{r.campaign.role_title}</span>
                  <span className="text-ink-muted">{r.campaign.client_name}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-ink-soft">
                  <div>
                    <span className="text-ink-muted">Name: </span>
                    {r.personal_data.name}
                  </div>
                  <div>
                    <span className="text-ink-muted">Status: </span>
                    {r.application_data.status}
                  </div>
                  <div>
                    <span className="text-ink-muted">Score: </span>
                    <span className="font-mono">
                      {r.ai_assessment.score?.toFixed(1) ?? "—"}
                    </span>
                  </div>
                </div>
                {r.consent.purged_at && (
                  <p className="font-mono text-[0.65rem] text-red">
                    Data purged on{" "}
                    {new Date(r.consent.purged_at).toLocaleDateString("en-ZA")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Deletion */}
        <div className="border-t border-rule pt-5">
          <label htmlFor="popia-delete" className="mb-1.5 block text-[0.8rem] font-medium text-ink-soft">
            Delete all data for a candidate
          </label>
          <div className="flex gap-2">
            <Input
              id="popia-delete"
              type="email"
              value={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.value)}
              placeholder="candidate@example.com"
            />
            <Button
              variant="danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!deleteEmail}
              className="shrink-0"
            >
              Delete all data
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            Permanently purges PII, CVs, messages, and scoring logs. Non-reversible.
          </p>
          {deleteResult && (
            <Callout tone="success" className="mt-3">
              {deleteResult}
            </Callout>
          )}
        </div>
      </Card>

      {/* ── Data retention ──────────────────────────────────── */}
      <Card className="mb-6">
        <SectionHeading title="Data retention" icon={ClockIcon} className="mb-5" />

        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-canvas/60 px-4 py-3">
          <div>
            <p className="text-sm text-ink">Default retention period</p>
            <p className="text-xs text-ink-muted">
              Candidate data is automatically purged after this period
            </p>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold text-ink">12 months</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm text-ink">Manual purge</p>
            <p className="text-xs text-ink-muted">
              Process all candidates past their retention date now
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={handlePurge}
            loading={purgeLoading}
            className="shrink-0"
          >
            Run purge
          </Button>
        </div>
        {purgeResult && (
          <Callout tone="success" className="mt-3">
            {purgeResult}
          </Callout>
        )}
      </Card>

      {/* ── Information officer ──────────────────────────────── */}
      <Card>
        <SectionHeading title="Information officer" icon={PersonIcon} className="mb-5" />

        <div className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Name</span>
            <span className="text-right text-ink">
              {process.env.NEXT_PUBLIC_INFO_OFFICER_NAME ?? "Not configured"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Registration number</span>
            <span className="text-right font-mono text-xs text-ink">
              {process.env.NEXT_PUBLIC_INFO_OFFICER_REG ?? "Not configured"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-ink-muted">Contact</span>
            <span className="text-right text-ink">
              {process.env.NEXT_PUBLIC_INFO_OFFICER_EMAIL ?? "Not configured"}
            </span>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-ink-muted">
          As per the Protection of Personal Information Act (POPIA), the Information Officer
          is responsible for ensuring compliance with data protection requirements.
          Contact details should be displayed on all data collection forms.
        </p>
      </Card>

      {/* Delete confirmation — shared ConfirmModal, echoes the target email. */}
      <ConfirmModal
        open={showDeleteConfirm}
        title="Confirm data deletion"
        description={
          <>
            This will permanently delete all personal data, CVs, messages, chat
            conversations, and scoring logs for{" "}
            <strong className="text-ink">{deleteEmail}</strong>. This action cannot
            be undone.
          </>
        }
        confirmLabel="Delete permanently"
        variant="danger"
        loading={deleteLoading}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
