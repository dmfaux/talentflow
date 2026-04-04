"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  candidateId: string;
  status: string;
  hasCv: boolean;
}

export function CandidateActions({ candidateId, status, hasCv }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState("");

  async function updateStatus(newStatus: string) {
    setLoading(newStatus);
    try {
      await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  async function downloadCv() {
    setLoading("cv");
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}/cv`);
      const { data } = await res.json();
      if (data?.url) window.open(data.url, "_blank");
    } finally {
      setLoading("");
    }
  }

  async function triggerFollowUp() {
    setLoading("followup");
    try {
      // This calls the existing follow-up logic via a simple status update
      await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "follow_up" }),
      });
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  const canShortlist = !["shortlisted", "rejected", "withdrawn", "gating_failed"].includes(status);
  const canReject = !["rejected", "withdrawn", "gating_failed"].includes(status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canShortlist && (
        <button
          onClick={() => updateStatus("shortlisted")}
          disabled={!!loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light cursor-pointer disabled:opacity-50"
        >
          {loading === "shortlisted" ? "..." : "Add to Shortlist"}
        </button>
      )}
      {canReject && (
        <button
          onClick={() => updateStatus("rejected")}
          disabled={!!loading}
          className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
        >
          Reject
        </button>
      )}
      <button
        onClick={triggerFollowUp}
        disabled={!!loading}
        className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-warning transition-colors hover:bg-warning-light cursor-pointer disabled:opacity-50"
      >
        Follow-up
      </button>
      {hasCv && (
        <button
          onClick={downloadCv}
          disabled={!!loading}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2v9M4.5 7.5L8 11l3.5-3.5M3 14h10" />
          </svg>
          CV
        </button>
      )}
    </div>
  );
}
