"use client";

import { useState, useRef } from "react";
import { Textarea } from "@/components/ui/field";

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

  const labelClass =
    "mb-1.5 flex items-center justify-between text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-ink-muted";

  return (
    <div className="rounded-xl border border-rule bg-surface p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Admin notes</h3>
        {saving && (
          <span className="text-[0.65rem] text-ink-muted">Saving...</span>
        )}
      </div>

      <div>
        <label htmlFor="shortlist-notes" className={labelClass}>
          <span>Shortlist notes</span>
        </label>
        <Textarea
          id="shortlist-notes"
          rows={3}
          value={shortlist}
          onChange={(e) => setShortlist(e.target.value)}
          onBlur={() => save("shortlist_notes", shortlist)}
          placeholder="Notes for shortlisting decision..."
        />
      </div>

    </div>
  );
}
