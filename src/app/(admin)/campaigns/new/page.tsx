"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
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

interface FormData {
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
  html_template: string;
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
  html_template: "",
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

export default function NewCampaignPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [clients, setClients] = useState<Client[]>([]);
  const [slugManual, setSlugManual] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((res) => setClients(res.data ?? []));
  }, []);

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

  // ── AI Prompt builder ─────────────────────────────────────────────

  function buildLandingPagePrompt(): string {
    const slug = form.slug || "{slug}";
    const clientName = clients.find((c) => c.id === form.client_id)?.name ?? "{Client Name}";
    const questionsBlock = form.gating_config
      .map((q, i) => {
        const optionsList = q.options
          .filter((o) => o.value)
          .map((o) => `  - "${o.value}"`)
          .join("\n");
        return `Question ${i + 1}: "${q.label}"\nType: select (dropdown)\nOptions:\n${optionsList}\nField name: answer_${q.id}`;
      })
      .join("\n\n");

    return `Create a complete, self-contained HTML landing page for a job application campaign.

## Role Details
- **Role Title:** ${form.role_title || "{Role Title}"}
- **Company:** ${clientName}
- **Department:** ${form.department || "Not specified"}
- **Location:** ${form.location || "Not specified"}
- **Employment Type:** ${form.employment_type || "Not specified"}
${form.salary_range_min || form.salary_range_max ? `- **Salary Range:** R${form.salary_range_min || "?"} – R${form.salary_range_max || "?"}` : ""}

## Form Requirements
The page must contain an application form that POSTs to:
\`/api/apply/${slug}\`

The form must use \`Content-Type: application/json\` and submit via JavaScript fetch (not a traditional form submit). On success, show a thank-you message inline. On error, show the error message from the response.

### Required Form Fields
1. **name** (text input, required) — Candidate's full name
2. **email** (email input, required) — Candidate's email address
3. **phone** (tel input, optional) — Phone number
4. **whatsapp_opt_in** (checkbox) — "I consent to receive WhatsApp messages about my application"
5. **popia_consent** (checkbox, required) — "I consent to the processing of my personal information in accordance with POPIA"

### Gating Questions (Screening)
These must be dropdown/select fields. Include them in the form submission as an \`answers\` object where keys are the question IDs.

${questionsBlock || "No gating questions configured yet."}

### Form Submission Format
The form should submit JSON in this format:
\`\`\`json
{
  "name": "string",
  "email": "string",
  "phone": "string or null",
  "whatsapp_opt_in": true/false,
  "popia_consent": true/false,
  "answers": {
${form.gating_config.map((q) => `    "${q.id}": "selected option value"`).join(",\n") || '    "question_id": "answer"'}
  }
}
\`\`\`

## Design Requirements
- Professional, modern, clean design
- Mobile-responsive
- Use inline CSS only (no external stylesheets) — the entire page must be a single HTML file
- Use a warm, professional colour scheme appropriate for a recruitment page
- Include the company name "${clientName}" prominently
- Include a compelling headline and brief role description section
- The form should be clearly visible and easy to complete
- Add a POPIA compliance notice at the bottom
- Include a "Powered by TalentStream" footer in small muted text
- After successful submission, replace the form with a thank-you message
- Show validation errors inline next to the relevant fields
- Disable the submit button while the request is in flight

## Important
- The HTML must be completely self-contained — inline CSS, no external dependencies
- Use vanilla JavaScript for form handling (no frameworks)
- The page should work in all modern browsers`;
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(buildLandingPagePrompt());
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
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
      html_template: form.html_template || null,
      status,
    };

    try {
      const res = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setSubmitError(data.error || "Failed to create campaign");
        return;
      }

      router.push("/campaigns");
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
        <span className="text-txt-secondary">New Campaign</span>
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
                className={`${inputClass} ${errors.client_id ? "border-red" : ""}`}
              >
                <option value="">Select a client...</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.client_id && <p className="mt-1 text-xs text-red">{errors.client_id}</p>}
            </div>

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
                Subdomain Slug <span className="text-red">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => {
                    setSlugManual(true);
                    updateForm({ slug: e.target.value });
                  }}
                  placeholder="senior-software-engineer"
                  className={`${inputClass} ${errors.slug ? "border-red" : ""}`}
                />
              </div>
              <p className="mt-1.5 font-mono text-[0.7rem] text-txt-muted">
                {form.slug || "slug"}.talentstream.co.za
              </p>
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
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-charcoal">Gating Questions</h2>
              <button
                onClick={addQuestion}
                disabled={form.gating_config.length >= 5}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-cream px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-border cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 2v8M2 6h8" /></svg>
                Add Question
              </button>
            </div>
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

        {/* ── Step 3: Landing Page Template ────────────────────── */}
        {step === 3 && (
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-charcoal">Landing Page Template</h2>

            {/* Prompt generator */}
            <div className="rounded-lg border border-accent/20 bg-accent/[0.03] p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-[0.78rem] font-semibold text-charcoal">
                    Generate with AI
                  </h3>
                  <p className="mt-0.5 text-[0.7rem] leading-relaxed text-txt-secondary">
                    Copy this prompt and paste it into Claude or ChatGPT. It includes your role details,
                    gating questions, and the correct API endpoint. Paste the generated HTML below.
                  </p>
                </div>
                <button
                  onClick={copyPrompt}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-[0.75rem] font-medium text-white transition-colors hover:bg-accent-light cursor-pointer"
                >
                  {promptCopied ? (
                    <>
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5L6 10l5-6" /></svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="5" width="7" height="7" rx="1" />
                        <path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" />
                      </svg>
                      Copy Prompt
                    </>
                  )}
                </button>
              </div>

              {/* Prompt preview */}
              <details className="group">
                <summary className="text-[0.68rem] font-medium text-accent cursor-pointer hover:underline">
                  Preview prompt
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-cream p-3 font-mono text-[0.65rem] leading-relaxed text-charcoal whitespace-pre-wrap">
                  {buildLandingPagePrompt()}
                </pre>
              </details>
            </div>

            {/* API endpoint reference */}
            <div className="flex items-center gap-2 rounded-lg bg-cream px-4 py-2.5">
              <span className="text-[0.7rem] text-txt-muted">Form endpoint:</span>
              <code className="font-mono text-[0.72rem] font-medium text-accent">
                /api/apply/{form.slug || "{slug}"}
              </code>
            </div>

            {/* HTML textarea */}
            <textarea
              value={form.html_template}
              onChange={(e) => updateForm({ html_template: e.target.value })}
              placeholder="Paste the generated HTML here..."
              rows={16}
              className="w-full rounded-lg border border-border bg-cream/40 px-4 py-3 font-mono text-xs text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none"
            />

            {form.html_template && (
              <button
                onClick={() => setPreviewOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.75rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="7" cy="7" r="3" />
                  <path d="M1 7s2.5-4.5 6-4.5S13 7 13 7s-2.5 4.5-6 4.5S1 7 1 7z" />
                </svg>
                Preview
              </button>
            )}

            {/* Preview modal */}
            {previewOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/30 backdrop-blur-sm p-8">
                <div className="relative w-full max-w-4xl max-h-[80vh] rounded-xl border border-border bg-surface shadow-xl overflow-hidden flex flex-col">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <span className="text-sm font-medium text-charcoal">Template Preview</span>
                    <button onClick={() => setPreviewOpen(false)} className="p-1 text-txt-muted hover:text-charcoal cursor-pointer">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                    </button>
                  </div>
                  <iframe
                    srcDoc={form.html_template}
                    className="flex-1 w-full bg-white"
                    sandbox="allow-scripts"
                    title="Template preview"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Review ───────────────────────────────────── */}
        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-base font-semibold text-charcoal">Review & Publish</h2>

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
              <p className="mt-1 text-sm text-charcoal">
                {form.html_template ? `${form.html_template.length.toLocaleString()} characters` : "No template provided"}
              </p>
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
            <Link href="/campaigns" className="inline-flex h-9 items-center rounded-lg px-4 text-[0.8rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal">
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
                Save as Draft
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
                Publish Campaign
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
