"use client";

import { useState, useRef } from "react";

interface Props {
  candidateId: string;
  initialShortlistNotes: string;
}

export function CandidateNotes({
  candidateId,
  initialShortlistNotes,
}: Props) {
  const [shortlist, setShortlist] = useState(initialShortlistNotes);
  const [saving, setSaving] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(null);

  function save(field: string, value: string) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setSaving(true);
    timeoutRef.current = setTimeout(async () => {
      await fetch(`/api/admin/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      setSaving(false);
    }, 500);
  }

  const textareaClass =
    "w-full rounded-lg border border-border bg-cream/40 px-3.5 py-2.5 text-sm text-charcoal placeholder:text-txt-muted outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/20 resize-none";
  const labelClass =
    "mb-1.5 flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-txt-muted";

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-charcoal">Admin Notes</h3>
        {saving && (
          <span className="text-[0.65rem] text-txt-muted">Saving...</span>
        )}
      </div>

      <div>
        <label className={labelClass}>
          <span>Shortlist Notes</span>
        </label>
        <textarea
          rows={3}
          value={shortlist}
          onChange={(e) => setShortlist(e.target.value)}
          onBlur={() => save("shortlist_notes", shortlist)}
          placeholder="Notes for shortlisting decision..."
          className={textareaClass}
        />
      </div>

    </div>
  );
}
