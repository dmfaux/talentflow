"use client";

import { useEffect, useRef, useState } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "primary" | "danger";
  busy?: boolean;
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  busy = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const confirmClass =
    variant === "danger"
      ? "bg-red text-paper hover:bg-red/90"
      : "bg-cobalt text-ink hover:bg-cobalt-deep";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg"
      >
        <h2 className="font-display text-base font-medium text-charcoal">
          {title}
        </h2>
        <div className="mt-3 text-[0.82rem] leading-relaxed text-txt-secondary">
          {body}
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed ${confirmClass}`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export interface PromptModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
  title: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
}

export function PromptModal({
  open,
  onClose,
  onSubmit,
  title,
  label,
  placeholder,
  defaultValue = "",
  confirmLabel = "Create",
  cancelLabel = "Cancel",
  busy = false,
}: PromptModalProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
    // Focus & select on next tick so the input is mounted.
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(t);
  }, [open, defaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, busy]);

  if (!open) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  function submit() {
    if (!canSubmit) return;
    onSubmit(trimmed);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-6"
      onClick={() => !busy && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg"
      >
        <h2 className="font-display text-base font-medium text-charcoal">
          {title}
        </h2>
        {label && (
          <label className="mt-3 block text-[0.78rem] font-medium text-txt-secondary">
            {label}
          </label>
        )}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="mt-2 h-9 w-full rounded-lg border border-border bg-paper px-3 text-[0.82rem] text-charcoal placeholder:text-txt-muted focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20 disabled:opacity-50"
        />
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-9 items-center rounded-lg bg-cobalt px-4 text-[0.78rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
