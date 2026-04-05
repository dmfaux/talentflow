"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast-provider";

interface Props {
  candidateId: string;
  status: string;
  hasCv: boolean;
}

export function CandidateActions({ candidateId, status, hasCv }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);

  async function updateStatus(newStatus: string) {
    setLoading(newStatus);
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast(
          newStatus === "shortlisted" ? "Candidate added to shortlist" :
          newStatus === "rejected" ? "Candidate rejected" :
          "Status updated",
          newStatus === "shortlisted" ? "success" : newStatus === "rejected" ? "warning" : "info"
        );
      }
      router.refresh();
    } finally {
      setLoading("");
      setConfirmReject(false);
    }
  }

  async function downloadCv() {
    setLoading("cv");
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}/cv`);
      const { data } = await res.json();
      if (data?.url) window.open(data.url, "_blank");
      else toast("No CV available", "error");
    } finally {
      setLoading("");
    }
  }

  const canShortlist = !["shortlisted", "rejected", "withdrawn", "gating_failed"].includes(status);
  const canReject = !["rejected", "withdrawn", "gating_failed"].includes(status);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canShortlist && (
          <button
            onClick={() => updateStatus("shortlisted")}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[0.75rem] font-medium text-ink transition-colors hover:bg-accent-light hover:text-white cursor-pointer disabled:opacity-50"
          >
            {loading === "shortlisted" ? "..." : "Add to Shortlist"}
          </button>
        )}
        {canReject && (
          <button
            onClick={() => setConfirmReject(true)}
            disabled={!!loading}
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
          >
            Reject
          </button>
        )}
        <button
          onClick={() => updateStatus("follow_up")}
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

      <ConfirmModal
        open={confirmReject}
        title="Reject Candidate"
        description="This will mark the candidate as rejected. They will not appear in the shortlist. This can be reversed by changing their status later."
        confirmLabel="Reject"
        variant="danger"
        loading={loading === "rejected"}
        onConfirm={() => updateStatus("rejected")}
        onCancel={() => setConfirmReject(false)}
      />
    </>
  );
}
