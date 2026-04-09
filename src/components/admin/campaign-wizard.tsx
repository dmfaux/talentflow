"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { buildTemplatePrompt, type BrandColors } from "@/lib/prompt-builder";
import { validateHtmlTemplate, replaceSlots, type SlotData } from "@/lib/slots";
import { renderMarkdown } from "@/lib/markdown";

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
  role_description: string;
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
  html_template: string;
  design_brief: string;
}

const STEPS = ["Basics", "Gating Questions", "Scoring Rubric", "Landing Page", "Review"] as const;
const EMPLOYMENT_TYPES = ["Permanent", "Contract", "Temporary", "Freelance"];
// Hard cap on gating option text. Long answers get truncated inside
// <select> dropdowns on the candidate form (especially on mobile), so
// we block them at authoring time.
const GATING_OPTION_MAX_LENGTH = 80;

const INITIAL: FormData = {
  client_id: "",
  slug: "",
  role_title: "",
  role_description: "",
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
  html_template: "",
  design_brief: "",
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
  const [showMarkdownHelp, setShowMarkdownHelp] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [slugMessage, setSlugMessage] = useState("");
  const [slugSuggestion, setSlugSuggestion] = useState("");
  // Landing page step state
  const [promptCopied, setPromptCopied] = useState(false);
  const [htmlValidation, setHtmlValidation] = useState<{ ok: boolean; errors?: string[] } | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

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
      if (!form.html_template.trim()) {
        errs.html_template = "Paste your HTML template";
      } else {
        const check = validateHtmlTemplate(form.html_template);
        if (!check.ok) errs.html_template = check.errors.join("; ");
      }
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

  // ── Prompt builder ──────────────────────────────────────────────

  function generatePrompt(): string {
    const client = clients.find((c) => c.id === form.client_id);
    const brandColors: BrandColors | null = client?.brand_primary_color
      ? {
          primary: client.brand_primary_color,
          secondary: client.brand_secondary_color ?? "#f0f3f7",
          accent: client.brand_accent_color,
          text: client.brand_text_color ?? "#11123c",
        }
      : null;

    const logo = client?.branding_logo_url
      ? {
          url: client.branding_logo_url,
          background: client.logo_background ?? "light",
          position: client.logo_position ?? "top-left",
        }
      : null;

    return buildTemplatePrompt({
      name: form.role_title || "Campaign Landing Page",
      brief: form.design_brief || `A professional job application landing page for the ${form.role_title || "open"} role at ${client?.name || "the company"}.`,
      brandColors,
      logo,
    });
  }

  function copyPrompt() {
    const prompt = generatePrompt();
    navigator.clipboard?.writeText(prompt).then(() => {
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    });
  }

  // ── HTML validation on paste ────────────────────────────────────

  function handleHtmlChange(html: string) {
    updateForm({ html_template: html });
    if (html.trim()) {
      setHtmlValidation(validateHtmlTemplate(html));
    } else {
      setHtmlValidation(null);
    }
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
      role_description: form.role_description || null,
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
      html_template: form.html_template || null,
      design_brief: form.design_brief || null,
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
    <div className="mx-auto max-w-4xl">
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
                  ? "bg-accent text-white"
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

            <div>
              <label htmlFor="role_description" className={labelClass}>
                Role Description
              </label>
              <textarea
                id="role_description"
                value={form.role_description}
                onChange={(e) => updateForm({ role_description: e.target.value })}
                placeholder="Describe the role, team, and what makes it a great opportunity..."
                rows={5}
                className="w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
              />
              <button type="button" onClick={() => setShowMarkdownHelp(true)} className="mt-1 inline-flex items-center gap-1 text-[0.65rem] text-txt-muted hover:text-accent transition-colors cursor-pointer">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="8" cy="8" r="6.5" /><path d="M6.5 6.2a1.5 1.5 0 0 1 2.8.5c0 1-1.3 1.3-1.3 2.3" /><path d="M8 12v.01" /></svg>
                Supports markdown — formatting guide
              </button>
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
                    {q.options.map((opt, oIdx) => {
                      // Surface a counter once the user gets within
                      // 15 chars of the cap, so the limit isn't a
                      // silent hit at 80.
                      const showCounter =
                        opt.value.length >= GATING_OPTION_MAX_LENGTH - 15;
                      return (
                        <div key={oIdx} className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <input
                              value={opt.value}
                              onChange={(e) => updateOption(qIdx, oIdx, e.target.value)}
                              placeholder={`Option ${oIdx + 1}`}
                              maxLength={GATING_OPTION_MAX_LENGTH}
                              className={`${smallInputClass} ${showCounter ? "pr-14" : ""}`}
                            />
                            {showCounter && (
                              <span
                                className={`pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-[0.65rem] ${
                                  opt.value.length >= GATING_OPTION_MAX_LENGTH
                                    ? "text-red"
                                    : "text-txt-muted"
                                }`}
                              >
                                {opt.value.length}/{GATING_OPTION_MAX_LENGTH}
                              </span>
                            )}
                          </div>
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
                      );
                    })}
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

        {/* ── Step 3: Landing Page (AI prompt + HTML paste) ────── */}
        {step === 3 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-base font-semibold text-charcoal">Landing Page</h2>
              <p className="mt-1 text-xs text-txt-muted">
                Copy the AI prompt below into Claude or ChatGPT. It will generate a live preview as an artifact — tweak the design until you&apos;re happy, then paste the final HTML here.
              </p>
            </div>

            {/* Design brief */}
            <div>
              <label htmlFor="design_brief" className={labelClass}>Design Brief (optional)</label>
              <textarea
                id="design_brief"
                value={form.design_brief}
                onChange={(e) => updateForm({ design_brief: e.target.value })}
                placeholder="Describe any specific design preferences — layout style, tone, sections to include..."
                rows={3}
                className="w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
              />
            </div>

            {/* Copy prompt button */}
            <button
              type="button"
              onClick={copyPrompt}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-cream/40 px-4 text-[0.8rem] font-medium text-charcoal transition-colors hover:bg-cream hover:border-txt-muted cursor-pointer"
            >
              {promptCopied ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8.5L6.5 12L13 4" />
                  </svg>
                  Copied to clipboard
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3.5A1.5 1.5 0 014.5 2H11" />
                  </svg>
                  Copy AI Prompt to Clipboard
                </>
              )}
            </button>

            <div className="relative">
              <div className="absolute inset-x-0 top-0 h-px bg-border" />
              <p className="relative -top-2 mx-auto w-fit bg-surface px-3 text-[0.65rem] font-medium uppercase tracking-[0.15em] text-txt-muted">
                Then paste the generated HTML below
              </p>
            </div>

            {/* HTML paste area */}
            <div>
              <label htmlFor="html_template" className={labelClass}>
                HTML Template <span className="text-red">*</span>
              </label>
              <textarea
                id="html_template"
                value={form.html_template}
                onChange={(e) => handleHtmlChange(e.target.value)}
                placeholder="Paste the complete HTML page here..."
                rows={12}
                className={`w-full rounded-lg border bg-cream/40 px-3.5 py-2.5 font-mono text-xs text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none ${
                  errors.html_template ? "border-red" : htmlValidation?.ok ? "border-green" : "border-border"
                }`}
              />
              {errors.html_template && (
                <p className="mt-1 text-xs text-red">{errors.html_template}</p>
              )}
              {htmlValidation?.ok && (
                <p className="mt-1 flex items-center gap-1 text-xs text-green">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 6.5L5 9l4.5-6" />
                  </svg>
                  Valid HTML template ({form.html_template.length.toLocaleString()} characters)
                </p>
              )}
              {htmlValidation && !htmlValidation.ok && !errors.html_template && (
                <div className="mt-1 space-y-0.5">
                  {htmlValidation.errors?.map((err, i) => (
                    <p key={i} className="text-xs text-red">{err}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Live preview */}
            {htmlValidation?.ok && form.html_template.trim() && (
              <TemplatePreview
                html={form.html_template}
                form={form}
                clientName={clients.find((c) => c.id === form.client_id)?.name}
                previewDevice={previewDevice}
                setPreviewDevice={setPreviewDevice}
              />
            )}
          </div>
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
              {form.role_description && (
                <div className="mt-2 border-t border-border pt-2 text-sm">
                  <span className="text-txt-muted">Description:</span>{" "}
                  <span className="text-charcoal">{form.role_description.length} characters</span>
                </div>
              )}
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

            {/* Landing page summary */}
            <div className="rounded-lg border border-border p-4">
              <h3 className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">Landing Page</h3>
              {form.html_template ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm text-charcoal">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green">
                    <path d="M3 7.5L5.5 10l5.5-6" />
                  </svg>
                  HTML template pasted ({form.html_template.length.toLocaleString()} characters)
                </p>
              ) : (
                <p className="mt-1 text-sm text-red">No HTML template — go back to Step 4 to paste one</p>
              )}
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
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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

      {/* ── Markdown help dialog ──────────────────────────────── */}
      {showMarkdownHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm" onClick={() => setShowMarkdownHelp(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-charcoal">Markdown Formatting Guide</h3>
            <p className="mt-1 text-xs text-txt-muted">Use these patterns in the description field.</p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">
                  <th className="pb-2 pr-4">You type</th>
                  <th className="pb-2">Result</th>
                </tr>
              </thead>
              <tbody className="text-charcoal">
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary"># Heading</td>
                  <td className="py-2 font-semibold">Heading</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary">## Subheading</td>
                  <td className="py-2 font-semibold text-[0.85rem]">Subheading</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary">**bold text**</td>
                  <td className="py-2 font-bold">bold text</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary">*italic text*</td>
                  <td className="py-2 italic">italic text</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary">[link text](url)</td>
                  <td className="py-2 text-accent underline">link text</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary whitespace-pre">- item one{"\n"}- item two</td>
                  <td className="py-2">
                    <span className="mr-1.5">&#x2022;</span>item one<br />
                    <span className="mr-1.5">&#x2022;</span>item two
                  </td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary whitespace-pre">1. first{"\n"}2. second</td>
                  <td className="py-2">1. first<br />2. second</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-xs text-txt-secondary">&gt; quote text</td>
                  <td className="py-2 border-l-2 border-txt-muted pl-2 italic text-txt-secondary">quote text</td>
                </tr>
              </tbody>
            </table>
            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowMarkdownHelp(false)}
                className="inline-flex h-9 items-center rounded-lg bg-charcoal px-5 text-[0.8rem] font-medium text-white transition-colors hover:bg-charcoal-light cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
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
            "linear-gradient(45deg, #d1dce6 25%, transparent 25%), linear-gradient(-45deg, #d1dce6 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1dce6 75%), linear-gradient(-45deg, transparent 75%, #d1dce6 75%)",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
        }
      : { backgroundColor: logoBg === "light" ? "#ffffff" : "#11123c" };

  const promptSnippet = swatches
    .map((s) => `${s.label.toLowerCase()}: ${s.value}`)
    .join(", ");

  return (
    <div className="rounded-lg border border-border bg-cream/40 p-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.1em] text-txt-muted">
        {client.name} — Brand Kit
      </p>
      <p className="mt-1 text-xs text-txt-secondary">
        This campaign will inherit the client&apos;s branding. The AI prompt will include these colours automatically.
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

// ── Template Preview ────────────────────────────────────────────────

function TemplatePreview({
  html,
  form,
  clientName,
  previewDevice,
  setPreviewDevice,
}: {
  html: string;
  form: FormData;
  clientName: string | undefined;
  previewDevice: "desktop" | "mobile";
  setPreviewDevice: (d: "desktop" | "mobile") => void;
}) {
  const slotData: SlotData = {
    client: { name: clientName ?? "Company" },
    campaign: {
      role_title: form.role_title || "Sample Role Title",
      role_description: renderMarkdown(form.role_description),
      department: form.department || null,
      location: form.location || null,
      employment_type: form.employment_type || null,
      salary_range_min: form.salary_range_min ? parseInt(form.salary_range_min) : null,
      salary_range_max: form.salary_range_max ? parseInt(form.salary_range_max) : null,
    },
  };

  // Replace slots with current form data, then swap the form mount point
  // with a placeholder so the preview doesn't show an empty div.
  let processed = replaceSlots(html, slotData);
  processed = processed.replace(
    /<div\s+id\s*=\s*["']application-form["']\s*>\s*<\/div>/i,
    '<div style="padding:2rem;background:#f9f9f9;border:1px dashed #ccc;border-radius:0.75rem;text-align:center;color:#888;font-family:sans-serif"><p style="margin:0 0 0.5rem;font-size:0.9rem;font-weight:600">Application Form</p><p style="margin:0;font-size:0.78rem">Interactive form will appear here at runtime.</p></div>'
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className={labelClass}>Preview</label>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-cream/40 p-0.5">
          <button
            type="button"
            onClick={() => setPreviewDevice("desktop")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.65rem] font-medium transition-colors cursor-pointer ${
              previewDevice === "desktop"
                ? "bg-surface text-charcoal shadow-sm"
                : "text-txt-muted hover:text-txt-secondary"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1.5" y="2" width="13" height="9" rx="1.5" />
              <path d="M5.5 14h5M8 11v3" />
            </svg>
            Desktop
          </button>
          <button
            type="button"
            onClick={() => setPreviewDevice("mobile")}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[0.65rem] font-medium transition-colors cursor-pointer ${
              previewDevice === "mobile"
                ? "bg-surface text-charcoal shadow-sm"
                : "text-txt-muted hover:text-txt-secondary"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="1.5" width="8" height="13" rx="1.5" />
              <path d="M7 12.5h2" />
            </svg>
            Mobile
          </button>
        </div>
      </div>
      <div className="flex justify-center rounded-lg border border-border bg-cream/40 p-4">
        <iframe
          srcDoc={processed}
          sandbox="allow-same-origin"
          title="Template preview"
          className="rounded-lg border border-border bg-white"
          style={{
            width: previewDevice === "mobile" ? 375 : "100%",
            height: 600,
          }}
        />
      </div>
    </div>
  );
}
