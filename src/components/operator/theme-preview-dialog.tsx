"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PreviewStatusOverlay,
  type ThemePreviewPayload,
} from "./theme-email-preview";
import {
  useThemePreview,
  type PreviewStatus,
  type ThemePreviewData,
} from "./use-theme-preview";

// The realistic theme preview — a full-screen view that renders the SAME server
// HTML as the inline builder previews, but at true size inside a frame that
// matches where a candidate actually meets it: an inbox row for the email, a
// browser window (with a desktop/mobile toggle) for the landing page. The cramped
// inline column can never show the landing's desktop two-column layout — its own
// max-width media query collapses it to mobile — so this is where the operator
// confirms the work. "Open in new tab" hands the current render to the browser as
// a Blob URL, so no extra server route is needed.

type Surface = "email" | "landing";
type Device = "desktop" | "mobile";

const EMAIL_ENDPOINT = "/api/operator/themes/preview";
const LANDING_ENDPOINT = "/api/operator/themes/landing-preview";
// Desktop wide enough to clear the landing's 880px collapse breakpoint; mobile at
// a common phone width to exercise the responsive layout on purpose.
const DESKTOP_W = 1280;
const MOBILE_W = 390;
const CHROME_H = 40;
// Mirrors the routes' fallbacks, for labelling chrome before the first render
// lands (the rendered `sample` echo replaces these as soon as it arrives).
const FALLBACK_BRAND = "Northwind Studio";
const FALLBACK_ROLE = "Senior Software Engineer";
const FALLBACK_CANDIDATE = "Sam";

function slugify(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "brand"
  );
}

const surfaceToggleClass = (active: boolean) =>
  `rounded-md px-2.5 py-1 font-mono text-[0.58rem] uppercase tracking-[0.1em] transition-colors cursor-pointer ${
    active ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink-soft"
  }`;

export function ThemePreviewDialog({
  initialSurface,
  initialData = null,
  payload,
  landingHtml,
  brandName,
  onClose,
}: {
  initialSurface: Surface;
  /** The builder's current render for `initialSurface`, so opening is instant. */
  initialData?: ThemePreviewData | null;
  payload: ThemePreviewPayload;
  /** A validated bespoke landing to preview instead of the generated page. */
  landingHtml?: string;
  brandName?: string;
  onClose: () => void;
}) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [device, setDevice] = useState<Device>("desktop");
  const isEmail = surface === "email";

  const endpoint = isEmail ? EMAIL_ENDPOINT : LANDING_ENDPOINT;
  const body = useMemo(() => {
    if (isEmail) return payload;
    return landingHtml?.trim()
      ? { ...payload, landing_html: landingHtml }
      : payload;
  }, [isEmail, payload, landingHtml]);

  const { data, status } = useThemePreview({
    endpoint,
    body,
    initialData: surface === initialSurface ? initialData : null,
  });
  const html = data?.html ?? null;

  const panelRef = useRef<HTMLDivElement>(null);
  // True while a mousedown that began on the backdrop is still held — so a drag
  // that starts inside the panel and releases on the backdrop doesn't close it.
  const backdropArmed = useRef(false);

  // Esc closes; Tab is trapped within the panel; background scroll is locked; and
  // focus moves into the panel, then back to the trigger on close.
  useEffect(() => {
    const panel = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevFocus = document.activeElement as HTMLElement | null;
    panel?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  function openInNewTab() {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      URL.revokeObjectURL(url);
      return;
    }
    // Release the object URL once the new tab has had time to load the document.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const company = data?.sample?.company || brandName || FALLBACK_BRAND;
  const role = data?.sample?.role || FALLBACK_ROLE;
  const candidate = data?.sample?.candidate || FALLBACK_CANDIDATE;
  // Mirrors the chatInvitation subject template; only shown for the instant before
  // the real (server-resolved) subject lands.
  const subject = data?.subject || `We’d like to chat about your application — ${role}`;
  const landingUrl = `${slugify(company)}.example.com/careers/${slugify(role)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-charcoal/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        backdropArmed.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (backdropArmed.current && e.target === e.currentTarget) onClose();
        backdropArmed.current = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-label={isEmail ? "Realistic email preview" : "Realistic landing preview"}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        <div
          ref={panelRef}
          tabIndex={-1}
          className="flex h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl outline-none"
        >
          {/* ── Toolbar ─────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="font-mono text-[0.56rem] font-semibold uppercase tracking-[0.2em] text-ink-faint">
                Realistic preview
              </p>
              <p className="truncate text-[0.8rem] text-ink-soft">
                {isEmail
                  ? "How the invitation lands in an inbox"
                  : "How the apply page looks in a browser"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="inline-flex gap-0.5 rounded-lg border border-border bg-cream/60 p-0.5">
                {(["email", "landing"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSurface(s)}
                    className={surfaceToggleClass(surface === s)}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {!isEmail && (
                <div className="inline-flex gap-0.5 rounded-lg border border-border bg-cream/60 p-0.5">
                  {(["desktop", "mobile"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDevice(d)}
                      className={surfaceToggleClass(device === d)}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={openInNewTab}
                disabled={!html}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[0.72rem] font-medium text-ink-soft transition-colors hover:bg-cream disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6.5 3H3.4A1.4 1.4 0 0 0 2 4.4v6.2A1.4 1.4 0 0 0 3.4 12h6.2A1.4 1.4 0 0 0 11 10.6V7.5" />
                  <path d="M8.5 2H12v3.5M12 2 6.5 7.5" />
                </svg>
                New tab
              </button>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border text-ink-soft transition-colors hover:bg-cream cursor-pointer"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Stage ───────────────────────────────────────────── */}
          <div className="relative min-h-0 flex-1 overflow-auto bg-canvas">
            {isEmail ? (
              <EmailStage
                html={html}
                status={status}
                company={company}
                candidate={candidate}
                subject={subject}
                logoUrl={payload.logo_url}
                logoBackground={payload.logo_background}
              />
            ) : (
              <LandingStage
                html={html}
                status={status}
                device={device}
                url={landingUrl}
              />
            )}
          </div>

          {/* ── Caption ─────────────────────────────────────────── */}
          <div className="border-t border-border px-4 py-2 text-center">
            <p className="font-mono text-[0.56rem] uppercase tracking-[0.14em] text-ink-faint">
              Sample data · live from your theme
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The email at true size inside an inbox message header — brand-named From line,
 *  the real subject, the sample recipient. */
function EmailStage({
  html,
  status,
  company,
  candidate,
  subject,
  logoUrl,
  logoBackground,
}: {
  html: string | null;
  status: PreviewStatus;
  company: string;
  candidate: string;
  subject: string;
  logoUrl: string | null;
  logoBackground: string;
}) {
  return (
    <div className="mx-auto max-w-[760px] p-4 sm:p-8">
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border ${
              logoBackground === "dark" ? "bg-ink" : "bg-white"
            }`}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="max-h-7 max-w-7 object-contain"
              />
            ) : (
              <span className="font-serif text-base text-ink">
                {company.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.86rem] font-semibold text-ink">
              {subject}
            </p>
            <p className="truncate text-[0.72rem] text-ink-muted">
              {company} Careers&ensp;·&ensp;to {candidate}
            </p>
          </div>
          <span className="shrink-0 text-[0.68rem] text-ink-faint">9:41 AM</span>
        </div>
        <div className="relative bg-white" style={{ height: 680 }}>
          {html !== null && (
            <iframe
              srcDoc={html}
              sandbox="allow-same-origin"
              title="Email body preview"
              style={{ width: "100%", height: 680, border: 0 }}
            />
          )}
          <PreviewStatusOverlay
            status={status}
            errorText="Preview unavailable — check the palette values."
          />
        </div>
      </div>
    </div>
  );
}

/** The landing page in a browser window at its true device width, scaled to fit
 *  the stage. Desktop renders ≥880px wide so the two-column layout shows (the
 *  inline column can't); mobile renders the responsive collapse on purpose. */
function LandingStage({
  html,
  status,
  device,
  url,
}: {
  html: string | null;
  status: PreviewStatus;
  device: Device;
  url: string;
}) {
  const isMobile = device === "mobile";
  const contentWidth = isMobile ? MOBILE_W : DESKTOP_W;
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Available space inside the scroll stage, less the root's own p-4/sm:p-6
  // padding (48px on each axis at sm) so the frame fits without overflowing.
  const availW = Math.max(280, box.w - 48);
  const availH = Math.max(360, box.h - 48);
  // Mobile is a common phone canvas (iPhone-class 390×844) scaled to fit both
  // axes; desktop instead fills the height and scrolls inside the iframe at its
  // true desktop width.
  const mobileH = 844;
  const scaleW = availW / contentWidth;
  const scale = isMobile
    ? Math.min(1, scaleW, availH / (mobileH + CHROME_H))
    : Math.min(1, scaleW);
  const iframeH = isMobile
    ? mobileH
    : Math.max(480, availH / (scale || 1) - CHROME_H);
  const frameH = CHROME_H + iframeH;

  return (
    // Pinned to the (relative) stage with its OWN scroll, so the measured size is
    // fixed by the stage — not by the scaled frame inside it. Measuring a parent
    // whose height grew with its child caused a ResizeObserver feedback loop.
    <div
      ref={ref}
      className="absolute inset-0 flex items-start justify-center overflow-auto p-4 sm:p-6"
    >
      {/* Hold the first paint until the stage is measured, so the frame never
          flashes at the min-dimension fallback scale before snapping to size. */}
      {box.w === 0 ? null : (
        // The outer box claims the SCALED footprint so the transform never
        // overflows the scroll area; the inner frame is laid out full-size,
        // then visually scaled.
        <div style={{ width: contentWidth * scale, height: frameH * scale }}>
          <div
            style={{
              width: contentWidth,
              height: frameH,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
            className={`overflow-hidden border border-border bg-white shadow-xl ${
              isMobile ? "rounded-[2.25rem]" : "rounded-xl"
            }`}
          >
            <div
              className="flex items-center gap-2 border-b border-border bg-cream/70 px-3"
              style={{ height: CHROME_H }}
            >
              {!isMobile && (
                <span className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
                </span>
              )}
              <span className="mx-auto max-w-[80%] truncate rounded-md border border-border bg-white px-3 py-1 font-mono text-[0.62rem] text-ink-muted">
                {url}
              </span>
            </div>
            <div className="relative bg-white" style={{ height: iframeH }}>
              {html !== null && (
                // width is the TRUE device width (never scaled) so the page lays
                // out at desktop and doesn't trip its own max-width collapse; the
                // parent transform shrinks it visually to fit the stage.
                <iframe
                  srcDoc={html}
                  sandbox="allow-same-origin"
                  title="Landing preview"
                  style={{ width: contentWidth, height: iframeH, border: 0 }}
                />
              )}
              <PreviewStatusOverlay
                status={status}
                errorText="Preview unavailable — check the palette and pasted HTML."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
