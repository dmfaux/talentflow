"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useToast } from "@/components/ui/toast-provider";

interface Props {
  campaignId: string;
  status: string;
  /** When false (viewer / non-member), mutation controls are hidden — the
   *  server still enforces this; the hide is cosmetic. */
  canManage?: boolean;
}

export function CampaignActions({ campaignId, status, canManage = true }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  // A viewer (or non-member) gets a read-only view — no publish/pause/close.
  if (!canManage) return null;

  async function updateStatus(newStatus: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        // Draft → active is a publish (first activation), whereas
        // paused → active is a resume.
        const published = newStatus === "active" && status === "draft";
        toast(
          published ? "Campaign published" :
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
        {status === "draft" && (
          <>
            <Link
              href={`/campaigns/${campaignId}/edit`}
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              Edit
            </Link>
            <Button size="sm" loading={loading} onClick={() => updateStatus("active")}>
              Publish
            </Button>
          </>
        )}
        {status === "active" && (
          <Button variant="secondary" size="sm" loading={loading} onClick={() => updateStatus("paused")}>
            Pause
          </Button>
        )}
        {status === "paused" && (
          <Button size="sm" loading={loading} onClick={() => updateStatus("active")}>
            Resume
          </Button>
        )}
        {(status === "active" || status === "paused") && (
          <Button variant="danger" size="sm" disabled={loading} onClick={() => setConfirmClose(true)}>
            Close
          </Button>
        )}
      </div>

      <ConfirmModal
        open={confirmClose}
        title="Close campaign"
        description="Closing this campaign will stop accepting new applications. Existing candidates will not be affected. This can be reversed by an admin."
        confirmLabel="Close campaign"
        variant="danger"
        loading={loading}
        onConfirm={() => updateStatus("closed")}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  );
}
