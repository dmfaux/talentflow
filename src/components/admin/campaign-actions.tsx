"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast-provider";

interface Props {
  campaignId: string;
  status: string;
}

export function CampaignActions({ campaignId, status }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  async function updateStatus(newStatus: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast(
          newStatus === "active" ? "Campaign resumed" :
          newStatus === "paused" ? "Campaign paused" :
          "Campaign closed",
          newStatus === "closed" ? "warning" : "success"
        );
      }
      router.refresh();
    } finally {
      setLoading(false);
      setConfirmClose(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {status === "active" && (
          <button
            onClick={() => updateStatus("paused")}
            disabled={loading}
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-warning transition-colors hover:bg-warning-light cursor-pointer disabled:opacity-50"
          >
            Pause
          </button>
        )}
        {status === "paused" && (
          <button
            onClick={() => updateStatus("active")}
            disabled={loading}
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-green transition-colors hover:bg-green-light cursor-pointer disabled:opacity-50"
          >
            Resume
          </button>
        )}
        {(status === "active" || status === "paused") && (
          <button
            onClick={() => setConfirmClose(true)}
            disabled={loading}
            className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-[0.75rem] font-medium text-red transition-colors hover:bg-red-light cursor-pointer disabled:opacity-50"
          >
            Close
          </button>
        )}
      </div>

      <ConfirmModal
        open={confirmClose}
        title="Close Campaign"
        description="Closing this campaign will stop accepting new applications. Existing candidates will not be affected. This can be reversed by an admin."
        confirmLabel="Close Campaign"
        variant="danger"
        loading={loading}
        onConfirm={() => updateStatus("closed")}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  );
}
