"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { buildTemplatePrompt, type BrandColors } from "@/lib/templates/prompt-builder";
import { validateHtmlTemplate } from "@/lib/templates/slots";

interface Client {
  id: string;
  name: string;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  brand_accent_color: string | null;
  brand_text_color: string | null;
}

function deriveKey(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const baseKey = /^[a-z]/.test(slug) ? slug : `t_${slug}`;
  return `${baseKey}_${Date.now().toString(36)}`;
}

type ValidationState =
  | { kind: "empty" }
  | { kind: "ok" }
  | { kind: "errors"; errors: string[] };

export default function NewCustomTemplatePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [pastedHtml, setPastedHtml] = useState("");
  const [validation, setValidation] = useState<ValidationState>({ kind: "empty" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => setClients(res.data ?? []));
  }, []);

  const selectedClient = clients.find((c) => c.id === selectedClientId);
  const brandColors = useMemo<BrandColors | null>(() => {
    if (!selectedClient?.brand_primary_color) return null;
    return {
      primary: selectedClient.brand_primary_color,
      secondary: selectedClient.brand_secondary_color ?? "#f3f0e8",
      accent: selectedClient.brand_accent_color ?? null,
      text: selectedClient.brand_text_color ?? "#0b0f1c",
    };
  }, [selectedClient?.brand_primary_color, selectedClient?.brand_secondary_color, selectedClient?.brand_accent_color, selectedClient?.brand_text_color]);

  const prompt = useMemo(
    () =>
      buildTemplatePrompt({
        name: name || "(unnamed)",
        brief: brief || "(no brief yet)",
        brandColors,
      }),
    [name, brief, brandColors]
  );

  // Debounced validation
  useEffect(() => {
    const trimmed = pastedHtml.trim();
    if (!trimmed) {
      setValidation({ kind: "empty" });
      return;
    }
    const t = setTimeout(() => {
      const result = validateHtmlTemplate(trimmed);
      if (result.ok) {
        setValidation({ kind: "ok" });
      } else {
        setValidation({ kind: "errors", errors: result.errors });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [pastedHtml]);

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canSubmit =
    name.trim().length > 0 &&
    validation.kind === "ok" &&
    !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitError(null);

    const trimmed = pastedHtml.trim();
    const result = validateHtmlTemplate(trimmed);
    if (!result.ok) {
      setSubmitError(`Validation failed: ${result.errors.join("; ")}`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: deriveKey(name),
          name: name.trim(),
          description: brief.trim() || null,
          html_template: trimmed,
          owner_client_id: selectedClientId || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(body.error ?? "Failed to create template");
        return;
      }
      router.push(`/templates/${body.data.id}/edit`);
    } catch {
      setSubmitError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl pb-16">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/templates"
          className="mb-3 inline-flex items-center gap-1 text-[0.72rem] text-txt-muted transition-colors hover:text-charcoal"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M7.5 2.5L4 6l3.5 3.5" />
          </svg>
          Templates
        </Link>
        <h1 className="font-display text-xl text-charcoal">New template</h1>
        <p className="mt-1 text-[0.82rem] leading-relaxed text-txt-secondary">
          Write a design brief, copy the prompt into an external AI, then paste
          the HTML it returns back here.
        </p>
      </div>

      {/* Section 1: Brief */}
      <section className="mb-8 rounded-xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-cobalt-deep">
            Step 1
          </span>
          <h2 className="font-display text-base text-charcoal">Describe your template</h2>
        </div>

        <label className="mb-1 block text-[0.72rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Editorial Long-form"
          className="mb-4 h-9 w-full rounded-lg border border-border bg-paper px-3 text-[0.82rem] text-charcoal placeholder:text-txt-muted focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20"
        />

        <label className="mb-1 block text-[0.72rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
          Owner
        </label>
        <select
          value={selectedClientId}
          onChange={(e) => setSelectedClientId(e.target.value)}
          className="mb-4 h-9 w-full rounded-lg border border-border bg-paper px-3 text-[0.82rem] text-charcoal focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20"
        >
          <option value="">Shared Library (available to all clients)</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} (bespoke)
            </option>
          ))}
        </select>

        <label className="mb-1 block text-[0.72rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
          Design brief
        </label>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Describe the visual style, tone, and structure you want. What should the page feel like? What sections do you need beyond the form?"
          className="min-h-[120px] w-full rounded-lg border border-border bg-paper px-3 py-2 text-[0.82rem] text-charcoal placeholder:text-txt-muted focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20"
        />
        <p className="mt-1.5 text-[0.72rem] text-txt-muted">
          No need to spec exact colors or typography values — the AI will interpret your direction.
          {brandColors && (
            <span className="ml-1 text-cobalt-deep">Brand colors from {selectedClient?.name} will be included in the prompt.</span>
          )}
        </p>
      </section>

      {/* Section 2: Prompt */}
      <section className="mb-8 rounded-xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-cobalt-deep">
            Step 2
          </span>
          <h2 className="font-display text-base text-charcoal">Copy this prompt into an AI</h2>
        </div>
        <p className="mb-3 text-[0.78rem] text-txt-secondary">
          Paste into ChatGPT, Claude, or another AI. It should return a complete
          HTML page — paste that back below in step 3.
        </p>

        <div className="relative">
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-3 top-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-paper px-3 text-[0.72rem] font-medium text-txt-secondary shadow-sm transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
          >
            {copied ? (
              <>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="#067340" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5L6 10l5-6" /></svg>
                Copied
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="5" width="7" height="7" rx="1" />
                  <path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" />
                </svg>
                Copy
              </>
            )}
          </button>
          <pre className="max-h-[280px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-cream/40 p-4 pr-24 font-mono text-[0.72rem] leading-relaxed text-charcoal">
            {prompt}
          </pre>
        </div>
      </section>

      {/* Section 3: Paste */}
      <section className="mb-8 rounded-xl border border-border bg-surface p-6">
        <div className="mb-4 flex items-baseline gap-2">
          <span className="font-display text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-cobalt-deep">
            Step 3
          </span>
          <h2 className="font-display text-base text-charcoal">Paste the HTML result</h2>
        </div>

        {validation.kind === "errors" && (
          <div className="mb-3 rounded-lg border border-red/30 bg-red/5 px-4 py-3 text-[0.78rem] text-red">
            <div className="mb-1.5 font-medium">
              {validation.errors.length === 1
                ? "1 validation issue"
                : `${validation.errors.length} validation issues`}
            </div>
            <ul className="space-y-1 text-[0.7rem] leading-relaxed">
              {validation.errors.map((e, i) => (
                <li key={i} className="break-words">{e}</li>
              ))}
            </ul>
          </div>
        )}

        <textarea
          value={pastedHtml}
          onChange={(e) => setPastedHtml(e.target.value)}
          placeholder="<!DOCTYPE html>..."
          spellCheck={false}
          className={`min-h-[220px] w-full rounded-lg border bg-paper px-3 py-2 font-mono text-[0.75rem] leading-relaxed text-charcoal placeholder:text-txt-muted focus:outline-none focus:ring-2 ${
            validation.kind === "errors"
              ? "border-red/50 focus:border-red focus:ring-red/20"
              : "border-border focus:border-cobalt focus:ring-cobalt/20"
          }`}
        />

        {validation.kind === "ok" && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[0.75rem] text-green">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7.5L6 10l5-6" />
            </svg>
            Looks good — HTML passes validation.
          </p>
        )}
      </section>

      {/* Footer */}
      {submitError && (
        <div className="mb-4 rounded-lg border border-red/30 bg-red/5 px-4 py-3 text-[0.78rem] text-red">
          {submitError}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <Link
          href="/templates"
          className="inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="inline-flex h-9 items-center rounded-lg bg-cobalt px-4 text-[0.78rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          {submitting ? "Creating..." : "Create template"}
        </button>
      </div>
    </div>
  );
}
