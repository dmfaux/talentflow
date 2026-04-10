"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Logo } from "@/components/brand/logo";

export default function ResetPasswordConfirmPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Something went wrong. Try again.");
        return;
      }

      router.push("/login?reset=success");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4 relative overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-gold/[0.06] blur-[150px]" />

      <div className="relative w-full max-w-[380px]">
        <div className="rounded-2xl border border-charcoal/[0.06] bg-warm-white p-10 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_30px_rgba(0,0,0,0.04)]">
          <div className="mb-10 flex flex-col items-center">
            <Logo size="xl" />
            <p className="mt-3 text-[0.7rem] font-medium uppercase tracking-[0.25em] text-muted">
              New password
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.15em] text-muted"
              >
                New password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                autoFocus
                autoComplete="new-password"
                minLength={8}
                className="h-11 w-full rounded-lg border border-charcoal/[0.1] bg-cream/60 px-4 text-sm text-charcoal placeholder:text-charcoal/25 outline-none transition-all duration-200 focus:border-gold/60 focus:ring-1 focus:ring-gold/30"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.15em] text-muted"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
                autoComplete="new-password"
                minLength={8}
                className="h-11 w-full rounded-lg border border-charcoal/[0.1] bg-cream/60 px-4 text-sm text-charcoal placeholder:text-charcoal/25 outline-none transition-all duration-200 focus:border-gold/60 focus:ring-1 focus:ring-gold/30"
              />
              {error && (
                <p className="mt-2 text-[0.78rem] text-red-600">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative h-11 w-full rounded-lg bg-charcoal font-medium text-sm text-cream transition-all duration-200 hover:bg-charcoal-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? "Updating..." : "Update password"}
            </button>

            <div className="text-center">
              <Link
                href="/reset-password"
                className="text-[0.75rem] text-muted hover:text-charcoal transition-colors"
              >
                Request a new link
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
