"use client";

import { FormEvent, useState } from "react";
import { OrgSettingsCard } from "@/components/admin/org-settings-card";
import { ActiveBrandCard } from "@/components/admin/active-brand-card";

interface AccessRecord {
  candidate_id: string;
  campaign: { role_title: string; slug: string; client_name: string | null };
  personal_data: { name: string; email: string; phone: string | null };
  application_data: { status: string; applied_at: string };
  ai_assessment: { score: number | null; confidence: string | null; rationale: string | null };
  consent: { popia_consent_at: string | null; data_purge_at: string | null; purged_at: string | null };
}

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

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20";

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-lg font-semibold text-charcoal">Settings</h1>
      <p className="mb-8 text-xs text-txt-muted">
        Organization, brand, data privacy, and compliance controls
      </p>

      {/* ── Organization + Active brand (S9) ─────────────────── */}
      <OrgSettingsCard />
      <ActiveBrandCard />

      {/* ── POPIA Data Requests ─────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-6">
        <div className="mb-5 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1b4332" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="2" width="10" height="12" rx="1.5" />
            <path d="M6 5h4M6 8h4M6 11h2" />
          </svg>
          <h2 className="text-sm font-semibold text-charcoal">
            POPIA Data Requests
          </h2>
        </div>

        {/* Lookup */}
        <form onSubmit={handleLookup} className="mb-5">
          <label className="mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
            Look Up Candidate Data
          </label>
          <div className="flex gap-2">
            <input
              type="email"
              value={lookupEmail}
              onChange={(e) => setLookupEmail(e.target.value)}
              placeholder="candidate@example.com"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={lookupLoading || !lookupEmail}
              className="inline-flex h-10 shrink-0 items-center rounded-lg bg-accent px-4 text-[0.78rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {lookupLoading ? "Looking up..." : "Look Up"}
            </button>
          </div>
          <p className="mt-1.5 text-[0.65rem] text-txt-muted">
            Returns all personal data held for this email across all campaigns
          </p>
        </form>

        {lookupError && (
          <div className="mb-4 rounded-lg bg-cream px-4 py-2.5 text-sm text-txt-secondary">
            {lookupError}
          </div>
        )}

        {lookupResult && (
          <div className="mb-5 space-y-3">
            <p className="text-xs font-medium text-txt-secondary">
              Found {lookupResult.records.length} record(s)
            </p>
            {lookupResult.records.map((r) => (
              <div
                key={r.candidate_id}
                className="rounded-lg border border-border p-4 text-xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-charcoal">
                    {r.campaign.role_title}
                  </span>
                  <span className="text-txt-muted">
                    {r.campaign.client_name}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-txt-secondary">
                  <div>
                    <span className="text-txt-muted">Name: </span>
                    {r.personal_data.name}
                  </div>
                  <div>
                    <span className="text-txt-muted">Status: </span>
                    {r.application_data.status}
                  </div>
                  <div>
                    <span className="text-txt-muted">Score: </span>
                    <span className="font-mono">
                      {r.ai_assessment.score?.toFixed(1) ?? "\u2014"}
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
        <div className="border-t border-border pt-5">
          <label className="mb-1.5 block text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
            Delete All Data for Candidate
          </label>
          <div className="flex gap-2">
            <input
              type="email"
              value={deleteEmail}
              onChange={(e) => setDeleteEmail(e.target.value)}
              placeholder="candidate@example.com"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={!deleteEmail}
              className="inline-flex h-10 shrink-0 items-center rounded-lg border border-red/20 px-4 text-[0.78rem] font-medium text-red transition-colors hover:bg-red-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              Delete All Data
            </button>
          </div>
          <p className="mt-1.5 text-[0.65rem] text-txt-muted">
            Permanently purges PII, CVs, messages, and scoring logs. Non-reversible.
          </p>
          {deleteResult && (
            <p className="mt-2 text-xs text-txt-secondary">{deleteResult}</p>
          )}
        </div>
      </div>

      {/* ── Data Retention ──────────────────────────────────── */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-6">
        <div className="mb-5 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1b4332" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3l2 1.5" />
          </svg>
          <h2 className="text-sm font-semibold text-charcoal">
            Data Retention
          </h2>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-lg bg-cream/60 px-4 py-3">
          <div>
            <p className="text-sm text-charcoal">Default Retention Period</p>
            <p className="text-[0.65rem] text-txt-muted">
              Candidate data is automatically purged after this period
            </p>
          </div>
          <span className="font-mono text-sm font-semibold text-charcoal">
            12 months
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-charcoal">Manual Purge</p>
            <p className="text-[0.65rem] text-txt-muted">
              Process all candidates past their retention date now
            </p>
          </div>
          <button
            onClick={handlePurge}
            disabled={purgeLoading}
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {purgeLoading ? "Running..." : "Run Purge Now"}
          </button>
        </div>
        {purgeResult && (
          <p className="mt-3 text-xs text-txt-secondary">{purgeResult}</p>
        )}
      </div>

      {/* ── Information Officer ──────────────────────────────── */}
      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="mb-5 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1b4332" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="5" r="2.5" />
            <path d="M3 14c0-3 2.2-4.5 5-4.5s5 1.5 5 4.5" />
          </svg>
          <h2 className="text-sm font-semibold text-charcoal">
            Information Officer
          </h2>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-txt-muted">Name</span>
            <span className="text-charcoal">
              {process.env.NEXT_PUBLIC_INFO_OFFICER_NAME ?? "Not configured"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-txt-muted">Registration Number</span>
            <span className="font-mono text-xs text-charcoal">
              {process.env.NEXT_PUBLIC_INFO_OFFICER_REG ?? "Not configured"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-txt-muted">Contact</span>
            <span className="text-charcoal">
              {process.env.NEXT_PUBLIC_INFO_OFFICER_EMAIL ?? "Not configured"}
            </span>
          </div>
        </div>

        <p className="mt-4 text-[0.65rem] leading-relaxed text-txt-muted">
          As per the Protection of Personal Information Act (POPIA), the Information Officer
          is responsible for ensuring compliance with data protection requirements.
          Contact details should be displayed on all data collection forms.
        </p>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-charcoal">
              Confirm Data Deletion
            </h3>
            <p className="mt-2 text-sm text-txt-secondary">
              This will permanently delete all personal data, CVs, messages, and scoring
              logs for <strong className="text-charcoal">{deleteEmail}</strong>.
              This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                className="inline-flex h-9 items-center rounded-lg bg-red px-4 text-[0.78rem] font-medium text-white transition-colors hover:bg-red/90 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {deleteLoading ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
