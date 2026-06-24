"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTenant } from "@/components/admin/tenant-provider";
import { BrandPicker } from "@/components/admin/brand-picker";

// ── Types ───────────────────────────────────────────────────────────

type Phase = "upload" | "processing" | "error";

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const STATUS_MESSAGES = [
  "Extracting text from document...",
  "Analysing role requirements...",
  "Building screening questions...",
  "Generating scoring rubric...",
  "Crafting design brief...",
  "Almost done...",
];

const ERROR_MESSAGES: Record<string, string> = {
  extraction_failed:
    "We couldn't read the text from your document. This can happen with password-protected files or unusual formatting.",
  extraction_empty:
    "The document appears to be empty or contains only images. Scanned PDFs won't work \u2014 try a text-based PDF, DOC, or DOCX.",
  ai_providers_failed:
    "Our AI service is temporarily unavailable. Please try again in a moment.",
  ai_schema_invalid:
    "The AI couldn't produce a valid campaign structure from this document. This can happen with very short or unusual job specs. Try again or create the campaign manually.",
  ai_quality_invalid:
    "The AI struggled to extract consistent screening criteria from this document. Try again or create the campaign manually.",
};

// ── Processing animation ────────────────────────────────────────────

function MorphingDocumentAnimation() {
  const [messageIdx, setMessageIdx] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIdx((i) => (i + 1) % STATUS_MESSAGES.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const lines = [0, 1, 2, 3, 4, 5, 6];
  const fields = [0, 1, 2];

  return (
    <div className="flex flex-col items-center gap-8 py-12">
      {/* Document + scan + float */}
      <div className="relative">
        {/* Document frame */}
        <div className="relative w-56 overflow-hidden rounded-xl border border-border bg-white p-6 shadow-lg">
          {/* Scanning line */}
          <div
            className="pointer-events-none absolute left-0 h-0.5 w-full bg-accent/40"
            style={{
              animation: "scanLine 2.5s ease-in-out infinite",
            }}
          />

          {/* Text lines */}
          <div className="flex flex-col gap-2.5">
            {lines.map((i) => (
              <div
                key={i}
                className="h-2 rounded-full"
                style={{
                  width: `${60 + ((i * 17) % 40)}%`,
                  backgroundColor: "var(--color-border)",
                  animation: `shimmer 2s ease-in-out infinite, floatUp 1s ease-in ${3 + i * 0.15}s forwards`,
                  animationFillMode: "forwards",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Form field outlines (settle phase) */}
      <div className="flex gap-4" style={{ animation: "fadeIn 0.6s ease-out 4.2s both" }}>
        {fields.map((i) => (
          <div
            key={i}
            className="h-9 w-28 rounded-lg border-2 border-dashed border-accent/30"
            style={{ animation: `fadeIn 0.4s ease-out ${4.4 + i * 0.2}s both` }}
          >
            <div
              className="mx-auto mt-2.5 h-2 w-12 rounded-full bg-accent/20"
              style={{ animation: `float 2s ease-in-out ${i * 0.3}s infinite` }}
            />
          </div>
        ))}
      </div>

      {/* Status message */}
      <p
        className="text-sm text-txt-muted animate-[pulse-subtle_1.5s_ease-in-out_infinite]"
        key={messageIdx}
        style={{ animation: "fadeIn 0.3s ease-out" }}
      >
        {STATUS_MESSAGES[messageIdx]}
      </p>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────

export default function FromJobSpecPage() {
  const router = useRouter();
  const tenant = useTenant();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // S8: the campaign's brand is the active-brand context. BrandPicker sets it
  // (defaulting to the only brand); submission stays gated on it below.
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("upload");
  const [errorMessage, setErrorMessage] = useState("");
  const [fileError, setFileError] = useState("");

  const validateFile = useCallback((f: File): boolean => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      setFileError("Please upload a PDF, DOC, or DOCX file.");
      return false;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFileError("File is too large. Maximum size is 10MB.");
      return false;
    }
    setFileError("");
    return true;
  }, []);

  function handleFileSelect(f: File) {
    if (validateFile(f)) {
      setFile(f);
    } else {
      setFile(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }

  async function handleSubmit() {
    if (!tenant.activeBrandId || !file) return;
    setPhase("processing");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/campaigns/from-job-spec", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        const errorCode = data.error_code as string | undefined;
        const message =
          (errorCode && ERROR_MESSAGES[errorCode]) ||
          data.error ||
          "Something went wrong. Please try again.";
        setErrorMessage(message);
        setPhase("error");
        return;
      }

      const { data } = await res.json();
      router.push(`/campaigns/${data.id}/edit?from=job-spec`);
    } catch {
      setErrorMessage("Something went wrong. Please try again.");
      setPhase("error");
    }
  }

  function handleRetry() {
    setFile(null);
    setFileError("");
    setErrorMessage("");
    setPhase("upload");
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-txt-muted">
        <Link href="/campaigns" className="hover:text-charcoal transition-colors">
          Campaigns
        </Link>
        <span>/</span>
        <Link href="/campaigns/new" className="hover:text-charcoal transition-colors">
          New Campaign
        </Link>
        <span>/</span>
        <span className="text-txt-secondary">From Job Spec</span>
      </div>

      {/* ── Upload phase ──────────────────────────────────────────── */}
      {phase === "upload" && (
        <div className="animate-[fadeIn_0.3s_ease-out]">
          <h1 className="mb-1 text-lg font-semibold text-charcoal">
            Create Campaign from Job Spec
          </h1>
          <p className="mb-8 text-sm text-txt-muted">
            Upload a job specification and our AI will extract the campaign
            details, screening questions, and scoring rubric for you.
          </p>

          <div className="space-y-6">
            {/* Brand the campaign is created in. Defaults to the only brand
                when there's one; a picker when there are several (S8: choosing
                sets the active brand the API reads). */}
            <BrandPicker />

            {/* File drop zone */}
            <div>
              <label className="mb-1.5 block text-[0.7rem] font-medium uppercase tracking-[0.12em] text-txt-muted">
                Job Specification
              </label>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${
                  dragOver
                    ? "border-accent bg-accent/5"
                    : file
                      ? "border-accent/40 bg-accent/5"
                      : "border-border bg-cream/30 hover:border-accent/30 hover:bg-cream/50"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                />

                {file ? (
                  <>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 3H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10l-7-7z" />
                      <path d="M16 3v7h7" />
                      <path d="M10 16l2.5 3L17 13" />
                    </svg>
                    <div className="text-center">
                      <p className="text-sm font-medium text-charcoal">{file.name}</p>
                      <p className="mt-0.5 text-xs text-txt-muted">
                        {(file.size / 1024).toFixed(0)} KB &middot; Click or drop to replace
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-txt-muted">
                      <path d="M16 3H7a2 2 0 0 0-2 2v18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V10l-7-7z" />
                      <path d="M16 3v7h7" />
                      <path d="M14 14v6M11 17h6" />
                    </svg>
                    <div className="text-center">
                      <p className="text-sm text-txt-secondary">
                        Drop your job spec here, or{" "}
                        <span className="font-medium text-accent">browse</span>
                      </p>
                      <p className="mt-0.5 text-xs text-txt-muted">
                        PDF, DOC, or DOCX up to 10MB
                      </p>
                    </div>
                  </>
                )}
              </div>
              {fileError && (
                <p className="mt-1.5 text-xs text-red">{fileError}</p>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!tenant.activeBrandId || !file}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-light disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3" />
                <path d="M4.5 5.5L8 2l3.5 3.5" />
                <path d="M8 2v9" />
              </svg>
              Process Job Spec
            </button>

            <p className="text-center text-xs text-txt-muted">
              Or{" "}
              <Link href="/campaigns/new" className="text-accent hover:underline">
                create with the Campaign Wizard
              </Link>{" "}
              instead
            </p>
          </div>
        </div>
      )}

      {/* ── Processing phase ──────────────────────────────────────── */}
      {phase === "processing" && (
        <div className="animate-[fadeIn_0.3s_ease-out]">
          <div className="rounded-xl border border-border bg-white p-8 text-center shadow-sm">
            <MorphingDocumentAnimation />
          </div>
        </div>
      )}

      {/* ── Error phase ───────────────────────────────────────────── */}
      {phase === "error" && (
        <div className="animate-[fadeIn_0.3s_ease-out]">
          <div className="rounded-xl border border-red/20 bg-red-light p-8 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h2 className="mb-2 text-base font-semibold text-charcoal">
              Something went wrong
            </h2>
            <p className="mx-auto mb-6 max-w-md text-sm text-txt-secondary">
              {errorMessage}
            </p>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleRetry}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[0.8rem] font-medium text-white transition-colors hover:bg-accent-light"
              >
                Try Again
              </button>
              <Link
                href="/campaigns/new"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-white px-4 text-[0.8rem] font-medium text-charcoal transition-colors hover:bg-cream"
              >
                Use Campaign Wizard
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
