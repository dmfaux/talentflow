import { ApplicationForm } from "@/components/candidate/ApplicationForm";
import type { TemplateComponent } from "../types";
import {
  contrastText,
  firstInitial,
  formatSalary,
  hexToRgba,
  initialCircleStyle,
  joinMeta,
  logoWrapperStyle,
} from "./_shared";

const corporate: TemplateComponent = ({ client, campaign }) => {
  const primary = client.brand_primary_color || "#0b0f1c";
  const accent = client.brand_accent_color || primary;
  const heroText = contrastText(primary);
  const heroSubtle = heroText === "#ffffff" ? "rgba(255,255,255,0.72)" : "rgba(11,15,28,0.62)";
  const metaParts = joinMeta([campaign.department, campaign.location, campaign.employment_type]);
  const salary = formatSalary(campaign.salary_range_min, campaign.salary_range_max);
  const logoSize = 60;
  const alignHeader = client.logo_position === "top-centre" ? "center" : "flex-start";

  const benefits = [
    {
      title: "Established, stable employer",
      body: "Join a team with deep roots and a record of looking after its people.",
    },
    {
      title: "Clear progression",
      body: "Structured development paths and regular feedback to help you grow.",
    },
    {
      title: "Competitive package",
      body: "Market-aligned compensation with comprehensive benefits.",
    },
  ];

  const css = `
    .ts-corp-root {
      min-height: 100vh;
      background-color: #ffffff;
      color: #0b0f1c;
      font-family: var(--font-instrument-sans), -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .ts-corp-hero {
      background-color: ${primary};
      color: ${heroText};
      padding: 3rem 1.5rem 3.25rem;
    }
    .ts-corp-hero-shell {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: ${alignHeader};
      gap: 1.5rem;
    }
    .ts-corp-brand-row {
      display: flex;
      align-items: center;
      gap: 0.9rem;
    }
    .ts-corp-client-name {
      font-size: 0.9rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: ${heroText};
    }
    .ts-corp-eyebrow {
      font-family: var(--font-jetbrains-mono), monospace;
      font-size: 0.7rem;
      font-weight: 500;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: ${heroSubtle};
      margin: 0;
    }
    .ts-corp-title {
      font-family: var(--font-fraunces), Georgia, serif;
      font-weight: 500;
      font-size: 2.75rem;
      line-height: 1.12;
      letter-spacing: -0.015em;
      color: ${heroText};
      margin: 0;
      max-width: 820px;
      text-align: ${alignHeader === "center" ? "center" : "left"};
    }
    .ts-corp-meta {
      max-width: 960px;
      margin: 0 auto;
      padding: 1.5rem 1.5rem 0;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .ts-corp-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.375rem 0.875rem;
      border-radius: 999px;
      border: 1px solid rgba(11, 15, 28, 0.16);
      background-color: rgba(11, 15, 28, 0.02);
      font-size: 0.78rem;
      font-weight: 500;
      letter-spacing: 0.01em;
      color: #1a2033;
    }
    .ts-corp-pill--salary {
      font-family: var(--font-jetbrains-mono), monospace;
      font-size: 0.72rem;
      letter-spacing: 0.04em;
      background-color: ${hexToRgba(primary, 0.06)};
      border-color: ${hexToRgba(primary, 0.22)};
      color: #0b0f1c;
    }
    .ts-corp-section {
      max-width: 720px;
      margin: 0 auto;
      padding: 3rem 1.5rem 0;
    }
    .ts-corp-section h2 {
      font-family: var(--font-fraunces), Georgia, serif;
      font-weight: 500;
      font-size: 1.625rem;
      letter-spacing: -0.01em;
      color: #0b0f1c;
      margin: 0 0 1rem;
    }
    .ts-corp-section p {
      font-size: 1rem;
      line-height: 1.7;
      color: #1a2033;
      margin: 0;
      white-space: pre-wrap;
    }
    .ts-corp-section p.ts-corp-empty {
      font-style: italic;
      color: rgba(11, 15, 28, 0.55);
    }
    .ts-corp-why-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1.5rem;
    }
    .ts-corp-why-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1.25rem;
      border: 1px solid rgba(11, 15, 28, 0.1);
      border-radius: 0.625rem;
      background-color: #ffffff;
    }
    .ts-corp-why-icon {
      width: 28px;
      height: 28px;
      border-radius: 0.375rem;
      background-color: ${hexToRgba(primary, 0.08)};
      color: ${primary};
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .ts-corp-why-title {
      font-size: 0.92rem;
      font-weight: 600;
      color: #0b0f1c;
      letter-spacing: -0.005em;
    }
    .ts-corp-why-body {
      font-size: 0.85rem;
      line-height: 1.55;
      color: #58607a;
    }
    .ts-corp-sep {
      height: 4px;
      background-color: ${accent};
      margin: 3.5rem 0 0;
    }
    .ts-corp-apply-wrap {
      background-color: #f7f5ee;
      padding: 3rem 1.5rem 4rem;
    }
    .ts-corp-apply-shell {
      max-width: 640px;
      margin: 0 auto;
    }
    .ts-corp-apply-heading {
      font-family: var(--font-fraunces), Georgia, serif;
      font-weight: 500;
      font-size: 1.875rem;
      letter-spacing: -0.01em;
      color: #0b0f1c;
      margin: 0 0 0.5rem;
    }
    .ts-corp-apply-sub {
      font-size: 0.92rem;
      color: #58607a;
      margin: 0 0 2rem;
      line-height: 1.6;
    }
    .ts-corp-apply-container {
      background-color: #ffffff;
      border: 1px solid rgba(11, 15, 28, 0.1);
      border-radius: 0.625rem;
      padding: 2rem;
    }
    .ts-corp-footer {
      padding: 2rem 1.5rem;
      text-align: center;
      border-top: 1px solid rgba(11, 15, 28, 0.08);
      background-color: #ffffff;
    }
    .ts-corp-footer-text {
      font-size: 0.78rem;
      color: rgba(11, 15, 28, 0.55);
      letter-spacing: 0.02em;
      margin: 0;
    }
    @media (max-width: 768px) {
      .ts-corp-hero { padding: 2.25rem 1rem 2.25rem; }
      .ts-corp-title { font-size: 2rem; }
      .ts-corp-meta { padding: 1rem 1rem 0; }
      .ts-corp-section { padding: 2.25rem 1rem 0; }
      .ts-corp-section h2 { font-size: 1.375rem; }
      .ts-corp-why-list { grid-template-columns: 1fr; gap: 0.875rem; }
      .ts-corp-sep { margin-top: 2.5rem; }
      .ts-corp-apply-wrap { padding: 2.25rem 1rem 3rem; }
      .ts-corp-apply-heading { font-size: 1.5rem; }
      .ts-corp-apply-container { padding: 1.5rem; }
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="ts-corp-root">
        <header className="ts-corp-hero">
          <div className="ts-corp-hero-shell">
            <div className="ts-corp-brand-row">
              {client.logo_url ? (
                <span style={logoWrapperStyle(client.logo_background, logoSize)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={client.logo_url}
                    alt={`${client.name} logo`}
                    width={logoSize}
                    height={logoSize}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  />
                </span>
              ) : (
                <span style={initialCircleStyle(primary, logoSize)}>{firstInitial(client.name)}</span>
              )}
              <span className="ts-corp-client-name">{client.name}</span>
            </div>
            <p className="ts-corp-eyebrow">Now hiring</p>
            <h1 className="ts-corp-title">{campaign.role_title}</h1>
          </div>
        </header>

        {(metaParts.length > 0 || salary) && (
          <div className="ts-corp-meta" aria-label="Role details">
            {metaParts.map((part) => (
              <span key={part} className="ts-corp-pill">{part}</span>
            ))}
            {salary && <span className="ts-corp-pill ts-corp-pill--salary">{salary}</span>}
          </div>
        )}

        <section className="ts-corp-section" aria-labelledby="ts-corp-about">
          <h2 id="ts-corp-about">About the role</h2>
          {campaign.role_description ? (
            <p>{campaign.role_description}</p>
          ) : (
            <p className="ts-corp-empty">
              We&apos;ll share a full role brief with candidates who progress to the next stage.
            </p>
          )}
        </section>

        <section className="ts-corp-section" aria-labelledby="ts-corp-why">
          <h2 id="ts-corp-why">Why work here</h2>
          <ul className="ts-corp-why-list">
            {benefits.map((b) => (
              <li key={b.title} className="ts-corp-why-item">
                <span className="ts-corp-why-icon" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2.5 7.5l2.5 2.5 6.5-6.5" />
                  </svg>
                </span>
                <span className="ts-corp-why-title">{b.title}</span>
                <span className="ts-corp-why-body">{b.body}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="ts-corp-sep" role="presentation" />

        <section className="ts-corp-apply-wrap" aria-labelledby="ts-corp-apply">
          <div className="ts-corp-apply-shell">
            <h2 id="ts-corp-apply" className="ts-corp-apply-heading">Apply for this role</h2>
            <p className="ts-corp-apply-sub">
              Complete the form below — it takes about five minutes. We&apos;ll be in touch soon.
            </p>
            <div className="ts-corp-apply-container">
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
          </div>
        </section>

        <footer className="ts-corp-footer">
          <p className="ts-corp-footer-text">Powered by TalentStream · POPIA compliant</p>
        </footer>
      </div>
    </>
  );
};

export default corporate;
