import { ApplicationForm } from "@/components/candidate/ApplicationForm";
import type { TemplateComponent } from "../types";
import {
  contrastText,
  firstInitial,
  formatSalary,
  hexToRgba,
  initialCircleStyle,
  joinMeta,
  logoImageStyle,
  logoWrapperStyle,
} from "./_shared";

const modern: TemplateComponent = ({ client, campaign }) => {
  const primary = client.brand_primary_color || "#0b0f1c";
  const secondary = client.brand_secondary_color || primary;
  const accent = client.brand_accent_color || secondary;
  const infoText = contrastText(primary) === "#ffffff" ? "#ffffff" : "#0b0f1c";
  const infoTextSubtle = infoText === "#ffffff" ? "rgba(255,255,255,0.78)" : "rgba(11,15,28,0.7)";
  const infoTextFaint = infoText === "#ffffff" ? "rgba(255,255,255,0.55)" : "rgba(11,15,28,0.5)";
  const metaParts = joinMeta([campaign.department, campaign.location, campaign.employment_type]);
  const salary = formatSalary(campaign.salary_range_min, campaign.salary_range_max);
  const logoHeight = 72;
  const logoMaxWidth = 320;

  // Short teaser from role_description (first ~180 chars, word-aligned).
  const teaser = (() => {
    const d = campaign.role_description?.trim();
    if (!d) return null;
    if (d.length <= 200) return d;
    const cut = d.slice(0, 200);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > 140 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
  })();

  const css = `
    .ts-mod-root {
      min-height: 100vh;
      background-color: #f7f5ee;
      color: #0b0f1c;
      font-family: var(--font-instrument-sans), -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex;
      flex-direction: column;
    }
    .ts-mod-hero {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      min-height: 440px;
    }
    .ts-mod-info {
      background-color: ${primary};
      color: ${infoText};
      padding: 3rem 3rem 3.25rem;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1.5rem;
    }
    .ts-mod-brand-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      ${client.logo_position === "top-centre" ? "justify-content: center;" : ""}
    }
    .ts-mod-client-name {
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: ${infoTextSubtle};
    }
    .ts-mod-title {
      font-family: var(--font-fraunces), Georgia, serif;
      font-weight: 500;
      font-size: 3rem;
      line-height: 1.08;
      letter-spacing: -0.02em;
      color: ${infoText};
      margin: 0;
      max-width: 560px;
    }
    .ts-mod-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .ts-mod-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.3rem 0.75rem;
      border-radius: 999px;
      border: 1px solid ${hexToRgba(infoText, infoText === "#ffffff" ? 0.22 : 0.16)};
      background-color: ${hexToRgba(infoText, infoText === "#ffffff" ? 0.08 : 0.04)};
      font-size: 0.75rem;
      font-weight: 500;
      letter-spacing: 0.01em;
      color: ${infoText};
    }
    .ts-mod-pill--salary {
      font-family: var(--font-jetbrains-mono), monospace;
      font-size: 0.7rem;
      letter-spacing: 0.04em;
    }
    .ts-mod-teaser {
      font-size: 1rem;
      line-height: 1.65;
      color: ${infoTextSubtle};
      margin: 0;
      max-width: 540px;
    }
    .ts-mod-decor {
      position: relative;
      overflow: hidden;
      background-color: ${secondary};
    }
    .ts-mod-decor-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
    .ts-mod-body {
      max-width: 640px;
      margin: 0 auto;
      padding: 3.5rem 1.5rem 0;
    }
    .ts-mod-body h2 {
      font-family: var(--font-fraunces), Georgia, serif;
      font-weight: 500;
      font-size: 1.625rem;
      letter-spacing: -0.01em;
      color: #0b0f1c;
      margin: 0 0 1rem;
    }
    .ts-mod-body p {
      font-size: 1.02rem;
      line-height: 1.72;
      color: #1a2033;
      margin: 0;
      white-space: pre-wrap;
    }
    .ts-mod-body p.ts-mod-empty {
      font-style: italic;
      color: rgba(11, 15, 28, 0.55);
    }
    .ts-mod-apply-wrap {
      position: relative;
      margin-top: 4rem;
      padding-bottom: 4rem;
    }
    .ts-mod-apply-band {
      background-color: ${primary};
      height: 260px;
    }
    .ts-mod-apply-card {
      position: relative;
      max-width: 640px;
      margin: -220px auto 0;
      background-color: #ffffff;
      border-radius: 1rem;
      padding: 2.5rem;
      box-shadow: 0 24px 48px -20px rgba(11, 15, 28, 0.15);
    }
    .ts-mod-footer {
      padding: 1.75rem 1.5rem;
      text-align: center;
      font-size: 0.78rem;
      color: rgba(11, 15, 28, 0.5);
      letter-spacing: 0.02em;
    }
    @media (max-width: 768px) {
      .ts-mod-hero {
        grid-template-columns: 1fr;
        min-height: 0;
      }
      .ts-mod-info { padding: 2.25rem 1.25rem 2rem; gap: 1.125rem; }
      .ts-mod-title { font-size: 2.125rem; line-height: 1.12; }
      .ts-mod-teaser { font-size: 0.95rem; line-height: 1.6; }
      .ts-mod-decor { order: 2; height: 200px; }
      .ts-mod-body { padding: 2.5rem 1.25rem 0; }
      .ts-mod-body h2 { font-size: 1.375rem; }
      .ts-mod-body p { font-size: 0.975rem; line-height: 1.7; }
      .ts-mod-apply-wrap { margin-top: 3rem; padding-bottom: 2.5rem; }
      .ts-mod-apply-band { height: 220px; }
      .ts-mod-apply-card { margin: -180px 1rem 0; padding: 1.75rem; border-radius: 0.75rem; }
    }
  `;

  // Geometric SVG decoration — overlapping circles + diagonal bar using the
  // client's brand palette. Kept tasteful: soft opacities, no harsh edges.
  const decor = (
    <svg
      className="ts-mod-decor-svg"
      viewBox="0 0 400 440"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="tsModGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={secondary} />
          <stop offset="1" stopColor={accent} />
        </linearGradient>
      </defs>
      <rect width="400" height="440" fill="url(#tsModGrad)" />
      {/* Large offset circle (primary tint) */}
      <circle cx="300" cy="110" r="160" fill={primary} opacity="0.22" />
      {/* Medium circle (white/neutral tint) */}
      <circle cx="120" cy="320" r="120" fill="#ffffff" opacity="0.16" />
      {/* Small accent circle */}
      <circle cx="230" cy="260" r="60" fill={accent} opacity="0.55" />
      {/* Diagonal bar */}
      <g transform="translate(200 220) rotate(-28)">
        <rect
          x="-260"
          y="-10"
          width="520"
          height="20"
          rx="10"
          fill={primary}
          opacity="0.32"
        />
      </g>
      {/* Fine stroke ring for detail */}
      <circle
        cx="300"
        cy="110"
        r="160"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.22"
        strokeWidth="1"
      />
    </svg>
  );

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="ts-mod-root">
        <header className="ts-mod-hero">
          <div className="ts-mod-info">
            <div className="ts-mod-brand-row">
              {client.logo_url ? (
                <span style={logoWrapperStyle(client.logo_background, logoHeight, logoMaxWidth)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={client.logo_url} alt={`${client.name} logo`} style={logoImageStyle()} />
                </span>
              ) : (
                <span style={initialCircleStyle(primary, logoHeight)}>{firstInitial(client.name)}</span>
              )}
              <span className="ts-mod-client-name">{client.name}</span>
            </div>

            <h1 className="ts-mod-title">{campaign.role_title}</h1>

            {(metaParts.length > 0 || salary) && (
              <div className="ts-mod-meta" aria-label="Role details">
                {metaParts.map((part) => (
                  <span key={part} className="ts-mod-pill">{part}</span>
                ))}
                {salary && <span className="ts-mod-pill ts-mod-pill--salary">{salary}</span>}
              </div>
            )}

            {teaser && <p className="ts-mod-teaser">{teaser}</p>}
            {!teaser && (
              <p className="ts-mod-teaser" style={{ color: infoTextFaint }}>
                Read the full role details below.
              </p>
            )}
          </div>
          <div className="ts-mod-decor">{decor}</div>
        </header>

        <section className="ts-mod-body" aria-labelledby="ts-mod-about">
          <h2 id="ts-mod-about">About this role</h2>
          {campaign.role_description ? (
            <p>{campaign.role_description}</p>
          ) : (
            <p className="ts-mod-empty">
              We&apos;ll share full details with candidates who progress to the next stage.
            </p>
          )}
        </section>

        <section className="ts-mod-apply-wrap" aria-labelledby="ts-mod-apply">
          <div className="ts-mod-apply-band" />
          <div className="ts-mod-apply-card">
            <h2
              id="ts-mod-apply"
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                padding: 0,
                margin: "-1px",
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                whiteSpace: "nowrap",
                borderWidth: 0,
              }}
            >
              Apply for this role
            </h2>
            <ApplicationForm
              clientSlug={client.slug}
              clientName={client.name}
              campaign={{
                slug: campaign.slug,
                role_title: campaign.role_title,
                gating_config: campaign.gating_config,
              }}
              brandColours={{
                primary: client.brand_primary_color,
                secondary: client.brand_secondary_color,
                accent: client.brand_accent_color,
                text: client.brand_text_color,
              }}
            />
          </div>
        </section>

        <footer className="ts-mod-footer">Powered by TalentStream · POPIA compliant</footer>
      </div>
    </>
  );
};

export default modern;
