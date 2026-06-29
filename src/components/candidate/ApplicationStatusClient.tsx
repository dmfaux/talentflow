"use client";

import { useState, useEffect } from "react";
import { buildPalette, type BrandColours } from "./palette";

interface Props {
  clientSlug: string;
  campaignSlug: string;
  roleTitle: string;
  companyName: string;
  logoUrl: string | null;
  brandColours: BrandColours;
}

type Status =
  | { kind: "loading" }
  | { kind: "in_review" }
  | { kind: "chat_ready"; conversationId: string }
  | { kind: "withdrawn" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export function ApplicationStatusClient({
  clientSlug,
  campaignSlug,
  roleTitle,
  companyName,
  logoUrl,
  brandColours,
}: Props) {
  // Same key the chat page uses, so the token carries over to "continue to chat".
  const storageKey = `ts_chat_${clientSlug}_${campaignSlug}`;
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const c = buildPalette(brandColours);

  useEffect(() => {
    // The notice email carries the token in the URL fragment; the server never
    // sees it, so read it here, persist it, then strip it from the address bar.
    let resolved: string | null = null;
    const hash = window.location.hash;
    if (hash.startsWith("#chat_token=")) {
      resolved = hash.slice("#chat_token=".length);
      try {
        localStorage.setItem(storageKey, resolved);
      } catch {}
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      try {
        resolved = localStorage.getItem(storageKey);
      } catch {}
    }

    let cancelled = false;
    (async () => {
      if (!resolved) {
        if (!cancelled) setStatus({ kind: "invalid" });
        return;
      }
      if (!cancelled) setToken(resolved);
      try {
        const res = await fetch("/api/candidates/status", {
          headers: { "x-chat-token": resolved },
        });
        if (cancelled) return;
        if (res.status === 401) return setStatus({ kind: "invalid" });
        if (!res.ok) return setStatus({ kind: "unavailable" });
        const data = await res.json();
        if (data.state === "chat_ready") {
          setStatus({ kind: "chat_ready", conversationId: data.conversationId });
        } else if (data.state === "withdrawn") {
          setStatus({ kind: "withdrawn" });
        } else {
          setStatus({ kind: "in_review" });
        }
      } catch {
        if (!cancelled) setStatus({ kind: "unavailable" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  if (status.kind === "loading") {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ backgroundColor: c.chatBg }}
      >
        <div
          className="h-6 w-6 animate-spin rounded-full border-2"
          style={{ borderColor: c.spinnerTrack, borderTopColor: c.spinnerHead }}
        />
      </div>
    );
  }

  const content = COPY[status.kind](roleTitle, companyName);
  const chatHref =
    status.kind === "chat_ready"
      ? `/c/${clientSlug}/${campaignSlug}/chat?t=${status.conversationId}#chat_token=${token}`
      : null;
  // Opt-out belongs only where the candidate is still in the process.
  const showOptOut =
    token && (status.kind === "in_review" || status.kind === "chat_ready");

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ backgroundColor: c.chatBg }}
    >
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-40" />
      <div
        className="pointer-events-none absolute left-1/2 top-1/3 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
        style={{ backgroundColor: c.primaryTint, opacity: 0.6 }}
      />

      <div
        className="relative z-10 mx-auto max-w-md px-6 text-center"
        style={{ animation: "fadeInUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) both" }}
      >
        {logoUrl && (
          <div className="mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoUrl}
              alt={companyName}
              className="mx-auto h-10 max-w-[180px] object-contain"
            />
          </div>
        )}

        <div
          className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl"
          style={{ backgroundColor: c.primaryTint }}
        >
          <StatusIcon kind={status.kind} color={c.primary} />
        </div>

        <h1
          className="font-display-italic text-2xl"
          style={{ color: c.textStrong }}
        >
          {content.heading}
        </h1>
        <p
          className="mt-3 text-sm leading-relaxed"
          style={{ color: c.textMuted }}
        >
          {content.body}
        </p>

        {chatHref && (
          <a
            href={chatHref}
            className="mt-7 inline-flex items-center justify-center rounded-xl px-6 py-3 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: c.primary, color: c.primaryText }}
          >
            Continue to chat
          </a>
        )}

        {showOptOut && (
          <p className="mt-8 text-xs" style={{ color: c.textFaint }}>
            Not you, or want to be removed?{" "}
            <a
              href={`/api/candidates/opt-out?t=${token}`}
              className="underline underline-offset-2 hover:no-underline"
              style={{ color: c.textMuted }}
            >
              Opt out and delete your information.
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

const COPY: Record<
  Exclude<Status["kind"], "loading">,
  (roleTitle: string, companyName: string) => { heading: string; body: string }
> = {
  in_review: (roleTitle, companyName) => ({
    heading: "You're in the running",
    body: `${companyName}'s team is reviewing your profile for the ${roleTitle} role. If they'd like to know more, you'll get an email with a link to chat — there's nothing you need to do right now.`,
  }),
  chat_ready: (roleTitle, companyName) => ({
    heading: "The team has a few questions",
    body: `${companyName}'s recruitment team would like to learn a little more about your background for the ${roleTitle} role. It only takes a few minutes.`,
  }),
  withdrawn: () => ({
    heading: "You've been removed",
    body: "Your details have been withdrawn from this hiring process and your personal information has been scheduled for deletion. You won't receive further messages about this role.",
  }),
  invalid: () => ({
    heading: "This link isn't valid",
    body: "Open this page from the link in your most recent email. If it keeps not working, please reply to that email and the team will help.",
  }),
  unavailable: () => ({
    heading: "Not available right now",
    body: "We can't show your application status at the moment. Please try again later, or contact the employer directly.",
  }),
};

function StatusIcon({
  kind,
  color,
}: {
  kind: Exclude<Status["kind"], "loading">;
  color: string;
}) {
  const common = {
    width: 32,
    height: 32,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (kind === "chat_ready") {
    return (
      <svg {...common}>
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    );
  }
  if (kind === "withdrawn") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (kind === "invalid" || kind === "unavailable") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
    );
  }
  // in_review — a "reviewing" clock.
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
