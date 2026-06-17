"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Log-out affordance for the operator console chrome. Mirrors the admin
 *  sidebar's logout (POST /api/auth/logout → /login) but styled for the dark
 *  control-plane top bar. */
export function OperatorLogout() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/15 px-2.5 text-[0.7rem] font-medium text-paper/70 transition-colors hover:border-vermillion/60 hover:text-paper disabled:opacity-50 cursor-pointer"
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2H4a2 2 0 00-2 2v8a2 2 0 002 2h2M10.5 11.5L14 8l-3.5-3.5M14 8H6" />
      </svg>
      Log out
    </button>
  );
}
