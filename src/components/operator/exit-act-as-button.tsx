"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Ends the act-as session and returns the operator to the console. The seam
 *  clears the cookie server-side; router.refresh() re-resolves the (admin)
 *  layout so the redirect (non-acting operator → /operator) fires. */
export function ExitActAsButton({ tone = "light" }: { tone?: "light" | "dark" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function exit() {
    setLoading(true);
    await fetch("/api/operator/impersonate/exit", { method: "POST" });
    router.push("/operator");
    router.refresh();
  }

  const styles =
    tone === "dark"
      ? "border-ink/30 text-ink hover:bg-ink/10"
      : "border-paper/40 text-paper hover:bg-paper/15";

  return (
    <button
      onClick={exit}
      disabled={loading}
      className={`inline-flex h-6 items-center gap-1 rounded border px-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.08em] transition-colors disabled:opacity-60 cursor-pointer ${styles}`}
    >
      {loading ? "Exiting…" : "Exit"}
      {!loading && (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2H4a2 2 0 00-2 2v8a2 2 0 002 2h2M10.5 11.5L14 8l-3.5-3.5M14 8H6" />
        </svg>
      )}
    </button>
  );
}
