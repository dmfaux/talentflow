"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export default function ResetPasswordRequestPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        setError("Something went wrong. Try again.");
        return;
      }

      setSubmitted(true);
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
          <div className="mb-10 text-center">
            <h1 className="font-serif text-[2rem] italic leading-none tracking-tight text-charcoal">
              TalentStream
            </h1>
            <p className="mt-2 text-[0.7rem] font-medium uppercase tracking-[0.25em] text-muted">
              Reset password
            </p>
          </div>

          {submitted ? (
            <div className="space-y-5">
              <p className="text-sm text-charcoal leading-relaxed">
                If an account exists for <strong>{email}</strong>, we&rsquo;ve sent a password reset link. Check your inbox.
              </p>
              <p className="text-[0.78rem] text-muted leading-relaxed">
                The link will expire in 1 hour.
              </p>
              <Link
                href="/login"
                className="inline-block text-[0.78rem] text-muted hover:text-charcoal transition-colors"
              >
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-5 text-[0.85rem] text-muted leading-relaxed">
                Enter your email and we&rsquo;ll send you a link to reset your password.
              </p>
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="email"
                    className="mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.15em] text-muted"
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    autoComplete="email"
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
                  {loading ? "Sending..." : "Send reset link"}
                </button>

                <div className="text-center">
                  <Link
                    href="/login"
                    className="text-[0.75rem] text-muted hover:text-charcoal transition-colors"
                  >
                    ← Back to sign in
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
