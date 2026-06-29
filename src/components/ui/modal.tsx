"use client";

import * as React from "react";

/**
 * Modal — the shared dialog shell. One backdrop (Ink scrim + blur), one panel
 * (rule border, surface, soft shadow), one header (title + close), and the
 * keyboard/scroll behaviour every dialog needs: ESC to dismiss, a Tab focus
 * trap, scroll lock while open, and focus restored to the trigger on close.
 *
 * Replaces the hand-rolled `fixed inset-0 … bg-charcoal/40 … shadow-xl` shell
 * duplicated across the user editor, candidate decision dialogs, ConfirmModal,
 * and the operator surfaces. Consumers supply only the body (and their own
 * action row / form) as children — form modals keep their submit button inside
 * their own <form>, so the footer is never owned by the shell.
 */

type ModalSize = "sm" | "md" | "lg";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  size?: ModalSize;
  /**
   * When false, ESC / backdrop-click / close-button dismissal is suppressed —
   * e.g. while a submit is in flight, so the user can't tear down the form
   * mid-request. Defaults to true.
   */
  dismissible?: boolean;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  dismissible = true,
  children,
}: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  // Keep the latest onClose/dismissible in refs so the focus-trap effect below
  // can depend on [open] alone. Otherwise it re-runs on every render that hands
  // Modal a fresh onClose identity — e.g. a form modal re-rendering on each
  // keystroke — and its panelRef.focus() yanks focus off the active field.
  const onCloseRef = React.useRef(onClose);
  const dismissibleRef = React.useRef(dismissible);
  React.useEffect(() => {
    onCloseRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  React.useEffect(() => {
    if (!open) return;

    // Land focus inside the dialog, and hand it back to whatever opened it.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && dismissibleRef.current) {
        onCloseRef.current();
        return;
      }
      // Keep Tab cycling within the panel.
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const items = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-sm motion-safe:animate-[fadeIn_0.12s_ease-out]"
      onMouseDown={(e) => {
        // Only a press that begins on the backdrop itself dismisses — a drag
        // that starts inside the panel and releases outside must not.
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`w-full ${SIZES[size]} rounded-xl border border-rule bg-surface shadow-xl outline-none motion-safe:animate-[scaleIn_0.15s_cubic-bezier(0.16,1,0.3,1)]`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          {dismissible && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1.5 -mt-1 shrink-0 rounded-md p-1 text-ink-muted transition-colors hover:bg-canvas hover:text-ink cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-6 pb-6 pt-4">{children}</div>
      </div>
    </div>
  );
}
