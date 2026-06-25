interface DecisionEntry {
  id: string;
  action: string;
  reason: string | null;
  reason_sent_to_candidate: boolean;
  actor_name: string | null;
  actor_email: string | null;
  created_at: string;
}

interface Props {
  entries: DecisionEntry[];
}

const ACTION_LABELS: Record<string, string> = {
  reject_recommended: "AI recommended rejection",
  reject_accepted: "Rejection accepted",
  reject_dismissed: "Recommendation dismissed",
};

const ACTION_STYLES: Record<string, string> = {
  reject_recommended: "bg-warning-light text-warning",
  reject_accepted: "bg-red-light text-red",
  reject_dismissed: "bg-green-light text-accent",
};

/** Append-only trail of human-in-the-loop rejection decisions for a candidate:
 *  who accepted/dismissed the AI's rejection recommendation, when, and why. A
 *  system row (no actor) records the AI's original recommendation. */
export function DecisionHistory({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between px-5 py-4">
        <h3 className="text-sm font-semibold text-charcoal">
          Decision History
          <span className="ml-2 font-mono text-xs font-normal text-txt-muted">
            {entries.length}
          </span>
        </h3>
      </div>
      <div className="border-t border-border divide-y divide-border">
        {entries.map((e) => (
          <div key={e.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span
                className={`inline-block rounded-full px-2 py-0.5 text-[0.6rem] font-medium ${
                  ACTION_STYLES[e.action] ?? "bg-cream text-txt-secondary"
                }`}
              >
                {ACTION_LABELS[e.action] ?? e.action.replace(/_/g, " ")}
              </span>
              <span className="text-txt-secondary">
                {e.actor_name ?? "System · AI"}
              </span>
              <span className="font-mono text-txt-muted">
                {new Date(e.created_at).toLocaleString("en-ZA")}
              </span>
              {e.reason_sent_to_candidate && (
                <span className="inline-block rounded-full bg-cream px-2 py-0.5 text-[0.6rem] font-medium text-txt-secondary">
                  Shared with candidate
                </span>
              )}
            </div>
            {e.reason && (
              <p className="mt-1.5 text-sm leading-relaxed text-charcoal">
                {e.reason}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
