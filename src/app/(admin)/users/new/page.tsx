"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

interface ClientOption {
  id: string;
  name: string;
}

export default function NewUserPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Brand-level role granted to the new member (least-privilege default).
  // The legacy security_group is written server-side with a default and no
  // longer surfaced here. Org-level role grants are handled in S8.
  const [brandRole, setBrandRole] = useState("viewer");
  const [clientId, setClientId] = useState("");
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => setClientOptions(res.data ?? []));
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = "First name is required";
    if (!lastName.trim()) errs.lastName = "Last name is required";
    if (!email.trim()) errs.email = "Email is required";
    if (password.length < 8) errs.password = "At least 8 characters";
    if (password !== confirmPassword) errs.confirmPassword = "Passwords do not match";
    if (!clientId) errs.clientId = "Brand is required";

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          password,
          brandRole,
          clientId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create user");
        return;
      }

      router.push("/users");
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-gold focus:ring-1 focus:ring-gold/20";
  const labelClass =
    "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted";

  return (
    <div className="mx-auto max-w-xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/users" className="hover:text-charcoal transition-colors">
          Users
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">New User</span>
      </div>

      <div className="rounded-xl border border-border bg-surface p-8">
        <h1 className="mb-6 text-lg font-semibold text-charcoal">New User</h1>

        {error && (
          <div className="mb-5 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="firstName" className={labelClass}>
                First Name <span className="text-red">*</span>
              </label>
              <input
                id="firstName"
                type="text"
                required
                autoFocus
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                className={`${inputClass} ${fieldErrors.firstName ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              {fieldErrors.firstName && (
                <p className="mt-1 text-xs text-red">{fieldErrors.firstName}</p>
              )}
            </div>
            <div>
              <label htmlFor="lastName" className={labelClass}>
                Last Name <span className="text-red">*</span>
              </label>
              <input
                id="lastName"
                type="text"
                required
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                className={`${inputClass} ${fieldErrors.lastName ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              {fieldErrors.lastName && (
                <p className="mt-1 text-xs text-red">{fieldErrors.lastName}</p>
              )}
            </div>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className={labelClass}>
              Email <span className="text-red">*</span>
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@company.com"
              className={`${inputClass} ${fieldErrors.email ? "border-red focus:border-red focus:ring-red/20" : ""}`}
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red">{fieldErrors.email}</p>
            )}
          </div>

          {/* Password row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="password" className={labelClass}>
                Password <span className="text-red">*</span>
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className={`${inputClass} ${fieldErrors.password ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              {fieldErrors.password && (
                <p className="mt-1 text-xs text-red">{fieldErrors.password}</p>
              )}
            </div>
            <div>
              <label htmlFor="confirmPassword" className={labelClass}>
                Confirm <span className="text-red">*</span>
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className={`${inputClass} ${fieldErrors.confirmPassword ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              />
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-xs text-red">{fieldErrors.confirmPassword}</p>
              )}
            </div>
          </div>

          {/* Brand role + brand row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="brandRole" className={labelClass}>
                Brand Role <span className="text-red">*</span>
              </label>
              <select
                id="brandRole"
                value={brandRole}
                onChange={(e) => setBrandRole(e.target.value)}
                className={inputClass}
              >
                <option value="brand_admin">Brand Admin</option>
                <option value="recruiter">Recruiter</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div>
              <label htmlFor="clientId" className={labelClass}>
                Brand <span className="text-red">*</span>
              </label>
              <select
                id="clientId"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className={`${inputClass} ${fieldErrors.clientId ? "border-red focus:border-red focus:ring-red/20" : ""}`}
              >
                <option value="">Select a brand…</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {fieldErrors.clientId && (
                <p className="mt-1 text-xs text-red">{fieldErrors.clientId}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href="/users"
              className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              {loading && (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
