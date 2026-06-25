"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast-provider";

interface Props {
  candidateId: string;
  status: string;
  hasCv: boolean;
  /** When false (viewer / non-member), mutation controls (open chat,
   *  shortlist, reject) are hidden. CV download stays — it is a read. The
   *  server enforces the same; the hide is cosmetic. */
  canManage?: boolean;
}

export function CandidateActions({ candidateId, status, hasCv, canManage = true }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  // Human-in-the-loop rejection: a candidate the AI recommended for rejection
  // sits in `pending_rejection` until a person accepts or dismisses it. These
  // drive the two decision modals.
  const [decision, setDecision] = useState<"accept" | "dismiss" | null>(null);
  const [decisionReason, setDecisionReason] = useState("");
  const [notifyCandidate, setNotifyCandidate] = useState(false);

  async function updateStatus(newStatus: string, extra?: Record<string, string>) {
    setLoading(newStatus);
    try {
      const res = await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, ...extra }),
      });
      if (res.ok) {
        const { data } = await res.json();
        const tier = data?.tier as "B1" | "B2" | undefined;
        toast(
          newStatus === "shortlisted" ? "Candidate added to shortlist" :
          newStatus === "rejected"
            ? tier === "B2"
              ? "Rejection posted in chat — confirmation email will send in 24 hours"
              : tier === "B1"
                ? "Rejection posted in chat — confirmation email sent"
                : "Candidate rejected"
            : "Status updated",
          newStatus === "shortlisted" ? "success" : newStatus === "rejected" ? "warning" : "info"
        );
        setConfirmReject(false);
        setRejectionReason("");
      } else if (res.status === 409 && newStatus === "rejected") {
        // Tier A: candidate is inside the grace window.
        const body = await res.json().catch(() => ({}));
        toast(
          body.error ??
            "Candidate was invited to chat but hasn't responded yet — try again in a few days.",
          "error"
        );
        // Keep the dialog open so the admin sees the message without
        // losing whatever they typed in the reason field.
      } else {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? "Failed to update candidate", "error");
      }
      router.refresh();
    } finally {
      setLoading("");
    }
  }

  // Accept or dismiss the AI's rejection recommendation. Accept → rejected
  // (+ email); dismiss → scored. Both are audited server-side with the actor,
  // timestamp, and optional reason.
  async function submitDecision(which: "accept" | "dismiss") {
    setLoading(`decision-${which}`);
    try {
      const reason = decisionReason.trim();
      const res = await fetch(`/api/admin/candidates/${candidateId}/rejection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: which,
          reason: reason || undefined,
          notify_candidate: which === "accept" ? notifyCandidate : false,
        }),
      });
      if (res.ok) {
        toast(
          which === "accept"
            ? notifyCandidate
              ? "Candidate rejected — rejection email with your note will be sent"
              : "Candidate rejected — rejection email sent"
            : "Recommendation dismissed — candidate kept",
          which === "accept" ? "warning" : "success"
        );
        setDecision(null);
        setDecisionReason("");
        setNotifyCandidate(false);
      } else {
        const body = await res.json().catch(() => ({}));
        toast(body.error ?? "Couldn't record the decision", "error");
      }
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
      else toast("No CV available", "error");
    } finally {
      setLoading("");
    }
  }

  // `pending_rejection` is excluded from the normal action gates: while a
  // candidate awaits a rejection decision, the only controls are Accept / Dismiss.
  const canShortlist = !["shortlisted", "rejected", "withdrawn", "gating_failed", "no_response", "pending_rejection"].includes(status);
  const canReject = !["rejected", "withdrawn", "gating_failed", "no_response", "pending_rejection"].includes(status);
  const canOpenChat = !["gating_failed", "withdrawn", "rejected", "no_response", "pending_rejection"].includes(status);
  const canDecideRejection = status === "pending_rejection";

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

  const decisionBusy = loading.startsWith("decision-");

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {canManage && canDecideRejection && (
          <>
            <button
              onClick={() => { setDecision("accept"); setDecisionReason(""); setNotifyCandidate(false); }}
              disabled={!!loading}
              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
            >
              Accept rejection
            </button>
            <button
              onClick={() => { setDecision("dismiss"); setDecisionReason(""); }}
              disabled={!!loading}
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light cursor-pointer disabled:opacity-50"
            >
              Dismiss — keep candidate
            </button>
          </>
        )}
        {canManage && canOpenChat && (
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
        {canManage && canShortlist && (
          <button
            onClick={() => updateStatus("shortlisted")}
            disabled={!!loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light cursor-pointer disabled:opacity-50"
          >
            {loading === "shortlisted" ? "..." : "Add to Shortlist"}
          </button>
        )}
        {canManage && canReject && (
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
              {status === "follow_up"
                ? "This will post a closing message in the candidate's chat and send a confirmation email. Please provide a reason — it will be shared with the candidate verbatim if you fill it in."
                : "Please provide a reason for rejecting this candidate."}
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder={status === "follow_up" ? "Reason (will be shared with the candidate)..." : "Reason for rejection..."}
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

      {/* Accept the AI's rejection recommendation. */}
      {decision === "accept" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-charcoal">Accept rejection</h3>
            <p className="mt-2 text-sm leading-relaxed text-txt-secondary">
              This rejects the candidate and sends them a rejection email. Add an
              optional note — it stays internal unless you choose to share it.
            </p>
            <textarea
              rows={3}
              value={decisionReason}
              onChange={(e) => {
                setDecisionReason(e.target.value);
                if (!e.target.value.trim()) setNotifyCandidate(false);
              }}
              placeholder="Reason for rejection (optional)…"
              className="mt-3 w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
            />
            <label
              className={`mt-3 flex items-start gap-2.5 text-sm ${
                decisionReason.trim() ? "text-charcoal cursor-pointer" : "text-txt-muted cursor-not-allowed"
              }`}
            >
              <input
                type="checkbox"
                checked={notifyCandidate}
                disabled={!decisionReason.trim()}
                onChange={(e) => setNotifyCandidate(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-accent cursor-[inherit]"
              />
              <span>Also send this note to the candidate</span>
            </label>
            {notifyCandidate && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-light px-3.5 py-2.5">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mt-0.5 shrink-0 text-warning">
                  <path d="M8 1.5L15 14H1z" />
                  <path d="M8 6.5v3M8 11.5v.5" />
                </svg>
                <p className="text-[0.78rem] leading-relaxed text-charcoal">
                  Your note will appear in the candidate&rsquo;s rejection email
                  exactly as written. Keep it professional — don&rsquo;t include
                  internal comments.
                </p>
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => { setDecision(null); setDecisionReason(""); setNotifyCandidate(false); }}
                disabled={decisionBusy}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submitDecision("accept")}
                disabled={decisionBusy}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium bg-red text-white transition-colors hover:bg-red/90 cursor-pointer disabled:opacity-50"
              >
                {loading === "decision-accept" ? "Processing..." : "Reject candidate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dismiss the recommendation and keep the candidate. */}
      {decision === "dismiss" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
            <h3 className="text-base font-semibold text-charcoal">Keep candidate</h3>
            <p className="mt-2 text-sm leading-relaxed text-txt-secondary">
              This dismisses the AI&rsquo;s rejection recommendation and returns
              the candidate to scored. Add an optional note for the record —
              it&rsquo;s internal only.
            </p>
            <textarea
              rows={3}
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              placeholder="Reason (optional, internal)…"
              className="mt-3 w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
            />
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => { setDecision(null); setDecisionReason(""); }}
                disabled={decisionBusy}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => submitDecision("dismiss")}
                disabled={decisionBusy}
                className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium bg-accent text-white transition-colors hover:bg-accent-light cursor-pointer disabled:opacity-50"
              >
                {loading === "decision-dismiss" ? "Processing..." : "Keep candidate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
