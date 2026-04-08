"use client";

import { useRef, useState, useCallback } from "react";
import type { GatingQuestion } from "@/lib/gating";
import type { Tracker } from "@/lib/tracking";
import { ApplicationFormSuccess } from "./ApplicationFormSuccess";
import { ApplicationFormError } from "./ApplicationFormError";

// ── Types ────────────────────────────────────────────────────────────

export interface BrandColours {
  primary: string;
  secondary: string;
  accent: string | null;
  text: string;
}

export interface ApplicationFormCampaign {
  slug: string;
  role_title: string;
  gating_config: GatingQuestion[];
}

interface Props {
  clientSlug: string;
  campaign: ApplicationFormCampaign;
  brandColours: BrandColours;
  clientName?: string;
  tracker?: Tracker;
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_CV_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_CV_EXTENSIONS = [".pdf", ".doc", ".docx"];
const ACCEPTED_CV_MIMES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const POPIA_CONSENT_TEXT =
  "I consent to the processing of my personal information in accordance with the Protection of Personal Information Act (POPIA). I understand that my data will be used solely to assess my application for this role, stored securely, retained for up to 12 months, and that I have the right to access, correct, or request deletion of my information at any time.";

// ── Contrast helpers ─────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const v = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(v)) return null;
  const full = v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function buttonTextColour(bg: string): string {
  const rgb = hexToRgb(bg);
  if (!rgb) return "#ffffff";
  return relativeLuminance(rgb) > 0.55 ? "#11123c" : "#ffffff";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Form state types ─────────────────────────────────────────────────

interface FormFields {
  name: string;
  email: string;
  phone: string;
  popia_consent: boolean;
  answers: Record<string, string>;
}

type SubmissionResult =
  | { kind: "success"; message: string }
  | { kind: "failure"; message: string; retryable: boolean };

// ── Component ────────────────────────────────────────────────────────

export function ApplicationForm({ clientSlug, campaign, brandColours, clientName, tracker }: Props) {
  const { gating_config: gatingConfig, slug: campaignSlug } = campaign;
  const [fields, setFields] = useState<FormFields>({
    name: "",
    email: "",
    phone: "",
    popia_consent: false,
    answers: {},
  });
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Tracking ──────────────────────────────────────────────────────
  const formStartedRef = useRef(false);
  const formSubmittedRef = useRef(false);
  const abandonFiredRef = useRef(false);
  const fieldsCompletedRef = useRef<Set<string>>(new Set());
  const lastCompletedFieldRef = useRef<string | null>(null);

  /** Record that a field received meaningful input (value changed). */
  const trackFieldCompleted = useCallback(
    (field: string) => {
      if (!tracker) return;
      if (!formStartedRef.current) {
        formStartedRef.current = true;
        tracker.track("form_start");
      }
      fieldsCompletedRef.current.add(field);
      lastCompletedFieldRef.current = field;
      tracker.track("field_interact", { field });
    },
    [tracker],
  );

  // Fire form_abandon once on visibility change (only if user actually engaged)
  const abandonRef = useRef<(() => void) | null>(null);
  abandonRef.current = () => {
    if (
      formStartedRef.current &&
      !formSubmittedRef.current &&
      !abandonFiredRef.current &&
      fieldsCompletedRef.current.size > 0 &&
      tracker
    ) {
      abandonFiredRef.current = true;
      tracker.track("form_abandon", {
        last_field: lastCompletedFieldRef.current,
        fields_completed: Array.from(fieldsCompletedRef.current),
      });
      tracker.flush();
    }
  };
  // Register once
  const registeredRef = useRef(false);
  if (!registeredRef.current && typeof document !== "undefined") {
    registeredRef.current = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") abandonRef.current?.();
    });
  }

  const primaryColour = brandColours.primary || "#11123c";
  const primaryButtonText = buttonTextColour(primaryColour);
  const accentColour = brandColours.accent || primaryColour;
  const textColour = brandColours.text || "#11123c";

  const setField = <K extends keyof FormFields>(key: K, value: FormFields[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as string]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    }
  };

  const setAnswer = (questionId: string, value: string) => {
    setFields((prev) => ({ ...prev, answers: { ...prev.answers, [questionId]: value } }));
    const errKey = `answer_${questionId}`;
    if (fieldErrors[errKey]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[errKey];
        return next;
      });
    }
  };

  // ── CV file handling ──────────────────────────────────────────────

  const validateCvFile = (file: File): string | null => {
    if (file.size > MAX_CV_SIZE_BYTES) {
      return `File is ${formatBytes(file.size)}. Maximum size is 10MB.`;
    }
    const ext = file.name.lastIndexOf(".") >= 0 ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    if (!ACCEPTED_CV_EXTENSIONS.includes(ext) && !ACCEPTED_CV_MIMES.includes(file.type)) {
      return "Please upload a PDF, DOC, or DOCX file.";
    }
    return null;
  };

  const handleFileSelected = (file: File | null) => {
    if (!file) {
      setCvFile(null);
      setCvError(null);
      return;
    }
    const err = validateCvFile(file);
    if (err) {
      setCvError(err);
      setCvFile(null);
      return;
    }
    setCvError(null);
    setCvFile(file);
    trackFieldCompleted("cv");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelected(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
  };

  const removeCv = () => {
    setCvFile(null);
    setCvError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ── Validation ────────────────────────────────────────────────────

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!fields.name.trim()) errs.name = "Please enter your full name.";
    if (!fields.email.trim()) errs.email = "Please enter your email address.";
    else if (!EMAIL_RE.test(fields.email.trim())) errs.email = "Please enter a valid email address.";

    for (const question of gatingConfig) {
      const answer = fields.answers[question.id];
      if (!answer || !answer.trim()) {
        errs[`answer_${question.id}`] = "Please answer this question.";
      }
    }

    if (!cvFile) errs.cv = "Please upload your CV.";
    if (cvError) errs.cv = cvError;

    if (!fields.popia_consent) errs.popia_consent = "Please confirm your POPIA consent to continue.";

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Submit ────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) {
      // focus first invalid
      const firstErr = document.querySelector<HTMLElement>("[data-field-error='true']");
      firstErr?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("name", fields.name.trim());
      formData.append("email", fields.email.trim());
      if (fields.phone.trim()) formData.append("phone", fields.phone.trim());
      formData.append("whatsapp_opt_in", "false");
      formData.append("popia_consent", "true");
      formData.append("answers", JSON.stringify(fields.answers));
      if (cvFile) formData.append("cv", cvFile);

      const res = await fetch(`/api/apply/${clientSlug}/${campaignSlug}`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        formSubmittedRef.current = true;
        tracker?.track("form_submit");
        tracker?.flush();
        if (data.chat_token) {
          try { localStorage.setItem(`ts_chat_${clientSlug}_${campaignSlug}`, data.chat_token); } catch {}
        }
        setResult({ kind: "success", message: data.message || "Thank you for applying." });
        return;
      }

      // Error paths
      if (res.status === 409) {
        setResult({
          kind: "failure",
          message: data.error || "It looks like you've already applied for this position. If you need to update your application, please contact us directly.",
          retryable: false,
        });
        return;
      }
      if (res.status === 404) {
        setResult({
          kind: "failure",
          message: "This position is no longer accepting applications.",
          retryable: false,
        });
        return;
      }
      if (res.status === 400) {
        // field-level if possible
        const msg = data.error || "Please check your details and try again.";
        const lower = msg.toLowerCase();
        if (lower.includes("name")) setFieldErrors((p) => ({ ...p, name: msg }));
        else if (lower.includes("email")) setFieldErrors((p) => ({ ...p, email: msg }));
        else if (lower.includes("popia")) setFieldErrors((p) => ({ ...p, popia_consent: msg }));
        else if (lower.includes("cv")) setFieldErrors((p) => ({ ...p, cv: msg }));
        else setResult({ kind: "failure", message: msg, retryable: true });
        return;
      }
      setResult({
        kind: "failure",
        message: data.error || "Something went wrong. Please try again in a moment.",
        retryable: true,
      });
    } catch {
      setResult({
        kind: "failure",
        message: "We couldn't reach the server. Please check your connection and try again.",
        retryable: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Result states ─────────────────────────────────────────────────

  if (result?.kind === "success") {
    return (
      <ApplicationFormSuccess
        message={result.message}
        brandColours={brandColours}
        clientName={clientName}
      />
    );
  }

  if (result?.kind === "failure" && !result.retryable) {
    return (
      <ApplicationFormError
        message={result.message}
        brandColours={brandColours}
        retryable={false}
      />
    );
  }

  // ── Shared input styles (inline, brand-adaptable) ────────────────

  const fieldBorder = "rgba(17, 18, 60, 0.15)";
  const fieldBorderFocus = primaryColour;
  const errorRed = "#c02616";

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.875rem",
    fontWeight: 600,
    letterSpacing: "0.01em",
    color: "rgba(17, 18, 60, 0.72)",
    marginBottom: "0.5rem",
    fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
  };

  const inputBaseStyle: React.CSSProperties = {
    width: "100%",
    height: "2.75rem",
    padding: "0 0.875rem",
    fontSize: "0.95rem",
    color: textColour,
    backgroundColor: "#ffffff",
    border: `1px solid ${fieldBorder}`,
    borderRadius: "0.5rem",
    outline: "none",
    fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
  };

  const selectStyle: React.CSSProperties = {
    ...inputBaseStyle,
    appearance: "none",
    backgroundImage:
      'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\' fill=\'none\' stroke=\'%23666\' stroke-width=\'1.5\' stroke-linecap=\'round\'%3E%3Cpath d=\'M3 4.5L6 7.5L9 4.5\'/%3E%3C/svg%3E")',
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 0.875rem center",
    paddingRight: "2.5rem",
    cursor: "pointer",
  };

  const inputErrorStyle = (hasError: boolean): React.CSSProperties =>
    hasError ? { borderColor: errorRed } : {};

  // ── Render ────────────────────────────────────────────────────────

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      style={{
        fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
        color: textColour,
      }}
      aria-labelledby="application-form-title"
    >
      <h2
        id="application-form-title"
        style={{
          fontFamily: "var(--font-fraunces), Georgia, serif",
          fontSize: "1.5rem",
          fontWeight: 500,
          color: primaryColour,
          marginBottom: "0.375rem",
          letterSpacing: "-0.01em",
        }}
      >
        Apply for this role
      </h2>
      <p
        style={{
          fontSize: "0.9rem",
          color: "rgba(17, 18, 60, 0.62)",
          marginBottom: "1.75rem",
          lineHeight: 1.55,
        }}
      >
        Fill in the fields below to submit your application. All fields marked with an asterisk are required.
      </p>

      {result?.kind === "failure" && result.retryable && (
        <div
          role="alert"
          style={{
            marginBottom: "1.25rem",
            padding: "0.875rem 1rem",
            borderRadius: "0.5rem",
            backgroundColor: "#ffe0da",
            border: "1px solid #c02616",
            color: "#8a1d10",
            fontSize: "0.875rem",
            lineHeight: 1.5,
          }}
        >
          {result.message}
        </div>
      )}

      {/* Name */}
      <div style={{ marginBottom: "1.125rem" }} data-field-error={!!fieldErrors.name}>
        <label htmlFor="ts-name" style={labelStyle}>
          Full Name <span style={{ color: errorRed }} aria-hidden>*</span>
        </label>
        <input
          id="ts-name"
          type="text"
          required
          autoComplete="name"
          value={fields.name}
          onChange={(e) => { setField("name", e.target.value); trackFieldCompleted("name"); }}
          aria-invalid={!!fieldErrors.name}
          aria-describedby={fieldErrors.name ? "ts-name-error" : undefined}
          style={{ ...inputBaseStyle, ...inputErrorStyle(!!fieldErrors.name) }}
          onFocus={(e) => (e.currentTarget.style.borderColor = fieldBorderFocus)}
          onBlur={(e) => {
            if (!fieldErrors.name) e.currentTarget.style.borderColor = fieldBorder;
          }}
        />
        {fieldErrors.name && (
          <p id="ts-name-error" style={{ marginTop: "0.375rem", fontSize: "0.78rem", color: errorRed }}>
            {fieldErrors.name}
          </p>
        )}
      </div>

      {/* Email */}
      <div style={{ marginBottom: "1.125rem" }} data-field-error={!!fieldErrors.email}>
        <label htmlFor="ts-email" style={labelStyle}>
          Email <span style={{ color: errorRed }} aria-hidden>*</span>
        </label>
        <input
          id="ts-email"
          type="email"
          required
          autoComplete="email"
          value={fields.email}
          onChange={(e) => { setField("email", e.target.value); trackFieldCompleted("email"); }}
          aria-invalid={!!fieldErrors.email}
          aria-describedby={fieldErrors.email ? "ts-email-error" : undefined}
          style={{ ...inputBaseStyle, ...inputErrorStyle(!!fieldErrors.email) }}
          onFocus={(e) => (e.currentTarget.style.borderColor = fieldBorderFocus)}
          onBlur={(e) => {
            if (!fieldErrors.email) e.currentTarget.style.borderColor = fieldBorder;
          }}
        />
        {fieldErrors.email && (
          <p id="ts-email-error" style={{ marginTop: "0.375rem", fontSize: "0.78rem", color: errorRed }}>
            {fieldErrors.email}
          </p>
        )}
      </div>

      {/* Phone */}
      <div style={{ marginBottom: "1.125rem" }}>
        <label htmlFor="ts-phone" style={labelStyle}>
          Phone
        </label>
        <input
          id="ts-phone"
          type="tel"
          autoComplete="tel"
          value={fields.phone}
          onChange={(e) => { setField("phone", e.target.value); trackFieldCompleted("phone"); }}
          style={inputBaseStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = fieldBorderFocus)}
          onBlur={(e) => (e.currentTarget.style.borderColor = fieldBorder)}
        />
      </div>

      {/* Gating questions */}
      {gatingConfig.length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          {gatingConfig.map((q) => {
            const errKey = `answer_${q.id}`;
            const hasErr = !!fieldErrors[errKey];
            const inputType = (q.type ?? "select").toLowerCase();
            const useRadio = inputType === "radio";
            return (
              <div key={q.id} style={{ marginBottom: "1.125rem" }} data-field-error={hasErr}>
                <label htmlFor={`ts-q-${q.id}`} style={labelStyle}>
                  {q.label} <span style={{ color: errorRed }} aria-hidden>*</span>
                </label>
                {useRadio ? (
                  <div role="radiogroup" aria-labelledby={`ts-q-${q.id}`} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {q.options.map((opt, i) => (
                      <label
                        key={`${q.id}-${i}`}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.625rem",
                          padding: "0.625rem 0.875rem",
                          borderRadius: "0.5rem",
                          border: `1px solid ${fields.answers[q.id] === opt.value ? primaryColour : fieldBorder}`,
                          backgroundColor: fields.answers[q.id] === opt.value ? `${primaryColour}0d` : "#ffffff",
                          cursor: "pointer",
                          fontSize: "0.9rem",
                          transition: "border-color 150ms ease, background-color 150ms ease",
                        }}
                      >
                        <input
                          type="radio"
                          name={`answer_${q.id}`}
                          value={opt.value}
                          checked={fields.answers[q.id] === opt.value}
                          onChange={() => { setAnswer(q.id, opt.value); trackFieldCompleted(`question_${q.id}`); }}
                          style={{ accentColor: primaryColour, cursor: "pointer" }}
                        />
                        <span>{opt.value}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <select
                    id={`ts-q-${q.id}`}
                    required
                    value={fields.answers[q.id] ?? ""}
                    onChange={(e) => { setAnswer(q.id, e.target.value); trackFieldCompleted(`question_${q.id}`); }}
                    aria-invalid={hasErr}
                    style={{ ...selectStyle, ...inputErrorStyle(hasErr) }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = fieldBorderFocus)}
                    onBlur={(e) => {
                      if (!hasErr) e.currentTarget.style.borderColor = fieldBorder;
                    }}
                  >
                    <option value="" disabled>
                      Select an answer…
                    </option>
                    {q.options.map((opt, i) => (
                      <option key={`${q.id}-${i}`} value={opt.value}>
                        {opt.value}
                      </option>
                    ))}
                  </select>
                )}
                {hasErr && (
                  <p style={{ marginTop: "0.375rem", fontSize: "0.78rem", color: errorRed }}>
                    {fieldErrors[errKey]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CV upload */}
      <div style={{ marginBottom: "1.5rem" }} data-field-error={!!fieldErrors.cv}>
        <label style={labelStyle}>
          CV Upload <span style={{ color: errorRed }} aria-hidden>*</span>
        </label>
        {!cvFile ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Upload CV"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.625rem",
              padding: "1.75rem 1rem",
              border: `1.5px dashed ${dragActive ? primaryColour : fieldErrors.cv ? errorRed : fieldBorder}`,
              borderRadius: "0.625rem",
              backgroundColor: dragActive ? `${primaryColour}08` : "rgba(17, 18, 60, 0.02)",
              cursor: "pointer",
              textAlign: "center",
              transition: "border-color 150ms ease, background-color 150ms ease",
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 28 28"
              fill="none"
              stroke={dragActive ? primaryColour : "rgba(17, 18, 60, 0.45)"}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14 19V8" />
              <path d="M9 13l5-5 5 5" />
              <path d="M5 22h18" />
            </svg>
            <div>
              <span style={{ fontSize: "0.9rem", fontWeight: 500, color: textColour }}>
                {dragActive ? "Drop your CV here" : "Click or drag your CV here"}
              </span>
              <p style={{ marginTop: "0.25rem", fontSize: "0.75rem", color: "rgba(17, 18, 60, 0.55)" }}>
                PDF, DOC, or DOCX · Maximum 10MB
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
              aria-hidden="true"
            />
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.875rem 1rem",
              border: `1px solid ${fieldBorder}`,
              borderRadius: "0.625rem",
              backgroundColor: "#ffffff",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2.25rem",
                height: "2.75rem",
                flexShrink: 0,
                borderRadius: "0.3rem",
                backgroundColor: `${primaryColour}14`,
                color: primaryColour,
                fontSize: "0.65rem",
                fontWeight: 700,
                letterSpacing: "0.04em",
                fontFamily: "var(--font-jetbrains-mono), monospace",
              }}
            >
              {cvFile.name.split(".").pop()?.toUpperCase() ?? "FILE"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "0.88rem",
                  fontWeight: 500,
                  color: textColour,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={cvFile.name}
              >
                {cvFile.name}
              </div>
              <div style={{ fontSize: "0.75rem", color: "rgba(17, 18, 60, 0.55)" }}>
                {formatBytes(cvFile.size)}
              </div>
            </div>
            <button
              type="button"
              onClick={removeCv}
              aria-label="Remove CV"
              style={{
                padding: "0.5rem",
                border: "none",
                background: "transparent",
                color: "rgba(17, 18, 60, 0.55)",
                cursor: "pointer",
                borderRadius: "0.375rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = errorRed)}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(17, 18, 60, 0.55)")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}
        {fieldErrors.cv && (
          <p style={{ marginTop: "0.375rem", fontSize: "0.78rem", color: errorRed }}>
            {fieldErrors.cv}
          </p>
        )}
      </div>

      {/* POPIA consent */}
      <div style={{ marginBottom: "1.5rem" }} data-field-error={!!fieldErrors.popia_consent}>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            padding: "0.875rem 1rem",
            border: `1px solid ${fieldErrors.popia_consent ? errorRed : fieldBorder}`,
            borderRadius: "0.625rem",
            backgroundColor: "rgba(17, 18, 60, 0.02)",
            cursor: "pointer",
          }}
        >
          <span
            role="checkbox"
            aria-checked={fields.popia_consent}
            aria-invalid={!!fieldErrors.popia_consent}
            aria-describedby="ts-popia-text"
            tabIndex={0}
            onClick={() => { setField("popia_consent", !fields.popia_consent); trackFieldCompleted("popia_consent"); }}
            onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); setField("popia_consent", !fields.popia_consent); trackFieldCompleted("popia_consent"); } }}
            style={{
              marginTop: "0.2rem",
              width: "1.125rem",
              height: "1.125rem",
              borderRadius: "0.3rem",
              border: `1.5px solid ${fields.popia_consent ? primaryColour : fieldErrors.popia_consent ? errorRed : fieldBorder}`,
              backgroundColor: fields.popia_consent ? primaryColour : "#ffffff",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
              transition: "all 0.15s ease",
            }}
          >
            {fields.popia_consent && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2.5 6.5L5 9l4.5-6" />
              </svg>
            )}
          </span>
          <div>
            <div
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: textColour,
                marginBottom: "0.25rem",
              }}
            >
              POPIA Consent <span style={{ color: errorRed }} aria-hidden>*</span>
            </div>
            <div
              id="ts-popia-text"
              style={{
                fontSize: "0.78rem",
                color: "rgba(17, 18, 60, 0.68)",
                lineHeight: 1.5,
              }}
            >
              {POPIA_CONSENT_TEXT}
            </div>
          </div>
        </label>
        {fieldErrors.popia_consent && (
          <p style={{ marginTop: "0.375rem", fontSize: "0.78rem", color: errorRed }}>
            {fieldErrors.popia_consent}
          </p>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        style={{
          width: "100%",
          height: "3rem",
          padding: "0 1.5rem",
          border: "none",
          borderRadius: "0.5rem",
          backgroundColor: submitting ? `${primaryColour}b3` : primaryColour,
          color: primaryButtonText,
          fontSize: "0.95rem",
          fontWeight: 600,
          letterSpacing: "0.01em",
          cursor: submitting ? "wait" : "pointer",
          transition: "background-color 150ms ease, transform 100ms ease",
          fontFamily: "var(--font-instrument-sans), system-ui, sans-serif",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.625rem",
        }}
        onMouseEnter={(e) => {
          if (!submitting) e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        {submitting ? (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              style={{ animation: "ts-spin 0.8s linear infinite" }}
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Submitting…
          </>
        ) : (
          <>
            Submit Application
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </>
        )}
      </button>

      <style>{`
        @keyframes ts-spin { to { transform: rotate(360deg); } }
      `}</style>
    </form>
  );
}

export default ApplicationForm;
