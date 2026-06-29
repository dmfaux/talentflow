"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast-provider";
import {
  CONSENT_ATTESTATIONS,
  CONSENT_BASES,
  CURRENT_ATTESTATION,
  type ConsentBasis,
} from "@/lib/consent";
import type { GatingQuestion } from "@/lib/gating";

interface Props {
  campaignId: string;
  status: string;
  gatingConfig: GatingQuestion[];
  /** Cosmetic gate — the server enforces recruiter+ and active/paused too. */
  canManage?: boolean;
}

type Path = "invite" | "skip";
type CvMode = "file" | "paste";

const BASIS_LABELS: Record<ConsentBasis, string> = {
  verbal: "Verbal agreement",
  written: "Written or email",
  prior_application: "Consented in a prior application",
  existing_relationship: "Existing client relationship",
  other: "Other",
};

export function AddCandidateModal({ campaignId, status, gatingConfig, canManage = true }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<Path>("invite");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [cvMode, setCvMode] = useState<CvMode>("file");
  const [cvText, setCvText] = useState("");
  const [showGating, setShowGating] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [attested, setAttested] = useState(false);
  const [basis, setBasis] = useState<ConsentBasis | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only recruiter+ can add, and only while the campaign is taking candidates.
  if (!canManage || (status !== "active" && status !== "paused")) return null;

  function reset() {
    setPath("invite");
    setName("");
    setEmail("");
    setPhone("");
    setCvMode("file");
    setCvText("");
    setShowGating(false);
    setAnswers({});
    setAttested(false);
    setBasis("");
    setNote("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    if (submitting) return;
    setOpen(false);
    reset();
  }

  function answeredGating(): Record<string, string> {
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(answers)) if (v) filled[k] = v;
    return filled;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) return setError("Add the candidate's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setError("Add a valid email address.");
    }

    const file = fileRef.current?.files?.[0] ?? null;

    if (path === "skip") {
      if (!file && !cvText.trim()) {
        return setError("Add a CV — upload a file or paste the text — to add someone directly.");
      }
      if (!attested) {
        return setError("Confirm you have the candidate's consent.");
      }
      if (!basis) return setError("Choose how you obtained consent.");
      if (basis === "other" && !note.trim()) {
        return setError("Add a note describing the basis of consent.");
      }
    }

    setSubmitting(true);
    try {
      let res: Response;
      const url = `/api/admin/campaigns/${campaignId}/candidates`;

      if (path === "skip" && cvMode === "file" && file) {
        const fd = new FormData();
        fd.set("path", "skip");
        fd.set("name", name.trim());
        fd.set("email", email.trim());
        if (phone.trim()) fd.set("phone", phone.trim());
        fd.set("cv", file);
        fd.set("gating", JSON.stringify(answeredGating()));
        fd.set("consent", JSON.stringify({ version: CURRENT_ATTESTATION, basis, note: note.trim() || null }));
        res = await fetch(url, { method: "POST", body: fd });
      } else {
        const body =
          path === "invite"
            ? { path, name: name.trim(), email: email.trim(), phone: phone.trim() || undefined }
            : {
                path: "skip",
                name: name.trim(),
                email: email.trim(),
                phone: phone.trim() || undefined,
                cv_text: cvText.trim() || undefined,
                gating: answeredGating(),
                consent: { version: CURRENT_ATTESTATION, basis, note: note.trim() || null },
              };
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (res.ok) {
        toast(path === "invite" ? "Invite sent" : "Candidate added", "success");
        setOpen(false);
        reset();
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Something went wrong. Try again.");
      }
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Add candidate
      </Button>

      <Modal open={open} onClose={close} title="Add a candidate" size="lg" dismissible={!submitting}>
        <form onSubmit={submit} className="space-y-4">
          {/* Path toggle */}
          <div className="inline-flex rounded-lg border border-rule bg-canvas/60 p-0.5">
            {(["invite", "skip"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPath(p)}
                aria-pressed={path === p}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  path === p ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                }`}
              >
                {p === "invite" ? "Invite to apply" : "Add directly"}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-muted">
            {path === "invite"
              ? "We'll email them a link to complete the application themselves — CV, screening, and consent."
              : "You provide their CV and confirm you have their consent. They're scored straight away."}
          </p>

          <Field label="Full name" htmlFor="ac-name" required>
            <Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Thandi Khumalo" autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="ac-email" required>
            <Input id="ac-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="thandi@example.com" autoComplete="off" />
          </Field>
          <Field label="Phone" htmlFor="ac-phone" helper="Optional.">
            <Input id="ac-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27 …" autoComplete="off" />
          </Field>

          {path === "skip" && (
            <>
              {/* CV */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="block text-[0.8rem] font-medium text-ink-soft">
                    CV<span className="text-red"> *</span>
                  </span>
                  <div className="inline-flex rounded-lg border border-rule bg-canvas/60 p-0.5">
                    {(["file", "paste"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setCvMode(m)}
                        aria-pressed={cvMode === m}
                        className={`rounded-md px-2.5 py-1 text-[0.7rem] font-medium transition-colors cursor-pointer ${
                          cvMode === m ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"
                        }`}
                      >
                        {m === "file" ? "Upload file" : "Paste text"}
                      </button>
                    ))}
                  </div>
                </div>
                {cvMode === "file" ? (
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.doc,.docx"
                    className="block w-full cursor-pointer rounded-lg border border-rule bg-canvas/40 text-sm text-ink-soft file:mr-3 file:cursor-pointer file:border-0 file:bg-canvas-2 file:px-3 file:py-2 file:text-[0.8rem] file:font-medium file:text-ink-soft hover:file:bg-rule/40"
                  />
                ) : (
                  <Textarea
                    value={cvText}
                    onChange={(e) => setCvText(e.target.value)}
                    rows={5}
                    placeholder="Paste the candidate's CV or LinkedIn text…"
                    aria-label="Pasted CV text"
                  />
                )}
                <p className="text-xs text-ink-muted">PDF, DOC, or DOCX — or paste the text directly.</p>
              </div>

              {/* Screening questions (optional) */}
              {gatingConfig.length > 0 && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowGating((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-cobalt hover:underline cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className={showGating ? "rotate-90 transition-transform" : "transition-transform"}>
                      <path d="M4.5 3l3 3-3 3" />
                    </svg>
                    Answer screening questions
                    <span className="font-normal text-ink-muted">(optional)</span>
                  </button>
                  {showGating && (
                    <div className="space-y-3 border-l border-rule pl-4">
                      <p className="text-xs text-ink-muted">
                        Leave blank to vouch for the candidate and bypass screening. Any answers you give are evaluated normally.
                      </p>
                      {gatingConfig.map((q) => (
                        <Field key={q.id} label={q.label} htmlFor={`ac-gq-${q.id}`}>
                          <Select
                            id={`ac-gq-${q.id}`}
                            value={answers[q.id] ?? ""}
                            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                          >
                            <option value="">— No answer —</option>
                            {q.options.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.value}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Consent attestation */}
              <div className="space-y-3 rounded-lg border border-rule bg-canvas/40 p-3">
                <label className="flex cursor-pointer items-start gap-2.5 text-[0.8rem] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-cobalt cursor-pointer"
                  />
                  <span>{CONSENT_ATTESTATIONS[CURRENT_ATTESTATION]}</span>
                </label>
                <Field label="How was consent obtained?" htmlFor="ac-basis" required>
                  <Select id="ac-basis" value={basis} onChange={(e) => setBasis(e.target.value as ConsentBasis)}>
                    <option value="">— Select —</option>
                    {CONSENT_BASES.map((b) => (
                      <option key={b} value={b}>
                        {BASIS_LABELS[b]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {basis === "other" && (
                  <Field label="Describe the basis" htmlFor="ac-note" required>
                    <Textarea id="ac-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. met at a careers fair and agreed to be added" />
                  </Field>
                )}
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-lg border border-red/25 bg-red-light px-3 py-2 text-xs text-red">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={submitting}>
              {path === "invite" ? "Send invite" : "Add candidate"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
