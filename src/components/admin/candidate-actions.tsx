"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
  const [rejectionReason, setRejectionReason] = useState("");

  async function updateStatus(newStatus: string, extra?: Record<string, string>) {
    setLoading(newStatus);
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, ...extra }),
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
      setRejectionReason("");
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
  const canOpenChat = !["gating_failed", "withdrawn", "rejected"].includes(status);

  async function openChat() {
    setLoading("open-chat");
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}/open-chat`, { method: "POST" });
      if (res.ok) {
        const { data } = await res.json();
        toast(
          data.existing
            ? "Chat already active — invitation resent"
            : "Chat opened — invitation sent to candidate",
          "success"
        );
      } else {
        toast("Failed to open chat", "error");
      }
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canOpenChat && (
          <button
            onClick={openChat}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 10a1.5 1.5 0 01-1.5 1.5H5L2 14V3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5z" />
            </svg>
            {loading === "open-chat" ? "..." : "Open Chat"}
          </button>
        )}
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
            onClick={() => setConfirmReject(true)}
            disabled={!!loading}
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
          >
            Reject
          </button>
        )}
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

      {confirmReject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-charcoal">Reject Candidate</h3>
            <p className="mt-2 text-sm leading-relaxed text-txt-secondary">
              Please provide a reason for rejecting this candidate.
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="mt-3 w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
            />
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => { setConfirmReject(false); setRejectionReason(""); }}
                disabled={loading === "rejected"}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => updateStatus("rejected", { rejection_reason: rejectionReason.trim() })}
                disabled={loading === "rejected" || !rejectionReason.trim()}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium bg-red text-white transition-colors hover:bg-red/90 cursor-pointer disabled:opacity-50"
              >
                {loading === "rejected" ? "Processing..." : "Reject"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
