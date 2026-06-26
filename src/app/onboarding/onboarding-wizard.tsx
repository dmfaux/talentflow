"use client";

import {
  BrandingSection,
  type BrandingValues,
} from "@/components/admin/branding-section";
import { Logo } from "@/components/brand/logo";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type Screen = "welcome" | "brand" | "branding" | "done";

const SCREEN_INDEX: Record<Screen, number> = {
  welcome: 0,
  brand: 1,
  branding: 2,
  done: 3,
};

// A fresh brand starts with no logo and unset colours — we deliberately don't
// pre-fill TalentStream's palette, so skipping leaves the brand on the
// inherited look rather than silently baking in our defaults. brand_text_color
// mirrors the column default so campaign body copy always has a usable value.
const DEFAULT_BRANDING: BrandingValues = {
  logo_url: null,
  logo_background: "light",
  logo_position: "top-left",
  brand_primary_color: "",
  brand_secondary_color: "",
  brand_accent_color: "",
  brand_text_color: "#11123c",
};

// Local mirror of lib/slug's slugify — keeps this a pure client module. The
// server re-derives and validates the slug authoritatively on POST; this is
// only the live "your-brand.talentstream.co.za" preview.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const primaryBtn =
  "group inline-flex h-12 items-center gap-2 rounded-full bg-ink px-7 text-[0.92rem] font-medium text-canvas transition-colors hover:bg-cobalt disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer lift";
const quietBtn =
  "inline-flex h-12 items-center rounded-full px-5 text-[0.92rem] font-medium text-ink-muted transition-colors hover:text-ink cursor-pointer";
const skipBtn =
  "text-[0.85rem] font-medium text-ink-faint underline-offset-4 transition-colors hover:text-ink-muted link-underline cursor-pointer";

export function OnboardingWizard({
  firstName,
  orgName,
}: {
  firstName: string | null;
  orgName: string | null;
}) {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("welcome");
  const [name, setName] = useState("");
  const [createdName, setCreatedName] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [branding, setBranding] = useState<BrandingValues>(DEFAULT_BRANDING);
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingError, setBrandingError] = useState("");

  const slug = slugify(name);

  function leave() {
    // refresh() so the (admin) layout re-resolves the tenant context (and the
    // freshly-created brand) on arrival, rather than serving a stale shell.
    router.push("/dashboard");
    router.refresh();
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your brand a name to continue.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Essentials only — name is enough; the server slugifies it. Logo,
      // colours and contacts are all editable later from brand settings.
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "This name isn't available"
            ? "A brand with a similar web address already exists — try a more specific name."
            : data.error || "Something went wrong. Please try again.",
        );
        return;
      }
      const { data } = await res.json();
      setCreatedName((data && data.name) || trimmed);
      setCreatedId((data && data.id) || "");
      // The brand exists now (we have its id) — offer the optional branding
      // step before the finish screen.
      setScreen("branding");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function patchBranding(patch: Partial<BrandingValues>) {
    setBranding((prev) => ({ ...prev, ...patch }));
  }

  async function handleSaveBranding() {
    // The branding screen is only reachable after a successful create, so we
    // always have an id — fall through to finish if somehow we don't.
    if (!createdId) {
      setScreen("done");
      return;
    }
    setSavingBranding(true);
    setBrandingError("");
    try {
      const res = await fetch(`/api/admin/clients/${createdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branding_logo_url: branding.logo_url,
          logo_background: branding.logo_background,
          logo_position: branding.logo_position,
          // Empty → null so an untouched colour clears to "inherit" rather than
          // tripping the server's hex validation.
          brand_primary_color: branding.brand_primary_color || null,
          brand_secondary_color: branding.brand_secondary_color || null,
          brand_accent_color: branding.brand_accent_color || null,
          brand_text_color: branding.brand_text_color || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setBrandingError(
          data.error || "Couldn’t save your branding. Please try again.",
        );
        return;
      }
      setScreen("done");
    } catch {
      setBrandingError("Couldn’t save your branding. Please try again.");
    } finally {
      setSavingBranding(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-canvas text-ink">
      {/* ── Atmosphere ── */}
      <div className="paper-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute -left-44 top-[-12%] h-[640px] w-[640px] rounded-full bg-gold/[0.10] blur-[170px]" />
      <div className="pointer-events-none absolute -right-40 bottom-[-18%] h-[600px] w-[600px] rounded-full bg-cobalt/[0.12] blur-[160px]" />
      <div className="grain pointer-events-none absolute inset-0" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6">
        {/* ── Header ── */}
        <header className="flex items-center justify-between py-7">
          <Logo size="md" />
          <Progress index={SCREEN_INDEX[screen]} />
        </header>

        {/* ── Body ── */}
        <div className="flex flex-1 items-center justify-center pb-20">
          {screen === "welcome" && (
            <Welcome
              key="welcome"
              firstName={firstName}
              orgName={orgName}
              onStart={() => setScreen("brand")}
              onSkip={leave}
            />
          )}
          {screen === "brand" && (
            <BrandStep
              key="brand"
              name={name}
              slug={slug}
              error={error}
              loading={loading}
              onName={(v) => {
                setName(v);
                if (error) setError("");
              }}
              onSubmit={handleCreate}
              onBack={() => {
                setScreen("welcome");
                setError("");
              }}
              onSkip={leave}
            />
          )}
          {screen === "branding" && (
            <BrandingStep
              key="branding"
              clientId={createdId}
              brandName={createdName}
              values={branding}
              onChange={patchBranding}
              error={brandingError}
              saving={savingBranding}
              onSave={handleSaveBranding}
              onSkip={leave}
            />
          )}
          {screen === "done" && (
            <Done key="done" brandName={createdName} onEnter={leave} />
          )}
        </div>
      </div>
    </main>
  );
}

/* ─────────────────────────────────────────────  Screens  ── */

function Welcome({
  firstName,
  orgName,
  onStart,
  onSkip,
}: {
  firstName: string | null;
  orgName: string | null;
  onStart: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="w-full text-center">
      <p className="eyebrow load-fade load-1 text-cobalt">
        Welcome aboard{firstName ? `, ${firstName}` : ""}
      </p>
      <h1 className="load-fade load-2 mx-auto mt-5 max-w-xl font-display text-[2.9rem] font-medium leading-[1.04] tracking-[-0.02em] sm:text-[3.4rem]">
        Let’s set up your{" "}
        <span className="font-display-italic text-cobalt">first brand</span>.
      </h1>
      <p className="load-fade load-3 mx-auto mt-6 max-w-md text-[1rem] leading-relaxed text-ink-muted">
        A brand is the identity behind your hiring — its name, its look, and its
        careers page.{" "}
        {orgName ? (
          <>
            <span className="font-medium text-ink">{orgName}</span> can run
          </>
        ) : (
          "You can run"
        )}{" "}
        as many as you need. It takes about a minute, and everything is editable
        later.
      </p>

      <div className="load-fade load-4 mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Feature
          icon={<CampaignIcon />}
          title="Run campaigns"
          body="Launch AI-scored hiring campaigns."
        />
        <Feature
          icon={<CandidateIcon />}
          title="Rate candidates"
          body="Auto-score and shortlist applicants."
        />
        <Feature
          icon={<PageIcon />}
          title="Branded careers"
          body="A careers page in your colours."
        />
      </div>

      <div className="load-fade load-5 mt-11 flex items-center justify-center">
        <button onClick={onStart} className={primaryBtn}>
          Get started <Arrow />
        </button>
      </div>
      <button onClick={onSkip} className={`load-fade load-6 mt-6 ${skipBtn}`}>
        I’ll do this later
      </button>
    </div>
  );
}

function BrandStep({
  name,
  slug,
  error,
  loading,
  onName,
  onSubmit,
  onBack,
  onSkip,
}: {
  name: string;
  slug: string;
  error: string;
  loading: boolean;
  onName: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="w-full max-w-lg">
      <div className="text-center">
        <p className="eyebrow load-fade load-1 text-cobalt">Your first brand</p>
        <h2 className="load-fade load-2 mt-4 font-display text-[2.3rem] font-medium leading-tight tracking-[-0.02em] sm:text-[2.7rem]">
          What’s it called?
        </h2>
        <p className="load-fade load-3 mx-auto mt-4 max-w-sm text-[0.95rem] leading-relaxed text-ink-muted">
          Usually your company name, or a sub-brand you hire under.
        </p>
      </div>

      <form onSubmit={onSubmit} className="load-fade load-4 mt-9">
        <input
          autoFocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Acme Corp"
          maxLength={80}
          aria-label="Brand name"
          className="w-full border-b-2 border-border bg-transparent pb-3 text-center font-display text-3xl text-ink outline-none transition-colors placeholder:text-ink-muted/50 focus:border-cobalt sm:text-4xl"
        />
        <p className="mt-4 text-center font-mono text-[0.78rem] text-ink-faint">
          {slug || "your-brand"}
          <span className="text-ink-faint/60">.talentstream.co.za</span>
        </p>

        {error && (
          <p className="mt-5 rounded-lg bg-red-light px-4 py-2.5 text-center text-[0.82rem] text-red">
            {error}
          </p>
        )}

        <p className="mx-auto mt-6 max-w-sm text-center text-[0.78rem] leading-relaxed text-ink-faint">
          Next you can add a logo and brand colours — or skip straight to your
          dashboard.
        </p>

        <div className="mt-8 flex items-center justify-center gap-2">
          <button type="button" onClick={onBack} className={quietBtn}>
            Back
          </button>
          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              <>
                Create brand <Arrow />
              </>
            )}
          </button>
        </div>
      </form>

      <div className="mt-7 text-center">
        <button onClick={onSkip} className={skipBtn}>
          I’ll do this later
        </button>
      </div>
    </div>
  );
}

function BrandingStep({
  clientId,
  brandName,
  values,
  onChange,
  error,
  saving,
  onSave,
  onSkip,
}: {
  clientId: string;
  brandName: string;
  values: BrandingValues;
  onChange: (patch: Partial<BrandingValues>) => void;
  error: string;
  saving: boolean;
  onSave: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="w-full max-w-xl py-4">
      <div className="text-center">
        <p className="eyebrow load-fade load-1 text-cobalt">Make it yours</p>
        <h2 className="load-fade load-2 mt-4 font-display text-[2.3rem] font-medium leading-tight tracking-[-0.02em] sm:text-[2.7rem]">
          Give{" "}
          <span className="font-display-italic text-cobalt">{brandName}</span> a
          look.
        </h2>
        <p className="load-fade load-3 mx-auto mt-4 max-w-md text-[0.95rem] leading-relaxed text-ink-muted">
          Add a logo and brand colours — they shape your careers page and the
          emails candidates receive. Everything stays editable later.
        </p>
      </div>

      <div className="load-fade load-4 mt-8 rounded-2xl border border-border bg-surface p-6 text-left sm:p-7">
        <BrandingSection clientId={clientId} values={values} onChange={onChange} />
      </div>

      {error && (
        <p className="mt-5 rounded-lg bg-red-light px-4 py-2.5 text-center text-[0.82rem] text-red">
          {error}
        </p>
      )}

      <div className="load-fade load-5 mt-8 flex items-center justify-center">
        <button onClick={onSave} disabled={saving} className={primaryBtn}>
          {saving ? (
            <>
              <Spinner /> Saving…
            </>
          ) : (
            <>
              Save &amp; continue <Arrow />
            </>
          )}
        </button>
      </div>
      <div className="mt-6 text-center">
        <button onClick={onSkip} className={`load-fade load-6 ${skipBtn}`}>
          Skip for now
        </button>
      </div>
    </div>
  );
}

function Done({
  brandName,
  onEnter,
}: {
  brandName: string;
  onEnter: () => void;
}) {
  return (
    <div className="w-full text-center">
      <div className="load-fade load-1 mx-auto flex h-20 w-20 items-center justify-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full bg-moss text-white"
          style={{ animation: "glowPulse 2.4s ease-in-out infinite" }}
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.5l4.5 4.5L19 7" />
          </svg>
        </div>
      </div>
      <p className="eyebrow load-fade load-2 mt-6 text-moss">All set</p>
      <h2 className="load-fade load-3 mx-auto mt-4 max-w-lg font-display text-[2.4rem] font-medium leading-tight tracking-[-0.02em] sm:text-[2.9rem]">
        <span className="font-display-italic text-cobalt">{brandName}</span> is
        ready.
      </h2>
      <p className="load-fade load-4 mx-auto mt-5 max-w-md text-[0.98rem] leading-relaxed text-ink-muted">
        Your brand is live. Launch your first campaign whenever you’re ready —
        every detail stays editable from settings.
      </p>
      <div className="load-fade load-5 mt-10 flex items-center justify-center">
        <button onClick={onEnter} className={primaryBtn}>
          Enter your dashboard <Arrow />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────  Bits  ── */

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border/80 bg-surface/70 p-4 text-left backdrop-blur-sm">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cobalt-tint text-cobalt">
        {icon}
      </div>
      <p className="mt-3 text-[0.82rem] font-semibold text-ink">{title}</p>
      <p className="mt-1 text-[0.75rem] leading-snug text-ink-muted">{body}</p>
    </div>
  );
}

function Progress({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-1 rounded-full transition-all duration-500 ${
            i <= index ? "w-7 bg-cobalt" : "w-3.5 bg-border-strong/40"
          }`}
        />
      ))}
    </div>
  );
}

function Arrow() {
  return (
    <svg
      className="arrow-slide"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CampaignIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.25" y="3" width="11.5" height="9" rx="1.5" />
      <path d="M5 6.25h6M5 9h4" />
    </svg>
  );
}

function CandidateIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3.5 13a4.5 4.5 0 0 1 9 0" />
    </svg>
  );
}

function PageIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M2.5 6h11" />
    </svg>
  );
}
