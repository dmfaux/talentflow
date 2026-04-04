"use client";

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "danger" | "confirm";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "danger",
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;

  const btnClass =
    variant === "danger"
      ? "bg-red text-white hover:bg-red/90"
      : "bg-accent text-white hover:bg-accent-light";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="text-base font-semibold text-charcoal">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-txt-secondary">
          {description}
        </p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium transition-colors cursor-pointer disabled:opacity-50 ${btnClass}`}
          >
            {loading ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
