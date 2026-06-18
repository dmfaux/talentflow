"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Logo } from "@/components/brand/logo";

// PUBLIC, outside the (admin) shell (no requireTenant). Mirrors the reset-
// password visual language. Minimal by design — Clerk replaces this in S15.

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dead, setDead] = useState(false);

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
      const res = await fetch("/api/auth/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, firstName, lastName, password }),
      });

      if (!res.ok) {
        const data = await res.json();
        // A 400 means the token itself is invalid/expired — a dead-end, not a
        // recoverable field error.
        if (res.status === 400) {
          setDead(true);
          return;
        }
        setError(data.error || "Something went wrong. Try again.");
        return;
      }

      // The session cookie is set by the accept route — land in onboarding.
      // The wizard self-redirects to /dashboard when onboarding isn't owed
      // (a brand already exists, or the invitee can't manage the org).
      router.push("/onboarding");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token || dead) {
    return (
      <DeadEnd
        message={
          token
            ? "This invitation is invalid or has expired. Ask whoever invited you to send a fresh one."
            : "This invitation link is incomplete. Ask whoever invited you to send a fresh one."
        }
      />
    );
  }

  return (
    <Shell eyebrow="Accept invitation">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className={labelClass}>
              First name
            </label>
            <input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoFocus
              autoComplete="given-name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="lastName" className={labelClass}>
              Last name
            </label>
            <input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              autoComplete="family-name"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            required
            autoComplete="new-password"
            minLength={8}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className={labelClass}>
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
            required
            autoComplete="new-password"
            minLength={8}
            className={inputClass}
          />
          {error && <p className="mt-2 text-[0.78rem] text-red-600">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="relative h-11 w-full rounded-lg bg-charcoal font-medium text-sm text-cream transition-all duration-200 hover:bg-charcoal-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? "Setting up…" : "Accept & continue"}
        </button>
      </form>
    </Shell>
  );
}

function DeadEnd({ message }: { message: string }) {
  return (
    <Shell eyebrow="Invitation">
      <p className="text-center text-sm leading-relaxed text-charcoal/70">
        {message}
      </p>
      <div className="mt-6 text-center">
        <Link
          href="/login"
          className="text-[0.8rem] font-medium text-charcoal hover:text-charcoal-light transition-colors"
        >
          Go to sign in
        </Link>
      </div>
    </Shell>
  );
}

function Shell({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream px-4 relative overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full bg-gold/[0.06] blur-[150px]" />
      <div className="relative w-full max-w-[400px]">
        <div className="rounded-2xl border border-charcoal/[0.06] bg-warm-white p-10 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_8px_30px_rgba(0,0,0,0.04)]">
          <div className="mb-10 flex flex-col items-center">
            <Logo size="xl" />
            <p className="mt-3 text-[0.7rem] font-medium uppercase tracking-[0.25em] text-muted">
              {eyebrow}
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "h-11 w-full rounded-lg border border-charcoal/[0.1] bg-cream/60 px-4 text-sm text-charcoal placeholder:text-charcoal/25 outline-none transition-all duration-200 focus:border-gold/60 focus:ring-1 focus:ring-gold/30";
const labelClass =
  "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.15em] text-muted";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
