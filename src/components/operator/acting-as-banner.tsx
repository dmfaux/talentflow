import { ActExpiryCountdown } from "./act-expiry-countdown";
import { ExitActAsButton } from "./exit-act-as-button";

// The global "Acting as <Org> — Exit" banner, rendered in the (admin) shell
// whenever ctx.actingOrgId is set. First-class and high-contrast so
// impersonation is never ambiguous (plan §11). A NON-active target gets a
// distinct treatment + an explicit status label, so an operator is never
// unaware they are inside a suspended/deleted tenant (Resolved Decision 5).
//
// Self-contained — reads only the org name/status — so S8 can relocate it
// beside the brand switcher without a rewrite.

const TREATMENT: Record<
  string,
  { bar: string; tone: "light" | "dark"; pill: string }
> = {
  active: { bar: "bg-cobalt text-paper", tone: "light", pill: "bg-paper/15" },
  suspended: { bar: "bg-warning text-ink", tone: "dark", pill: "bg-ink/10" },
  deleted: { bar: "bg-red text-paper", tone: "light", pill: "bg-paper/15" },
};

export function ActingAsBanner({
  orgName,
  status,
  expiresAt,
}: {
  orgName: string;
  status: string;
  /** Epoch ms when the act-as time-box ends; omitted/null hides the countdown. */
  expiresAt?: number | null;
}) {
  const t = TREATMENT[status] ?? TREATMENT.active;
  const isActive = status === "active";

  return (
    <div
      role="status"
      className={`flex w-full items-center justify-center gap-3 px-4 py-2 text-[0.8rem] font-medium ${t.bar}`}
    >
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] ${t.pill}`}>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" />
        </svg>
        Operator
      </span>
      <span>
        Acting as <strong className="font-semibold">{orgName}</strong>
        {!isActive && <span className="font-semibold"> ({status})</span>}
      </span>
      {expiresAt != null && <ActExpiryCountdown expiresAt={expiresAt} pill={t.pill} />}
      <ExitActAsButton tone={t.tone} />
    </div>
  );
}
