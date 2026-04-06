"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmModal } from "@/components/admin/template-editor/modal";
import { buildTemplatePrompt, type BrandColors } from "@/lib/templates/prompt-builder";
import { validateHtmlTemplate, replaceSlots, type SlotData } from "@/lib/templates/slots";

type TemplateStatus = "draft" | "pending" | "published" | "archived";

interface Template {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: TemplateStatus;
  html_template: string | null;
  published_html_template: string | null;
  preview_token: string | null;
  preview_token_expires_at: string | null;
  thumbnail_url: string | null;
  owner_client_id: string | null;
  owner_client_name: string | null;
  owner_client_slug: string | null;
  active_campaign_count: number;
  total_campaign_count: number;
}

interface HistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
}

const SAMPLE_SLOT_DATA: SlotData = {
  client: { name: "Acme Corp" },
  campaign: {
    role_title: "Senior Software Engineer",
    role_description: "We are looking for an experienced engineer to join our growing team.",
    department: "Engineering",
    location: "Cape Town",
    employment_type: "Permanent",
    salary_range_min: 650000,
    salary_range_max: 900000,
  },
};

const FORM_PLACEHOLDER_HTML = `<div style="padding:2rem;background:#f9f9f9;border:1px dashed #ccc;border-radius:0.75rem;text-align:center;color:#888;font-family:sans-serif">
  <p style="margin:0 0 0.5rem;font-size:0.9rem;font-weight:600">Application Form</p>
  <p style="margin:0;font-size:0.78rem">This area will contain the interactive application form at runtime.</p>
</div>`;

const STATUS_LABELS: Record<TemplateStatus, string> = {
  draft: "Draft",
  pending: "Pending Review",
  published: "Published",
  archived: "Archived",
};

const TRANSITION_OPTIONS: Record<
  TemplateStatus,
  { to: TemplateStatus; label: string; variant: "primary" | "danger" }[]
> = {
  draft: [
    { to: "pending", label: "Submit for review", variant: "primary" },
    { to: "archived", label: "Archive", variant: "danger" },
  ],
  pending: [
    { to: "published", label: "Approve & publish", variant: "primary" },
    { to: "draft", label: "Back to draft", variant: "primary" },
    { to: "archived", label: "Archive", variant: "danger" },
  ],
  published: [
    { to: "draft", label: "Revert to draft", variant: "primary" },
    { to: "archived", label: "Archive", variant: "danger" },
  ],
  archived: [{ to: "draft", label: "Revive as draft", variant: "primary" }],
};

export default function TemplateEditPage() {
  const { id } = useParams<{ id: string }>();

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Edit state
  const [nameEdit, setNameEdit] = useState("");
  const [descEdit, setDescEdit] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Regeneration state
  const [brief, setBrief] = useState("");
  const [pastedHtml, setPastedHtml] = useState("");
  const [htmlValidation, setHtmlValidation] = useState<
    { kind: "empty" } | { kind: "ok" } | { kind: "errors"; errors: string[] }
  >({ kind: "empty" });
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Transition state
  const [transitionTarget, setTransitionTarget] = useState<{
    to: TemplateStatus;
    label: string;
    variant: "primary" | "danger";
  } | null>(null);
  const [transitioning, setTransitioning] = useState(false);

  // Preview
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

  // Fetch template + history
  const fetchData = useCallback(() => {
    fetch(`/api/admin/templates/${id}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.data) {
          setTemplate(res.data);
          setNameEdit(res.data.name);
          setDescEdit(res.data.description ?? "");
          setBrief(res.data.description ?? "");
        }
      })
      .finally(() => setLoading(false));
    fetch(`/api/admin/templates/${id}/history`)
      .then((r) => r.json())
      .then((res) => setHistory(res.data ?? []));
  }, [id]);

  useEffect(fetchData, [fetchData]);

  // Debounced HTML validation
  useEffect(() => {
    const trimmed = pastedHtml.trim();
    if (!trimmed) {
      setHtmlValidation({ kind: "empty" });
      return;
    }
    const t = setTimeout(() => {
      const result = validateHtmlTemplate(trimmed);
      setHtmlValidation(result.ok ? { kind: "ok" } : { kind: "errors", errors: result.errors });
    }, 300);
    return () => clearTimeout(t);
  }, [pastedHtml]);

  // Build preview HTML with sample data
  const previewHtml = useMemo(() => {
    const raw = template?.html_template ?? template?.published_html_template;
    if (!raw) return null;
    let html = replaceSlots(raw, SAMPLE_SLOT_DATA);
    // Replace the form mount div with a placeholder for preview
    html = html.replace(
      /<div\s+id\s*=\s*["']application-form["']\s*>\s*<\/div>/i,
      FORM_PLACEHOLDER_HTML
    );
    return html;
  }, [template]);

  // Generate prompt for regeneration
  const brandColors: BrandColors | null = null; // Bespoke brand colors could be fetched but for now omit
  const prompt = useMemo(
    () =>
      buildTemplatePrompt({
        name: nameEdit || "(unnamed)",
        brief: brief || "(no brief)",
        brandColors,
      }),
    [nameEdit, brief, brandColors]
  );

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Save metadata (name, description)
  async function handleSaveMeta() {
    if (!template || template.status !== "draft") return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameEdit.trim(),
          description: descEdit.trim() || null,
        }),
      });
      if (res.ok) {
        setSaveMsg("Saved");
        setTimeout(() => setSaveMsg(null), 2000);
        fetchData();
      }
    } finally {
      setSaving(false);
    }
  }

  // Replace HTML
  async function handleReplace() {
    if (!template || template.status !== "draft") return;
    const trimmed = pastedHtml.trim();
    const result = validateHtmlTemplate(trimmed);
    if (!result.ok) {
      setReplaceError(result.errors.join("; "));
      return;
    }
    setReplacing(true);
    setReplaceError(null);
    try {
      const res = await fetch(`/api/admin/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html_template: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        setReplaceError(body.error ?? "Failed to update");
        return;
      }
      setPastedHtml("");
      fetchData();
    } catch {
      setReplaceError("Something went wrong");
    } finally {
      setReplacing(false);
    }
  }

  // Status transition
  async function handleTransition() {
    if (!transitionTarget || !template) return;
    setTransitioning(true);
    try {
      const res = await fetch(`/api/admin/templates/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: transitionTarget.to }),
      });
      const body = await res.json();
      if (!res.ok) {
        alert(body.error ?? "Transition failed");
        return;
      }
      setTransitionTarget(null);
      fetchData();
    } finally {
      setTransitioning(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-txt-muted">
        Loading template...
      </div>
    );
  }

  if (!template) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-txt-muted">Template not found.</p>
        <Link href="/templates" className="mt-2 text-sm text-cobalt hover:underline">
          Back to templates
        </Link>
      </div>
    );
  }

  const isDraft = template.status === "draft";
  const transitions = TRANSITION_OPTIONS[template.status];
  const iframeWidth = previewDevice === "mobile" ? "375px" : "100%";

  return (
    <div className="pb-16">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/templates"
          className="mb-3 inline-flex items-center gap-1 text-[0.72rem] text-txt-muted transition-colors hover:text-charcoal"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M7.5 2.5L4 6l3.5 3.5" />
          </svg>
          Templates
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl text-charcoal">{template.name}</h1>
            <div className="mt-1 flex items-center gap-3 text-[0.75rem] text-txt-secondary">
              <span className="font-mono">{template.key}</span>
              <span className="inline-flex items-center gap-1">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                  template.status === "published" ? "bg-green" :
                  template.status === "pending" ? "bg-saffron" :
                  template.status === "archived" ? "bg-red" : "bg-ink-muted"
                }`} />
                {STATUS_LABELS[template.status]}
              </span>
              {template.active_campaign_count > 0 && (
                <span>{template.active_campaign_count} active campaign{template.active_campaign_count !== 1 ? "s" : ""}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {transitions.map((t) => (
              <button
                key={t.to}
                type="button"
                onClick={() => setTransitionTarget(t)}
                className={`inline-flex h-9 items-center rounded-lg px-4 text-[0.78rem] font-medium transition-colors cursor-pointer ${
                  t.variant === "danger"
                    ? "text-red hover:bg-red/10"
                    : "bg-cobalt text-ink hover:bg-cobalt-deep"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-6">
        {/* Left: Preview */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
              Preview
            </h2>
            <div className="inline-flex rounded-md border border-border">
              {(["desktop", "mobile"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setPreviewDevice(d)}
                  className={`px-3 py-1 text-[0.68rem] font-medium capitalize transition-colors cursor-pointer ${
                    previewDevice === d
                      ? "bg-charcoal text-paper"
                      : "text-txt-muted hover:text-charcoal"
                  } ${d === "desktop" ? "rounded-l-md" : "rounded-r-md"}`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-paper">
            {previewHtml ? (
              <iframe
                srcDoc={previewHtml}
                title="Template preview"
                sandbox=""
                className="h-[600px] border-0 transition-all"
                style={{ width: iframeWidth, margin: previewDevice === "mobile" ? "0 auto" : undefined, display: "block" }}
              />
            ) : (
              <div className="flex h-[400px] items-center justify-center text-sm text-txt-muted">
                No HTML template yet. Use the regeneration section to create one.
              </div>
            )}
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="space-y-6">
          {/* Metadata */}
          {isDraft && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                Details
              </h3>
              <label className="mb-1 block text-[0.68rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
                Name
              </label>
              <input
                type="text"
                value={nameEdit}
                onChange={(e) => setNameEdit(e.target.value)}
                className="mb-3 h-8 w-full rounded-md border border-border bg-paper px-2.5 text-[0.8rem] text-charcoal focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20"
              />
              <label className="mb-1 block text-[0.68rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
                Description
              </label>
              <textarea
                value={descEdit}
                onChange={(e) => setDescEdit(e.target.value)}
                rows={3}
                className="mb-3 w-full rounded-md border border-border bg-paper px-2.5 py-1.5 text-[0.8rem] text-charcoal focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20"
              />
              <button
                type="button"
                onClick={handleSaveMeta}
                disabled={saving}
                className="inline-flex h-8 items-center rounded-lg bg-cobalt px-3 text-[0.72rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer"
              >
                {saving ? "Saving..." : saveMsg ?? "Save details"}
              </button>
            </section>
          )}

          {/* Regeneration */}
          {isDraft && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                {template.html_template ? "Replace HTML" : "Generate HTML"}
              </h3>
              <label className="mb-1 block text-[0.68rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
                Design brief
              </label>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={3}
                placeholder="Describe the template style..."
                className="mb-2 w-full rounded-md border border-border bg-paper px-2.5 py-1.5 text-[0.8rem] text-charcoal placeholder:text-txt-muted focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/20"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="mb-4 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-paper px-2.5 text-[0.68rem] font-medium text-txt-secondary transition-colors hover:bg-cream hover:text-charcoal cursor-pointer"
              >
                {copied ? (
                  <>
                    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="#067340" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5L6 10l5-6" /></svg>
                    Copied prompt
                  </>
                ) : (
                  <>
                    <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="5" width="7" height="7" rx="1" />
                      <path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" />
                    </svg>
                    Copy prompt for AI
                  </>
                )}
              </button>

              <label className="mb-1 block text-[0.68rem] font-medium uppercase tracking-[0.08em] text-txt-secondary">
                Paste HTML result
              </label>
              {htmlValidation.kind === "errors" && (
                <div className="mb-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[0.7rem] text-red">
                  {htmlValidation.errors.map((e, i) => (
                    <div key={i} className="break-words">{e}</div>
                  ))}
                </div>
              )}
              <textarea
                value={pastedHtml}
                onChange={(e) => setPastedHtml(e.target.value)}
                rows={6}
                placeholder="<!DOCTYPE html>..."
                spellCheck={false}
                className={`mb-2 w-full rounded-md border bg-paper px-2.5 py-1.5 font-mono text-[0.7rem] leading-relaxed text-charcoal placeholder:text-txt-muted focus:outline-none focus:ring-2 ${
                  htmlValidation.kind === "errors"
                    ? "border-red/50 focus:ring-red/20"
                    : "border-border focus:ring-cobalt/20"
                }`}
              />
              {htmlValidation.kind === "ok" && (
                <p className="mb-2 inline-flex items-center gap-1 text-[0.68rem] text-green">
                  <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5L6 10l5-6" /></svg>
                  Valid HTML
                </p>
              )}
              {replaceError && (
                <div className="mb-2 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-[0.7rem] text-red">
                  {replaceError}
                </div>
              )}
              <button
                type="button"
                onClick={handleReplace}
                disabled={htmlValidation.kind !== "ok" || replacing}
                className="inline-flex h-8 items-center rounded-lg bg-cobalt px-3 text-[0.72rem] font-medium text-ink transition-colors hover:bg-cobalt-deep disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              >
                {replacing ? "Replacing..." : "Replace HTML"}
              </button>
            </section>
          )}

          {/* History */}
          {history.length > 0 && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-txt-muted">
                History
              </h3>
              <ul className="space-y-2">
                {history.slice(0, 10).map((h) => (
                  <li key={h.id} className="text-[0.72rem] text-txt-secondary">
                    <span className="font-medium text-charcoal">
                      {h.from_status ? `${h.from_status} → ${h.to_status}` : `Created as ${h.to_status}`}
                    </span>
                    <span className="ml-2 text-txt-muted">
                      {new Date(h.changed_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* Transition confirmation modal */}
      <ConfirmModal
        open={!!transitionTarget}
        onClose={() => !transitioning && setTransitionTarget(null)}
        onConfirm={handleTransition}
        title={transitionTarget?.label ?? ""}
        body={
          transitionTarget?.to === "published"
            ? "This will snapshot the current HTML and make it available to campaigns. Existing live campaigns will update to this version."
            : transitionTarget?.to === "pending"
              ? "This will lock the template for review and generate a 14-day preview link."
              : transitionTarget?.to === "draft"
                ? "This will move the template back to draft for editing. Live campaigns will continue rendering the last published version."
                : "This will archive the template. It will no longer be selectable for new campaigns."
        }
        confirmLabel={transitionTarget?.label ?? "Confirm"}
        variant={transitionTarget?.variant ?? "primary"}
        busy={transitioning}
      />
    </div>
  );
}
