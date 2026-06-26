import * as React from "react";

/**
 * Form-control primitives — Input / Textarea / Select + a Field wrapper.
 *
 * One canonical fill (faint canvas), one focus treatment (Cobalt border + ring —
 * never the teal "notice" signal), and a single error state. Replaces the
 * bg-surface vs bg-canvas/40 vs inline-number-box input sprawl, the gold/teal
 * mis-focus on the user-detail form, and the txt-muted (sub-AA) labels: labels
 * here sit at Ink Soft and helpers at Ink Muted, both clearing WCAG AA.
 */

const controlBase =
  "w-full rounded-lg border px-3 py-2 text-sm text-ink bg-canvas/40 " +
  "placeholder:text-ink-muted transition-colors " +
  "focus:outline-none focus:ring-1 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const controlState = (invalid?: boolean) =>
  invalid
    ? "border-red focus:border-red focus:ring-red/30"
    : "border-rule focus:border-cobalt focus:ring-cobalt/20";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ invalid, className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${controlBase} ${controlState(invalid)} ${className}`}
        {...props}
      />
    );
  },
);

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ invalid, className = "", ...props }, ref) {
    return (
      <textarea
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${controlBase} ${controlState(invalid)} resize-y ${className}`}
        {...props}
      />
    );
  },
);

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ invalid, className = "", children, ...props }, ref) {
    return (
      <select
        ref={ref}
        aria-invalid={invalid || undefined}
        className={`${controlBase} ${controlState(invalid)} cursor-pointer pr-8 ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  },
);

interface FieldProps {
  label: string;
  htmlFor: string;
  /** Error message — when set, the field reads as invalid. */
  error?: string | null;
  /** Helper text shown when there is no error. */
  helper?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + helper/error, wired for accessibility. Pass the matching
 * control as a child with `id={htmlFor}` (and `invalid={!!error}` for error styling).
 */
export function Field({
  label,
  htmlFor,
  error,
  helper,
  required,
  className = "",
  children,
}: FieldProps) {
  const describedBy = error
    ? `${htmlFor}-error`
    : helper
      ? `${htmlFor}-helper`
      : undefined;

  // Point the control at its helper/error text for screen readers without the
  // consumer having to thread the id manually.
  const control = React.isValidElement(children)
    ? React.cloneElement(
        children as React.ReactElement<{ "aria-describedby"?: string }>,
        { "aria-describedby": describedBy },
      )
    : children;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="block text-[0.8rem] font-medium text-ink-soft">
        {label}
        {required && (
          <span className="text-red" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-red" role="alert">
          {error}
        </p>
      ) : helper ? (
        <p id={`${htmlFor}-helper`} className="text-xs text-ink-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
}
