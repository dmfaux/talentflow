"use client";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast-provider";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  orgId: string;
  orgName: string;
  status: string;
}

/** Begins an audited act-as session, then lands the operator in the normal
 *  (admin) shell — now transparently scoped to the org, with the act-as banner
 *  showing. Confirmation-gated because act-as grants owner-level access. */
export function ImpersonateButton({ orgId, orgName, status }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function impersonate() {
    setLoading(true);
    try {
      const res = await fetch("/api/operator/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "Could not start the session", "error");
        setLoading(false);
        setConfirming(false);
        return;
      }
      // Land in the tenant shell, now scoped to the acted org.
      router.push("/dashboard");
      router.refresh();
    } catch {
      toast("Something went wrong", "error");
      setLoading(false);
      setConfirming(false);
    }
  }

  const nonActive = status !== "active";

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-5 text-[0.8rem] font-medium text-paper transition-colors hover:bg-cobalt-deep cursor-pointer"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
          <path d="M12.5 2.5l1.5 1.5-1.5 1.5M14 4h-3" />
        </svg>
        Act as this organisation
      </button>
      <ConfirmModal
        open={confirming}
        title={`Act as ${orgName}?`}
        description={
          (nonActive
            ? `This organisation is ${status}. `
            : "") +
          "You'll enter the tenant with owner-level access. Everything you do is audited, and the session times out after 60 minutes."
        }
        confirmLabel="Start session"
        variant="confirm"
        loading={loading}
        onConfirm={impersonate}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
