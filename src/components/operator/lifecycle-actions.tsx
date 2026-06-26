"use client";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast-provider";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  orgId: string;
  orgName: string;
  orgSlug: string;
  status: string;
  /** Receives the updated org row after a reversible transition so the parent
   *  re-renders the status badge + the now-available actions. */
  onChanged: (org: Record<string, unknown>) => void;
}

type Reversible = "suspend" | "restore" | "soft_delete";

const META: Record<
  Reversible,
  {
    path: string;
    label: string;
    /** Card-button styling. */
    button: string;
    title: string;
    description: (name: string) => string;
    confirmLabel: string;
    confirmVariant: "danger" | "confirm";
  }
> = {
  suspend: {
    path: "suspend",
    label: "Suspend",
    button:
      "border border-saffron/40 text-saffron-deep hover:bg-saffron-soft/60",
    title: "Suspend this organisation?",
    description: (n) =>
      `${n}'s users are signed out on their next request and its public careers pages stop accepting applications. Fully reversible — restore at any time.`,
    confirmLabel: "Suspend organisation",
    confirmVariant: "confirm",
  },
  restore: {
    path: "restore",
    label: "Restore",
    button:
      "border border-cobalt/40 text-cobalt-deep hover:bg-cobalt-tint",
    title: "Restore this organisation?",
    description: (n) =>
      `${n}'s users regain access and its careers pages reopen.`,
    confirmLabel: "Restore organisation",
    confirmVariant: "confirm",
  },
  soft_delete: {
    path: "soft-delete",
    label: "Soft-delete",
    button: "border border-red/40 text-red hover:bg-red-light/60",
    title: "Soft-delete this organisation?",
    description: (n) =>
      `${n} is marked deleted — users blocked, careers frozen — but all data is retained and it can still be restored. Permanent deletion is a separate, irreversible step.`,
    confirmLabel: "Soft-delete organisation",
    confirmVariant: "danger",
  },
};

// Which reversible actions a given status offers (purge is handled separately).
function actionsFor(status: string): Reversible[] {
  if (status === "active") return ["suspend", "soft_delete"];
  if (status === "suspended") return ["restore", "soft_delete"];
  if (status === "deleted") return ["restore"];
  return [];
}

export function LifecycleActions({
  orgId,
  orgName,
  orgSlug,
  status,
  onChanged,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState<Reversible | null>(null);
  const [loading, setLoading] = useState(false);

  // Purge modal state (typed-slug confirmation).
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [purging, setPurging] = useState(false);

  const reversible = actionsFor(status);

  async function runTransition(kind: Reversible) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/operator/organizations/${orgId}/${META[kind].path}`,
        { method: "POST" }
      );
      const { data, error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not update the organisation", "error");
        return;
      }
      onChanged(data);
      toast(`Organisation ${META[kind].label.toLowerCase()}d`, "success");
      setPending(null);
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setLoading(false);
    }
  }

  async function runPurge() {
    setPurging(true);
    try {
      const res = await fetch(`/api/operator/organizations/${orgId}/purge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText.trim() }),
      });
      const { error } = await res.json();
      if (!res.ok) {
        toast(error || "Could not purge the organisation", "error");
        return;
      }
      // The org is gone — leave the (now-dead) detail page.
      toast(`${orgName} permanently deleted`, "success");
      router.push("/operator");
      router.refresh();
    } catch {
      toast("Something went wrong", "error");
    } finally {
      setPurging(false);
    }
  }

  const slugMatches = confirmText.trim() === orgSlug;

  return (
    <div className="rounded-xl border border-rule bg-surface p-6">
      <h2 className="font-serif text-lg text-ink">Lifecycle</h2>
      <p className="mt-0.5 text-xs text-ink-muted">
        Suspend, soft-delete, or permanently purge this tenant. Suspend and
        soft-delete are reversible; purge is not.
      </p>

      {/* Reversible transitions */}
      <div className="mt-5 space-y-2.5">
        {reversible.map((kind) => (
          <div
            key={kind}
            className="flex items-center justify-between gap-4 rounded-lg border border-rule bg-canvas/40 px-4 py-3"
          >
            <p className="text-[0.8rem] leading-snug text-ink-soft">
              {META[kind].description(orgName)}
            </p>
            <button
              onClick={() => setPending(kind)}
              className={`inline-flex h-9 shrink-0 items-center rounded-lg px-4 text-[0.8rem] font-medium transition-colors cursor-pointer ${META[kind].button}`}
            >
              {META[kind].label}
            </button>
          </div>
        ))}
      </div>

      {/* Danger zone — irreversible purge, only once soft-deleted */}
      {status === "deleted" && (
        <div className="mt-4 rounded-lg border border-red/30 bg-red-light/40 p-4">
          <div className="flex items-center gap-2">
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-red"
            >
              <path d="M8 1.5 1 14h14L8 1.5Z" />
              <path d="M8 6.5v3.5M8 12v.01" />
            </svg>
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-red">
              Danger zone
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-[0.8rem] leading-snug text-ink-soft">
              Permanently delete all brands, campaigns, candidates, CVs, and
              chat data for {orgName}. This cannot be undone.
            </p>
            <button
              onClick={() => {
                setConfirmText("");
                setPurgeOpen(true);
              }}
              className="inline-flex h-9 shrink-0 items-center rounded-lg bg-red px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-red/90 cursor-pointer"
            >
              Purge permanently
            </button>
          </div>
        </div>
      )}

      {/* Reversible-action confirmation */}
      {pending && (
        <ConfirmModal
          open
          title={META[pending].title}
          description={META[pending].description(orgName)}
          confirmLabel={META[pending].confirmLabel}
          variant={META[pending].confirmVariant}
          loading={loading}
          onConfirm={() => runTransition(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {/* Typed-slug purge confirmation */}
      <Modal
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title={`Permanently delete ${orgName}?`}
        size="md"
        dismissible={!purging}
      >
        <p className="text-sm leading-relaxed text-ink-soft">
          This permanently deletes all brands, campaigns, candidates, CVs, and
          chat data for {orgName}, and removes every stored file. This{" "}
          <strong className="text-ink">cannot be undone</strong>.
        </p>
        <label htmlFor="purge-confirm" className="mt-4 block text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Type{" "}
          <span className="font-mono normal-case tracking-normal text-red">
            {orgSlug}
          </span>{" "}
          to confirm
        </label>
        <input
          id="purge-confirm"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && slugMatches && !purging) runPurge();
          }}
          placeholder={orgSlug}
          className="mt-1.5 h-10 w-full rounded-lg border border-rule bg-canvas/40 px-3.5 font-mono text-sm text-ink outline-none transition-colors placeholder:font-sans placeholder:text-ink-muted focus:border-red focus:ring-1 focus:ring-red/20"
        />
        <div className="mt-5 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={() => setPurgeOpen(false)} disabled={purging}>
            Cancel
          </Button>
          <Button variant="danger" onClick={runPurge} disabled={!slugMatches} loading={purging}>
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
