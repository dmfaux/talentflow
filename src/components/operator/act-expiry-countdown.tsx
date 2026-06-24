"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Live countdown for the operator act-as time-box. The session is a fixed 60m
// JWT (Resolved Decision 6, no sliding renewal); the SERVER is the real enforcer
// — an expired cookie drops the operator back to deny-by-default. This is purely
// a visual aid, driven by the absolute expiry the layout reads from the act-as
// claim. At zero we router.refresh() once so the (admin) layout re-resolves: the
// now-expired cookie yields no actingOrgId, so the shell redirects to /operator.
//
// No refresh loop: the JWT exp is fixed at issuance, so a refresh re-reads the
// same cookie → same expiresAt prop → the effect's deps don't change and it
// never re-runs; the `reconciled` flag caps the refresh at one. The interval
// keeps running (it isn't cleared on reconcile) so the display self-corrects if
// the clock is later adjusted, rather than freezing on "Expired".
//
// aria-hidden on the per-second pill: the banner root is role="status" (a polite
// live region); an un-hidden ticker would be announced every second. A separate
// sr-only region announces coarsely (per-minute in the final 5m) so screen-reader
// users still get the impending-exit warning without the spam.

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ActExpiryCountdown({
  expiresAt,
  pill,
}: {
  /** Epoch ms when the act-as token expires. */
  expiresAt: number;
  /** Pill background class inherited from the banner's status treatment. */
  pill: string;
}) {
  const router = useRouter();
  // null until mounted so SSR and first client render agree (no Date.now() in
  // the initial paint → no hydration mismatch); the effect fills it in at once.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let reconciled = false;
    function tick() {
      const ms = expiresAt - Date.now();
      setRemaining(Math.max(0, ms));
      if (ms <= 0 && !reconciled) {
        reconciled = true; // reconcile with the server exactly once
        router.refresh();
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, router]);

  const expired = remaining !== null && remaining <= 0;
  const low = remaining !== null && remaining > 0 && remaining <= 60_000;

  // Coarse, low-frequency announcement: only the final 5 minutes, only when the
  // whole-minute value changes — so a screen reader hears "5 / 4 / 3 / 2 / 1
  // minutes left", not a per-second stream.
  const mins = remaining === null ? null : Math.ceil(remaining / 60_000);
  const srMessage =
    mins !== null && remaining! > 0 && mins <= 5
      ? `${mins} minute${mins === 1 ? "" : "s"} left in this act-as session`
      : "";

  return (
    <>
      <span
        aria-hidden
        title="Time left in this act-as session"
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.62rem] font-semibold tabular-nums ${pill} ${
          low ? "animate-pulse" : ""
        }`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4.5V8l2.5 1.5" />
        </svg>
        {remaining === null ? "—:—" : expired ? "Expired" : format(remaining)}
      </span>
      <span className="sr-only" aria-live="polite">
        {srMessage}
      </span>
    </>
  );
}
