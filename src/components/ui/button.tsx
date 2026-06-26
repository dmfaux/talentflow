import * as React from "react";

/**
 * Button — the single primary-action primitive for the TalentStream product app.
 *
 * Replaces the ad-hoc h-8/h-9/h-10 × bg-accent/bg-cobalt/bg-charcoal sprawl that
 * had every surface re-rolling its own button. One shape (rounded-lg), one focus
 * treatment (the global :focus-visible cobalt outline in globals.css), the
 * documented variants, and a consistent loading state.
 *
 * `buttonVariants()` is exported so `<Link>` CTAs can wear the identical styles
 * without forcing a wrapping <button>.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium " +
  "whitespace-nowrap transition-colors cursor-pointer select-none " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  // Solid Cobalt Signal — the one action that matters.
  primary: "bg-cobalt text-white hover:bg-cobalt-deep",
  // Neutral outline for secondary actions that still need presence.
  secondary: "border border-rule bg-surface text-ink-soft hover:bg-canvas hover:text-ink",
  // Low-emphasis (Cancel, tertiary).
  ghost: "text-ink-soft hover:bg-canvas hover:text-ink",
  // Destructive only — never decorative.
  danger: "bg-red text-white hover:bg-red/90",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.75rem]", // dense rows / table toolbars
  md: "h-9 px-4 text-[0.8rem]", // default (36px)
  lg: "h-11 px-6 text-[0.875rem]", // prominent CTAs
};

export function buttonVariants({
  variant = "primary",
  size = "md",
}: { variant?: Variant; size?: Size } = {}): string {
  return `${base} ${VARIANTS[variant]} ${SIZES[size]}`;
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", loading = false, disabled, className = "", children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={`${buttonVariants({ variant, size })} ${className}`}
        {...props}
      >
        {loading && <Spinner />}
        {children}
      </button>
    );
  },
);

function Spinner() {
  return (
    <svg
      className="animate-spin"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
