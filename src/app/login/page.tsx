"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const resetJustSucceeded = searchParams.get("reset") === "success";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Authentication failed");
        return;
      }

      const redirectTo = searchParams.get("from") || "/dashboard";
      router.push(redirectTo);
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4 relative overflow-hidden">
      {/* Grid wash */}
      <div
        className="pointer-events-none absolute inset-0 paper-grid"
        aria-hidden
      />
      {/* Radial washes */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 20% 20%, rgba(255,200,0,0.10) 0%, transparent 60%), radial-gradient(ellipse 50% 40% at 80% 80%, rgba(230,57,23,0.04) 0%, transparent 60%)",
        }}
        aria-hidden
      />

      <div className="relative w-full max-w-[400px]">
        {/* Brand above card */}
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5 group">
          <span className="relative w-2 h-2 rounded-full bg-vermillion pulse-dot" aria-hidden />
          <span className="font-display text-[1.45rem] text-ink tracking-[-0.02em] leading-none">
            Talent<span className="font-display-italic text-cobalt">Stream</span>
          </span>
        </Link>

        {/* Card */}
        <div className="relative rounded-2xl border border-rule bg-paper p-8 sm:p-10 shadow-[0_1px_3px_rgba(11,15,28,0.04),0_12px_40px_-12px_rgba(11,15,28,0.08)]">
          {/* Corner accent */}
          <div className="absolute -top-[1px] -right-[1px] w-12 h-12 pointer-events-none" aria-hidden>
            <div className="absolute top-0 right-0 w-full h-full border-t-2 border-r-2 border-vermillion rounded-tr-2xl" />
          </div>

          <div className="mb-8">
            <p className="eyebrow text-ink-faint mb-2">Admin access</p>
            <h1 className="font-display text-[1.75rem] text-ink tracking-[-0.02em] leading-[1.1]">
              Welcome <span className="font-display-italic text-cobalt">back</span>.
            </h1>
          </div>

          {resetJustSucceeded && (
            <div className="mb-6 rounded-lg border border-moss/25 bg-moss-soft px-4 py-3 text-[0.82rem] text-moss-deep">
              Password updated. You can now sign in.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="eyebrow block mb-2 text-ink-faint"
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
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-4 text-[0.92rem] text-ink placeholder:text-ink-faint outline-none transition-all duration-200 focus:border-cobalt focus:ring-2 focus:ring-cobalt/20 focus:bg-paper"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="eyebrow block mb-2 text-ink-faint"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="h-12 w-full rounded-lg border border-rule bg-canvas px-4 text-[0.92rem] text-ink placeholder:text-ink-faint outline-none transition-all duration-200 focus:border-cobalt focus:ring-2 focus:ring-cobalt/20 focus:bg-paper"
              />
              {error && (
                <p className="mt-2 text-[0.8rem] text-vermillion flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-vermillion" />
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="relative h-12 w-full rounded-lg bg-cobalt font-medium text-[0.92rem] text-ink transition-all duration-200 hover:bg-cobalt-deep hover:text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-[0_4px_16px_-4px_rgba(255,200,0,0.5)]"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg
                    className="h-4 w-4 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Sign in →"
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/reset-password"
              className="text-[0.82rem] text-ink-muted hover:text-cobalt transition-colors link-underline"
            >
              Forgot your password?
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center font-mono text-[0.68rem] text-ink-faint tracking-[0.1em] uppercase">
          Secured access · ZA-hosted
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
