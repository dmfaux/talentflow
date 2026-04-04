"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function NewClientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    const form = new FormData(e.currentTarget);
    const name = (form.get("name") as string).trim();

    if (!name) {
      setFieldErrors({ name: "Client name is required" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          contact_name: (form.get("contact_name") as string) || null,
          contact_email: (form.get("contact_email") as string) || null,
          contact_phone: (form.get("contact_phone") as string) || null,
          billing_email: (form.get("billing_email") as string) || null,
          notes: (form.get("notes") as string) || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create client");
        return;
      }

      router.push("/clients");
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
        <Link href="/clients" className="hover:text-charcoal transition-colors">
          Clients
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">New Client</span>
      </div>

      <div className="rounded-xl border border-border bg-surface p-8">
        <h1 className="mb-6 text-lg font-semibold text-charcoal">
          New Client
        </h1>

        {error && (
          <div className="mb-5 rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label htmlFor="name" className={labelClass}>
              Company Name <span className="text-red">*</span>
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              autoFocus
              placeholder="Acme Corp"
              className={`${inputClass} ${fieldErrors.name ? "border-red focus:border-red focus:ring-red/20" : ""}`}
            />
            {fieldErrors.name && (
              <p className="mt-1 text-xs text-red">{fieldErrors.name}</p>
            )}
          </div>

          {/* Contact Name + Email row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact_name" className={labelClass}>
                Contact Name
              </label>
              <input
                id="contact_name"
                name="contact_name"
                type="text"
                placeholder="Jane Smith"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="contact_email" className={labelClass}>
                Contact Email
              </label>
              <input
                id="contact_email"
                name="contact_email"
                type="email"
                placeholder="jane@acme.com"
                className={inputClass}
              />
            </div>
          </div>

          {/* Phone + Billing row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="contact_phone" className={labelClass}>
                Phone
              </label>
              <input
                id="contact_phone"
                name="contact_phone"
                type="tel"
                placeholder="+27 82 123 4567"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="billing_email" className={labelClass}>
                Billing Email
              </label>
              <input
                id="billing_email"
                name="billing_email"
                type="email"
                placeholder="accounts@acme.com"
                className={inputClass}
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="notes" className={labelClass}>
              Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              placeholder="Internal notes about this client..."
              className="w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-gold focus:ring-1 focus:ring-gold/20 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Link
              href="/clients"
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
              Create Client
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
