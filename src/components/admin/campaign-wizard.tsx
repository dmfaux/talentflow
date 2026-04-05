"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────

export type CampaignWizardMode = "create" | "edit";

export interface CampaignWizardProps {
  mode: CampaignWizardMode;
  /** Required when mode === "edit". */
  campaignId?: string;
  /** Pre-populate the form (edit mode loads campaign data into this). */
  initialForm?: Partial<FormData>;
  /** Starting step; edit mode typically opens on Review so users can jump around. */
  initialStep?: number;
  /** Prevent the user from changing the client (e.g., edit mode). */
  lockClient?: boolean;
  /** Where the Cancel link points. */
  cancelHref: string;
  /** Breadcrumb label shown at the top ("New Campaign", "Edit …"). */
  breadcrumbLabel: string;
}

interface Client {
  id: string;
  slug: string;
  name: string;
  branding_logo_url: string | null;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  brand_accent_color: string | null;
  brand_text_color: string | null;
  logo_background: string | null;
  logo_position: string | null;
}

interface GatingOption {
  value: string;
}

interface GatingQuestion {
  id: string;
  label: string;
  type: "select";
  options: GatingOption[];
  pass_criteria: string[];
}

export interface FormData {
  client_id: string;
  slug: string;
  role_title: string;
  department: string;
  location: string;
  employment_type: string;
  salary_range_min: string;
  salary_range_max: string;
  gating_config: GatingQuestion[];
  must_haves: string[];
  nice_to_haves: string[];
  dealbreakers: string[];
  dimension_weights: { skills: number; experience: number; progression: number; tenure: number };
  template_id: string;
}

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  owner_client_id: string | null;
  is_active: boolean;
}

const STEPS = ["Basics", "Gating Questions", "Scoring Rubric", "Landing Page", "Review"] as const;
const EMPLOYMENT_TYPES = ["Permanent", "Contract", "Temporary", "Freelance"];

const INITIAL: FormData = {
  client_id: "",
  slug: "",
  role_title: "",
  department: "",
  location: "",
  employment_type: "",
  salary_range_min: "",
  salary_range_max: "",
  gating_config: [],
  must_haves: [""],
  nice_to_haves: [""],
  dealbreakers: [""],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
  template_id: "",
};

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Shared styles ────────────────────────────────────────────────────

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-cream/40 px-3.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20";
const labelClass =
  "mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted";
const smallInputClass =
  "h-9 w-full rounded-lg border border-border bg-cream/40 px-3 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20";

// ── Component ────────────────────────────────────────────────────────

export function CampaignWizard({
  mode,
  campaignId,
  initialForm,
  initialStep = 0,
  lockClient = false,
  cancelHref,
  breadcrumbLabel,
}: CampaignWizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [form, setForm] = useState<FormData>({ ...INITIAL, ...initialForm });
  // Track if the user has manually touched the slug (or if edit mode
  // loaded an existing slug). In edit mode we treat the slug as manual
  // so auto-slugify from role_title changes doesn't clobber it.
  const [slugManualInit] = useState(
    () => mode === "edit" || Boolean(initialForm?.slug)
  );
  const [clients, setClients] = useState<Client[]>([]);
  const [slugManual, setSlugManual] = useState(slugManualInit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [slugMessage, setSlugMessage] = useState("");
  const [slugSuggestion, setSlugSuggestion] = useState("");

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => setClients(res.data ?? []));
  }, []);

  // Debounced slug validation + availability check (format + uniqueness per client)
  useEffect(() => {
    const slug = form.slug.trim();
    if (!slug) {
      setSlugStatus("idle");
      setSlugMessage("");
      setSlugSuggestion("");
      return;
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setSlugStatus("invalid");
      setSlugMessage("Lowercase letters, numbers, and hyphens only (no leading/trailing hyphens)");
      setSlugSuggestion("");
      return;
    }
    if (!form.client_id) {
      // Format is valid but we can't check uniqueness without a client
      setSlugStatus("idle");
      setSlugMessage("");
      setSlugSuggestion("");
      return;
    }
    setSlugStatus("checking");
    setSlugMessage("");
    setSlugSuggestion("");
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      const params = new URLSearchParams({
        client_id: form.client_id,
        slug,
      });
      if (mode === "edit" && campaignId) params.set("exclude_id", campaignId);
      fetch(`/api/admin/campaigns/check-slug?${params.toString()}`, {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((res) => {
          const data = res.data ?? {};
          if (data.available) {
            setSlugStatus("available");
            setSlugMessage("");
            setSlugSuggestion("");
          } else {
            setSlugStatus("taken");
            setSlugMessage(data.error || "This slug is already taken for this client");
            setSlugSuggestion(data.suggestion || "");
          }
        })
        .catch((err) => {
          if (err.name === "AbortError") return;
          setSlugStatus("idle");
        });
    }, 400);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [form.slug, form.client_id, mode, campaignId]);

  // Fetch templates when entering Step 3 / client changes. In edit
  // mode we also load them eagerly because the user may open directly
  // on the Review step, which needs template details for the summary.
  useEffect(() => {
    const shouldLoad = step >= 3 || mode === "edit";
    if (!shouldLoad || !form.client_id) return;
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError("");
    fetch(`/api/admin/templates?client_id=${encodeURIComponent(form.client_id)}`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        const list: Template[] = res.data ?? [];
        setTemplates(list);
        // Auto-select bespoke if available and nothing selected yet
        setForm((prev) => {
          if (prev.template_id) return prev;
          const bespoke = list.find((t) => t.owner_client_id === prev.client_id);
          if (bespoke) return { ...prev, template_id: bespoke.id };
          return prev;
        });
      })
      .catch(() => {
        if (!cancelled) setTemplatesError("Failed to load templates");
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.client_id, step, mode]);

  function updateForm(patch: Partial<FormData>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handleRoleTitleChange(value: string) {
    const patch: Partial<FormData> = { role_title: value };
    if (!slugManual) patch.slug = slugify(value);
    updateForm(patch);
  }

  // ── Validation ───────────────────────────────────────────────────

  function validateStep(s: number): boolean {
    const errs: Record<string, string> = {};

    if (s === 0) {
      if (!form.client_id) errs.client_id = "Select a client";
      if (!form.role_title.trim()) errs.role_title = "Role title is required";
      if (!form.slug.trim()) errs.slug = "Slug is required";
      else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug))
        errs.slug = "Lowercase alphanumeric and hyphens only";
      else if (slugStatus === "taken") errs.slug = slugMessage || "This slug is already taken for this client";
      else if (slugStatus === "checking") errs.slug = "Checking slug availability…";
    }

    if (s === 1) {
      if (form.gating_config.length === 0)
        errs.gating = "Add at least one gating question";
      form.gating_config.forEach((q, i) => {
        if (!q.label.trim()) errs[`q_${i}_label`] = "Question text is required";
        if (q.options.length < 2) errs[`q_${i}_options`] = "At least 2 options required";
        if (q.pass_criteria.length === 0) errs[`q_${i}_pass`] = "Select passing options";
      });
    }

    if (s === 2) {
      const w = form.dimension_weights;
      const total = w.skills + w.experience + w.progression + w.tenure;
      if (total !== 100) errs.weights = `Weights must sum to 100% (currently ${total}%)`;
    }

    if (s === 3) {
      if (!form.template_id) errs.template_id = "Select a template";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function goNext() {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // ── Gating helpers ───────────────────────────────────────────────

  function addQuestion() {
    updateForm({
      gating_config: [
        ...form.gating_config,
        { id: uid(), label: "", type: "select", options: [{ value: "" }, { value: "" }], pass_criteria: [] },
      ],
    });
  }

  function removeQuestion(idx: number) {
    updateForm({ gating_config: form.gating_config.filter((_, i) => i !== idx) });
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const arr = [...form.gating_config];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    updateForm({ gating_config: arr });
  }

  function updateQuestion(idx: number, patch: Partial<GatingQuestion>) {
    const arr = [...form.gating_config];
    arr[idx] = { ...arr[idx], ...patch };
    updateForm({ gating_config: arr });
  }

  function addOption(qIdx: number) {
    const arr = [...form.gating_config];
    arr[qIdx] = { ...arr[qIdx], options: [...arr[qIdx].options, { value: "" }] };
    updateForm({ gating_config: arr });
  }

  function removeOption(qIdx: number, oIdx: number) {
    const arr = [...form.gating_config];
    const q = arr[qIdx];
    const removedVal = q.options[oIdx].value;
    arr[qIdx] = {
      ...q,
      options: q.options.filter((_, i) => i !== oIdx),
      pass_criteria: q.pass_criteria.filter((v) => v !== removedVal),
    };
    updateForm({ gating_config: arr });
  }

  function updateOption(qIdx: number, oIdx: number, value: string) {
    const arr = [...form.gating_config];
    const oldVal = arr[qIdx].options[oIdx].value;
    arr[qIdx] = {
      ...arr[qIdx],
      options: arr[qIdx].options.map((o, i) => (i === oIdx ? { value } : o)),
      pass_criteria: arr[qIdx].pass_criteria.map((v) => (v === oldVal ? value : v)),
    };
    updateForm({ gating_config: arr });
  }

  function togglePassCriteria(qIdx: number, value: string) {
    const arr = [...form.gating_config];
    const q = arr[qIdx];
    arr[qIdx] = {
      ...q,
      pass_criteria: q.pass_criteria.includes(value)
        ? q.pass_criteria.filter((v) => v !== value)
        : [...q.pass_criteria, value],
    };
    updateForm({ gating_config: arr });
  }

  // ── Dynamic list helpers ─────────────────────────────────────────

  function updateList(key: "must_haves" | "nice_to_haves" | "dealbreakers", idx: number, value: string) {
    const arr = [...form[key]];
    arr[idx] = value;
    updateForm({ [key]: arr });
  }

  function addListItem(key: "must_haves" | "nice_to_haves" | "dealbreakers") {
    updateForm({ [key]: [...form[key], ""] });
  }

  function removeListItem(key: "must_haves" | "nice_to_haves" | "dealbreakers", idx: number) {
    updateForm({ [key]: form[key].filter((_, i) => i !== idx) });
  }

  // ── Submit ───────────────────────────────────────────────────────

  async function submit(status: "draft" | "active") {
    if (!validateStep(step)) return;
    setSubmitting(true);
    setSubmitError("");

    const body = {
      client_id: form.client_id,
      slug: form.slug,
      role_title: form.role_title,
      department: form.department || null,
      location: form.location || null,
      employment_type: form.employment_type || null,
      salary_range_min: form.salary_range_min ? parseInt(form.salary_range_min) : null,
      salary_range_max: form.salary_range_max ? parseInt(form.salary_range_max) : null,
      gating_config: form.gating_config,
      scoring_rubric: {
        must_haves: form.must_haves.filter((s) => s.trim()),
        nice_to_haves: form.nice_to_haves.filter((s) => s.trim()),
        dealbreakers: form.dealbreakers.filter((s) => s.trim()),
        dimension_weights: form.dimension_weights,
      },
      template_id: form.template_id,
      status,
    };

    try {
      const url =
        mode === "edit"
          ? `/api/admin/campaigns/${campaignId}`
          : "/api/admin/campaigns";
      const res = await fetch(url, {
        method: mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(
          data.error ||
            (mode === "edit" ? "Failed to save campaign" : "Failed to create campaign")
        );
        return;
      }

      if (mode === "edit") {
        // Land back on the campaign detail page so the user can see the
        // updated state (and for published campaigns, the live URL).
        router.push(`/campaigns/${campaignId}`);
      } else {
        router.push("/campaigns");
      }
    } catch {
      setSubmitError("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/campaigns" className="hover:text-charcoal transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">{breadcrumbLabel}</span>
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <button
              onClick={() => { if (i < step) setStep(i); }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-semibold transition-colors cursor-pointer ${
                i < step
                  ? "bg-accent text-ink"
                  : i === step
                    ? "bg-charcoal text-white"
                    : "bg-cream text-txt-muted border border-border"
              }`}
            >
              {i < step ? (
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 6.5L5 9l4.5-6" />
                </svg>
              ) : (
                i + 1
              )}
            </button>
            <span
              className={`hidden sm:block text-[0.7rem] font-medium whitespace-nowrap ${
                i <= step ? "text-charcoal" : "text-txt-muted"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-1 h-px flex-1 ${
                  i < step ? "bg-accent" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-border bg-surface p-8">
        {/* ── Step 0: Basics ────────────────────────────────────── */}
        {step === 0 && (
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-charcoal">Campaign Basics</h2>

            <div>
              <label htmlFor="client_id" className={labelClass}>
                Client <span className="text-red">*</span>
              </label>
              <select
                id="client_id"
                value={form.client_id}
                onChange={(e) => updateForm({ client_id: e.target.value })}
                disabled={lockClient}
                className={`${inputClass} ${errors.client_id ? "border-red" : ""} ${lockClient ? "cursor-not-allowed opacity-70" : ""}`}
              >
                <option value="">Select a client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {lockClient && (
                <p className="mt-1 text-[0.7rem] text-txt-muted">
                  Client can&apos;t change on an existing campaign.
                </p>
              )}
              {errors.client_id && <p className="mt-1 text-xs text-red">{errors.client_id}</p>}
            </div>

            {form.client_id && (
              <ClientBrandingSummary
                client={clients.find((c) => c.id === form.client_id)}
              />
            )}

            <div>
              <label htmlFor="role_title" className={labelClass}>
                Role Title <span className="text-red">*</span>
              </label>
              <input
                id="role_title"
                value={form.role_title}
                onChange={(e) => handleRoleTitleChange(e.target.value)}
                placeholder="Senior Software Engineer"
                className={`${inputClass} ${errors.role_title ? "border-red" : ""}`}
              />
              {errors.role_title && <p className="mt-1 text-xs text-red">{errors.role_title}</p>}
            </div>

            <div>
              <label htmlFor="slug" className={labelClass}>
                Campaign Slug <span className="text-red">*</span>
              </label>
              <div className="relative">
                <input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugManual(true);
                    updateForm({ slug: e.target.value });
                  }}
                  placeholder="senior-software-engineer"
                  className={`${inputClass} pr-9 ${
                    errors.slug || slugStatus === "taken" || slugStatus === "invalid"
                      ? "border-red"
                      : slugStatus === "available"
                        ? "border-green"
                        : ""
                  }`}
                />
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  {slugStatus === "checking" && (
                    <svg className="h-3.5 w-3.5 animate-spin text-txt-muted" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  )}
                  {slugStatus === "available" && (
                    <svg className="h-4 w-4 text-green" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 8.5L6.5 12L13 4" />
                    </svg>
                  )}
                  {(slugStatus === "taken" || slugStatus === "invalid") && (
                    <svg className="h-4 w-4 text-red" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="8" cy="8" r="6.5" />
                      <path d="M8 5v3.5M8 11v.01" />
                    </svg>
                  )}
                </div>
              </div>
              <p className="mt-1.5 font-mono text-[0.7rem] text-txt-muted">
                {clients.find((c) => c.id === form.client_id)?.slug || "client"}.talentstream.co.za/{form.slug || "campaign-slug"}
              </p>
              {slugStatus === "invalid" && !errors.slug && (
                <p className="mt-1 text-xs text-red">{slugMessage}</p>
              )}
              {slugStatus === "taken" && !errors.slug && (
                <p className="mt-1 text-xs text-red">
                  {slugMessage}
                  {slugSuggestion && (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => updateForm({ slug: slugSuggestion })}
                        className="font-medium text-accent hover:underline cursor-pointer"
                      >
                        Use &ldquo;{slugSuggestion}&rdquo;
                      </button>
                    </>
                  )}
                </p>
              )}
              {slugStatus === "available" && !errors.slug && (
                <p className="mt-1 text-xs text-green">Available</p>
              )}
              {errors.slug && <p className="mt-1 text-xs text-red">{errors.slug}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="department" className={labelClass}>Department</label>
                <input id="department" value={form.department} onChange={(e) => updateForm({ department: e.target.value })} placeholder="Engineering" className={inputClass} />
              </div>
              <div>
                <label htmlFor="location" className={labelClass}>Location</label>
                <input id="location" value={form.location} onChange={(e) => updateForm({ location: e.target.value })} placeholder="Cape Town" className={inputClass} />
              </div>
            </div>

            <div>
              <label htmlFor="employment_type" className={labelClass}>Employment Type</label>
              <select id="employment_type" value={form.employment_type} onChange={(e) => updateForm({ employment_type: e.target.value })} className={inputClass}>
                <option value="">Select...</option>
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="salary_min" className={labelClass}>Salary Min (ZAR)</label>
                <input id="salary_min" type="number" value={form.salary_range_min} onChange={(e) => updateForm({ salary_range_min: e.target.value })} placeholder="450000" className={inputClass} />
              </div>
              <div>
                <label htmlFor="salary_max" className={labelClass}>Salary Max (ZAR)</label>
                <input id="salary_max" type="number" value={form.salary_range_max} onChange={(e) => updateForm({ salary_range_max: e.target.value })} placeholder="650000" className={inputClass} />
              </div>
            </div>
          </div>
        )}

        {/* ── Step 1: Gating Questions ─────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-charcoal">Gating Questions</h2>
            <p className="text-xs text-txt-muted">Add 3–5 screening questions. Candidates must match the pass criteria to proceed.</p>
            {errors.gating && <p className="text-xs text-red">{errors.gating}</p>}

            {form.gating_config.map((q, qIdx) => (
              <div key={q.id} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">
                    Question {qIdx + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => moveQuestion(qIdx, -1)} disabled={qIdx === 0} className="p-1 text-txt-muted hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3.5 8.5L7 5l3.5 3.5" /></svg>
                    </button>
                    <button onClick={() => moveQuestion(qIdx, 1)} disabled={qIdx === form.gating_config.length - 1} className="p-1 text-txt-muted hover:text-charcoal disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3.5 5.5L7 9l3.5-3.5" /></svg>
                    </button>
                    <button onClick={() => removeQuestion(qIdx)} className="p-1 text-txt-muted hover:text-red cursor-pointer">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M3 3l8 8M11 3l-8 8" /></svg>
                    </button>
                  </div>
                </div>

                <div>
                  <label className={labelClass}>Question Text</label>
                  <input
                    value={q.label}
                    onChange={(e) => updateQuestion(qIdx, { label: e.target.value })}
                    placeholder="e.g. Do you have a valid driver's license?"
                    className={`${smallInputClass} ${errors[`q_${qIdx}_label`] ? "border-red" : ""}`}
                  />
                </div>

                <div>
                  <label className={labelClass}>Options</label>
                  {errors[`q_${qIdx}_options`] && <p className="mb-1 text-xs text-red">{errors[`q_${qIdx}_options`]}</p>}
                  <div className="space-y-2">
                    {q.options.map((opt, oIdx) => (
                      <div key={oIdx} className="flex items-center gap-2">
                        <input
                          value={opt.value}
                          onChange={(e) => updateOption(qIdx, oIdx, e.target.value)}
                          placeholder={`Option ${oIdx + 1}`}
                          className={`${smallInputClass} flex-1`}
                        />
                        <label className="flex items-center gap-1.5 text-[0.7rem] text-txt-secondary whitespace-nowrap cursor-pointer">
                          <input
                            type="checkbox"
                            checked={q.pass_criteria.includes(opt.value) && opt.value !== ""}
                            onChange={() => opt.value && togglePassCriteria(qIdx, opt.value)}
                            className="accent-accent"
                          />
                          Pass
                        </label>
                        {q.options.length > 2 && (
                          <button onClick={() => removeOption(qIdx, oIdx)} className="p-1 text-txt-muted hover:text-red cursor-pointer">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {errors[`q_${qIdx}_pass`] && <p className="mt-1 text-xs text-red">{errors[`q_${qIdx}_pass`]}</p>}
                  <button
                    onClick={() => addOption(qIdx)}
                    className="mt-2 text-[0.72rem] font-medium text-accent hover:underline cursor-pointer"
                  >
                    + Add option
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={addQuestion}
              disabled={form.gating_config.length >= 5}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border bg-transparent px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:border-txt-muted cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-border"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
              {form.gating_config.length >= 5 ? "Maximum 5 questions" : "Add Question"}
            </button>
          </div>
        )}

        {/* ── Step 2: Scoring Rubric ───────────────────────────── */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold text-charcoal">Scoring Rubric</h2>

            {(["must_haves", "nice_to_haves", "dealbreakers"] as const).map((key) => (
              <div key={key}>
                <label className={labelClass}>
                  {key === "must_haves" ? "Must-Haves" : key === "nice_to_haves" ? "Nice-to-Haves" : "Dealbreakers"}
                </label>
                <div className="space-y-2">
                  {form[key].map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        value={item}
                        onChange={(e) => updateList(key, idx, e.target.value)}
                        placeholder={key === "must_haves" ? "e.g. 5+ years Python experience" : key === "dealbreakers" ? "e.g. No relevant qualifications" : "e.g. Cloud certification"}
                        className={`${smallInputClass} flex-1`}
                      />
                      {form[key].length > 1 && (
                        <button onClick={() => removeListItem(key, idx)} className="p-1 text-txt-muted hover:text-red cursor-pointer">
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" /></svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button onClick={() => addListItem(key)} className="mt-2 text-[0.72rem] font-medium text-accent hover:underline cursor-pointer">
                  + Add item
                </button>
              </div>
            ))}

            <div>
              <label className={labelClass}>Dimension Weights (must total 100%)</label>
              {errors.weights && <p className="mb-2 text-xs text-red">{errors.weights}</p>}
              <div className="grid grid-cols-2 gap-3">
                {(["skills", "experience", "progression", "tenure"] as const).map((dim) => (
                  <div key={dim} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5">
                    <span className="text-xs font-medium text-txt-secondary capitalize flex-1">
                      {dim === "skills" ? "Skills Match" : dim === "experience" ? "Experience Depth" : dim === "progression" ? "Career Progression" : "Tenure Patterns"}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={form.dimension_weights[dim]}
                        onChange={(e) =>
                          updateForm({
                            dimension_weights: {
                              ...form.dimension_weights,
                              [dim]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                            },
                          })
                        }
                        className="h-8 w-14 rounded border border-border bg-cream/40 px-2 text-center font-mono text-sm text-charcoal outline-none focus:border-accent"
                      />
                      <span className="text-xs text-txt-muted">%</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 font-mono text-xs text-txt-muted">
                Total: {form.dimension_weights.skills + form.dimension_weights.experience + form.dimension_weights.progression + form.dimension_weights.tenure}%
              </p>
            </div>
          </div>
        )}

        {/* ── Step 3: Landing Page Template Gallery ────────────── */}
        {step === 3 && (
          <TemplateGalleryStep
            templates={templates}
            loading={templatesLoading}
            error={templatesError}
            selectedTemplateId={form.template_id}
            onSelect={(id) => updateForm({ template_id: id })}
            clientId={form.client_id}
            clientSlug={clients.find((c) => c.id === form.client_id)?.slug}
            form={form}
            previewDevice={previewDevice}
            setPreviewDevice={setPreviewDevice}
            validationError={errors.template_id}
          />
        )}

        {/* ── Step 4: Review ───────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold text-charcoal">
              {mode === "edit" ? "Review & Save" : "Review & Publish"}
            </h2>

            {submitError && (
              <div className="rounded-lg bg-red-light px-4 py-2.5 text-sm text-red">{submitError}</div>
            )}

            {/* Basics summary */}
            <div className="rounded-lg border border-border p-4 space-y-2">
              <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">Basics</h3>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                <div><span className="text-txt-muted">Client:</span> <span className="text-charcoal">{clients.find((c) => c.id === form.client_id)?.name ?? "—"}</span></div>
                <div><span className="text-txt-muted">Role:</span> <span className="text-charcoal">{form.role_title || "—"}</span></div>
                <div><span className="text-txt-muted">Slug:</span> <span className="font-mono text-xs text-charcoal">{form.slug || "—"}</span></div>
                <div><span className="text-txt-muted">Type:</span> <span className="text-charcoal">{form.employment_type || "—"}</span></div>
                <div><span className="text-txt-muted">Location:</span> <span className="text-charcoal">{form.location || "—"}</span></div>
                <div><span className="text-txt-muted">Department:</span> <span className="text-charcoal">{form.department || "—"}</span></div>
              </div>
            </div>

            {/* Gating summary */}
            <div className="rounded-lg border border-border p-4 space-y-2">
              <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">
                Gating Questions ({form.gating_config.length})
              </h3>
              {form.gating_config.map((q, i) => (
                <div key={q.id} className="text-sm text-charcoal">
                  <span className="text-txt-muted">{i + 1}.</span> {q.label}{" "}
                  <span className="text-xs text-txt-muted">
                    ({q.options.length} options, {q.pass_criteria.length} pass)
                  </span>
                </div>
              ))}
            </div>

            {/* Rubric summary */}
            <div className="rounded-lg border border-border p-4 space-y-2">
              <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">Scoring Rubric</h3>
              <div className="text-sm space-y-1">
                <p><span className="text-txt-muted">Must-haves:</span> <span className="text-charcoal">{form.must_haves.filter((s) => s.trim()).length} items</span></p>
                <p><span className="text-txt-muted">Nice-to-haves:</span> <span className="text-charcoal">{form.nice_to_haves.filter((s) => s.trim()).length} items</span></p>
                <p><span className="text-txt-muted">Dealbreakers:</span> <span className="text-charcoal">{form.dealbreakers.filter((s) => s.trim()).length} items</span></p>
                <p className="font-mono text-xs text-txt-muted">
                  Weights: Skills {form.dimension_weights.skills}% · Experience {form.dimension_weights.experience}% · Progression {form.dimension_weights.progression}% · Tenure {form.dimension_weights.tenure}%
                </p>
              </div>
            </div>

            {/* Template summary */}
            <div className="rounded-lg border border-border p-4">
              <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">Landing Page</h3>
              {(() => {
                const selected = templates.find((t) => t.id === form.template_id);
                if (!selected) {
                  return <p className="mt-1 text-sm text-charcoal">No template selected</p>;
                }
                return (
                  <div className="mt-2 flex gap-3">
                    <div className="h-[80px] w-[120px] shrink-0 overflow-hidden rounded border border-border bg-cream/40">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={selected.thumbnail_url ?? "/templates/default.svg"}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="font-display text-[1rem] text-charcoal">{selected.name}</p>
                      {selected.description && (
                        <p className="mt-0.5 text-xs text-txt-muted line-clamp-2">{selected.description}</p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Navigation ──────────────────────────────────────── */}
        <div className="mt-8 flex items-center justify-between border-t border-border pt-5">
          {step > 0 ? (
            <button
              onClick={goBack}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8.5 3L4.5 7l4 4" /></svg>
              Back
            </button>
          ) : (
            <Link href={cancelHref} className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal">
              Cancel
            </Link>
          )}

          {step < STEPS.length - 1 ? (
            <button
              onClick={goNext}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-charcoal px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-charcoal-light cursor-pointer"
            >
              Next
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5.5 3L9.5 7l-4 4" /></svg>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => submit("draft")}
                disabled={submitting}
                className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {mode === "edit" ? "Save Changes" : "Save as Draft"}
              </button>
              <button
                onClick={() => submit("active")}
                disabled={submitting}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.8rem] font-medium text-ink transition-colors hover:bg-accent-light hover:text-white disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {submitting && (
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {mode === "edit" ? "Save & Publish" : "Publish Campaign"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Client branding summary ─────────────────────────────────────────

function ClientBrandingSummary({ client }: { client: Client | undefined }) {
  if (!client) return null;

  const swatches = [
    { label: "Primary", value: client.brand_primary_color },
    { label: "Secondary", value: client.brand_secondary_color },
    { label: "Accent", value: client.brand_accent_color },
    { label: "Text", value: client.brand_text_color },
  ].filter((s) => s.value);

  const hasAnyBranding = client.branding_logo_url || swatches.length > 0;

  if (!hasAnyBranding) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-cream/40 p-4 text-xs text-txt-muted">
        <p className="font-medium text-txt-secondary">No branding set for {client.name}</p>
        <p className="mt-1">
          Add a logo and brand colours on the{" "}
          <a href={`/clients/${client.id}/edit`} className="text-cobalt-deep underline hover:text-charcoal">
            client edit page
          </a>{" "}
          so campaign landing pages can match the client&apos;s brand.
        </p>
      </div>
    );
  }

  const logoBg = client.logo_background ?? "light";
  const bgStyle =
    logoBg === "transparent"
      ? {
          backgroundImage:
            "linear-gradient(45deg, #e5dfd0 25%, transparent 25%), linear-gradient(-45deg, #e5dfd0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e5dfd0 75%), linear-gradient(-45deg, transparent 75%, #e5dfd0 75%)",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
        }
      : { backgroundColor: logoBg === "light" ? "#ffffff" : "#0b0f1c" };

  const promptSnippet = swatches
    .map((s) => `${s.label.toLowerCase()}: ${s.value}`)
    .join(", ");

  return (
    <div className="rounded-lg border border-border bg-cream/40 p-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">
        {client.name} — Brand Kit
      </p>
      <p className="mt-1 text-xs text-txt-secondary">
        This campaign will inherit the client&apos;s branding. When generating the landing
        page HTML with Claude, use these colours in your prompt so the page matches the client&apos;s brand.
      </p>

      <div className="mt-3 flex items-center gap-3">
        {client.branding_logo_url && (
          <div
            className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-border"
            style={bgStyle}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={client.branding_logo_url}
              alt=""
              className="max-h-[80%] max-w-[80%] object-contain"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {swatches.map((s) => (
            <div key={s.label} className="flex items-center gap-2 rounded-md border border-border bg-paper px-2 py-1">
              <span
                className="h-4 w-4 rounded border border-border"
                style={{ backgroundColor: s.value ?? undefined }}
              />
              <span className="text-[0.65rem] font-medium text-charcoal">{s.label}</span>
              <span className="font-mono text-[0.65rem] text-txt-muted">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {promptSnippet && (
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 truncate rounded border border-border bg-paper px-2.5 py-1.5 font-mono text-[0.65rem] text-charcoal">
            {promptSnippet}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(promptSnippet)}
            className="inline-flex h-7 items-center rounded-md border border-border bg-paper px-2.5 text-[0.65rem] font-medium text-txt-secondary transition-colors hover:bg-cream cursor-pointer"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}

// ── Template Gallery Step ───────────────────────────────────────────

interface TemplateGalleryStepProps {
  templates: Template[];
  loading: boolean;
  error: string;
  selectedTemplateId: string;
  onSelect: (id: string) => void;
  clientId: string;
  clientSlug: string | undefined;
  form: FormData;
  previewDevice: "desktop" | "mobile";
  setPreviewDevice: (d: "desktop" | "mobile") => void;
  validationError?: string;
}

function TemplateGalleryStep({
  templates,
  loading,
  error,
  selectedTemplateId,
  onSelect,
  clientId,
  clientSlug,
  form,
  previewDevice,
  setPreviewDevice,
  validationError,
}: TemplateGalleryStepProps) {
  // Sort: bespoke first (for this client), then shared library (null owner)
  const sorted = [...templates].sort((a, b) => {
    const aBespoke = a.owner_client_id === clientId ? 0 : 1;
    const bBespoke = b.owner_client_id === clientId ? 0 : 1;
    return aBespoke - bBespoke;
  });

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const previewUrl = (() => {
    if (!selectedTemplate || !clientId) return "";
    const params = new URLSearchParams();
    params.set("clientId", clientId);
    params.set("roleTitle", form.role_title || "Sample Role");
    params.set("department", form.department);
    params.set("location", form.location);
    params.set("employmentType", form.employment_type);
    if (form.salary_range_min) params.set("salaryMin", form.salary_range_min);
    if (form.salary_range_max) params.set("salaryMax", form.salary_range_max);
    params.set("gating", JSON.stringify(form.gating_config));
    return `/preview/template/${selectedTemplate.key}?${params.toString()}`;
  })();

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-charcoal">Landing Page Template</h2>
        <p className="mt-1 text-xs text-txt-muted">
          Choose a template — candidates will see this exactly.
        </p>
      </div>

      {validationError && <p className="text-xs text-red">{validationError}</p>}

      {!clientId && (
        <div className="rounded-lg border border-dashed border-border bg-cream/40 p-6 text-center text-xs text-txt-muted">
          Pick a client on Step 1 to see available templates.
        </div>
      )}

      {clientId && loading && (
        <div className="rounded-lg border border-dashed border-border bg-cream/40 p-6 text-center text-xs text-txt-muted">
          Loading templates...
        </div>
      )}

      {clientId && !loading && error && (
        <div className="rounded-lg border border-red/30 bg-red-light p-4 text-xs text-red">
          {error}
        </div>
      )}

      {clientId && !loading && !error && sorted.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-cream/40 p-6 text-center text-xs text-txt-muted">
          No templates available for this client.
        </div>
      )}

      {clientId && !loading && !error && sorted.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sorted.map((template) => {
              const isSelected = template.id === selectedTemplateId;
              const isBespoke = template.owner_client_id !== null;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => onSelect(template.id)}
                  className={`group text-left overflow-hidden rounded-xl border-2 transition-all cursor-pointer ${
                    isSelected
                      ? "border-cobalt ring-2 ring-cobalt/20"
                      : "border-border hover:border-border-strong"
                  } ${isBespoke ? "shadow-sm" : ""}`}
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden rounded-t-xl bg-cream/40">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={template.thumbnail_url ?? "/templates/default.svg"}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      {isBespoke ? (
                        <span
                          className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] rounded px-2 py-0.5"
                          style={{
                            backgroundColor: "var(--color-vermillion-soft)",
                            color: "var(--color-vermillion-deep)",
                          }}
                        >
                          Bespoke
                        </span>
                      ) : (
                        <span className="text-[0.6rem] font-semibold uppercase tracking-[0.14em] rounded px-2 py-0.5 bg-canvas-2 text-ink-muted">
                          Shared Library
                        </span>
                      )}
                      {isBespoke && (
                        <span className="text-[0.6rem] italic text-txt-muted">Exclusive</span>
                      )}
                    </div>
                    <h3 className="mt-2 font-display text-[1.1rem] text-ink">{template.name}</h3>
                    {template.description && (
                      <p className="text-xs text-ink-muted mt-1 line-clamp-2">
                        {template.description}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Live preview */}
          {selectedTemplate && previewUrl && (
            <div className="pt-2">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted">
                  Preview
                </p>
                <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-cream/40 p-1">
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("desktop")}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.7rem] font-medium transition-colors cursor-pointer ${
                      previewDevice === "desktop"
                        ? "bg-paper text-charcoal shadow-sm"
                        : "text-txt-muted hover:text-charcoal"
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="2.5" width="11" height="7" rx="1" /><path d="M5 12h4M7 10v2" strokeLinecap="round" /></svg>
                    Desktop
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("mobile")}
                    className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.7rem] font-medium transition-colors cursor-pointer ${
                      previewDevice === "mobile"
                        ? "bg-paper text-charcoal shadow-sm"
                        : "text-txt-muted hover:text-charcoal"
                    }`}
                  >
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="1.5" width="6" height="11" rx="1" /><path d="M6.5 11h1" strokeLinecap="round" /></svg>
                    Mobile
                  </button>
                </div>
              </div>
              <div
                className={previewDevice === "mobile" ? "mx-auto max-w-[390px]" : ""}
              >
                <div
                  className="overflow-hidden rounded-xl border border-border bg-paper"
                  style={{ boxShadow: "0 12px 32px -16px rgba(11, 15, 28, 0.18)" }}
                >
                  <div className="flex items-center gap-3 border-b border-border bg-canvas-2 px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#d9b8b0]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#dfc9a0]" />
                      <span className="h-2.5 w-2.5 rounded-full bg-[#b4c7a8]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex h-6 items-center justify-center rounded-md border border-border bg-paper px-3">
                        <span className="font-mono text-[0.65rem] text-ink-muted truncate">
                          {clientSlug || "client"}.talentstream.co.za/{form.slug || "campaign"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <iframe
                    src={previewUrl}
                    className="w-full bg-paper"
                    style={{
                      height: previewDevice === "mobile" ? "700px" : "600px",
                      border: 0,
                    }}
                    title="Template preview"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
