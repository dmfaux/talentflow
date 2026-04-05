import { ApplicationForm } from "@/components/candidate/ApplicationForm";
import type { TemplateComponent } from "../types";
import {
  firstInitial,
  formatSalary,
  initialCircleStyle,
  joinMeta,
  logoWrapperStyle,
} from "./_shared";

const editorial: TemplateComponent = ({ client, campaign }) => {
  const primary = client.brand_primary_color || "#0b0f1c";
  const metaParts = joinMeta([campaign.department, campaign.location, campaign.employment_type]);
  const salary = formatSalary(campaign.salary_range_min, campaign.salary_range_max);
  const logoSize = 44;
  const alignRight = client.logo_position === "top-centre" ? "center" : "flex-start";

  // Subtle grid pattern as SVG data URL (ink lines at ~4% opacity, 32px grid).
  const gridPattern =
    "url(\"data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cpath d='M32 0H0v32' fill='none' stroke='%230b0f1c' stroke-opacity='0.04' stroke-width='1'/%3E%3C/svg%3E\")";

  const css = `
    .ts-ed-root {
      min-height: 100vh;
      background-color: #f3f0e8;
      background-image: ${gridPattern};
      background-size: 32px 32px;
      color: #0b0f1c;
      font-family: var(--font-instrument-sans), -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 2.5rem 1.25rem 3rem;
    }
    .ts-ed-shell {
      max-width: 720px;
      margin: 0 auto;
    }
    .ts-ed-logo-row {
      display: flex;
      justify-content: ${alignRight};
      margin-bottom: 3.5rem;
    }
    .ts-ed-logo-link {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: inherit;
    }
    .ts-ed-name {
      font-family: var(--font-instrument-sans), system-ui, sans-serif;
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(11, 15, 28, 0.62);
    }
    .ts-ed-title {
      font-family: var(--font-fraunces), Georgia, serif;
      font-style: italic;
      font-weight: 400;
      font-size: 3.5rem;
      line-height: 1.05;
      letter-spacing: -0.02em;
      color: ${primary};
      margin: 0 0 1.25rem;
    }
    .ts-ed-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem 0.875rem;
      font-family: var(--font-jetbrains-mono), monospace;
      font-size: 0.72rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(11, 15, 28, 0.55);
      margin: 0 0 1.5rem;
    }
    .ts-ed-meta-sep {
      color: rgba(11, 15, 28, 0.28);
    }
    .ts-ed-salary {
      display: inline-block;
      font-family: var(--font-jetbrains-mono), monospace;
      font-size: 0.82rem;
      color: #0b0f1c;
      padding: 0.375rem 0.75rem;
      background-color: rgba(11, 15, 28, 0.045);
      border-radius: 0.375rem;
      margin-bottom: 2rem;
    }
    .ts-ed-desc {
      font-family: var(--font-instrument-sans), system-ui, sans-serif;
      font-size: 1.05rem;
      line-height: 1.75;
      color: #1a2033;
      margin: 0 0 3rem;
      white-space: pre-wrap;
    }
    .ts-ed-desc-empty {
      font-style: italic;
      color: rgba(11, 15, 28, 0.55);
    }
    .ts-ed-card {
      background-color: #ffffff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 0.75rem;
      padding: 2.5rem;
      box-shadow: 0 12px 32px -16px rgba(11, 15, 28, 0.08);
    }
    .ts-ed-footer {
      margin-top: 2.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid rgba(11, 15, 28, 0.08);
      text-align: center;
      font-family: var(--font-jetbrains-mono), monospace;
      font-size: 0.7rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(11, 15, 28, 0.45);
    }
    @media (max-width: 768px) {
      .ts-ed-root { padding: 1.75rem 1rem 2.25rem; }
      .ts-ed-logo-row { margin-bottom: 2rem; }
      .ts-ed-title { font-size: 2.25rem; line-height: 1.1; }
      .ts-ed-desc { font-size: 1rem; line-height: 1.7; margin-bottom: 2rem; }
      .ts-ed-card { padding: 1.5rem; border-radius: 0.625rem; }
    }
  `;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="ts-ed-root">
        <div className="ts-ed-shell">
          <header className="ts-ed-logo-row">
            <div className="ts-ed-logo-link">
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
              <span className="ts-ed-name">{client.name}</span>
            </div>
          </header>

          <main>
            <h1 className="ts-ed-title">{campaign.role_title}</h1>

            {metaParts.length > 0 && (
              <div className="ts-ed-meta" aria-label="Role details">
                {metaParts.map((part, idx) => (
                  <span key={part + idx} style={{ display: "inline-flex", alignItems: "center", gap: "0.875rem" }}>
                    <span>{part}</span>
                    {idx < metaParts.length - 1 && <span className="ts-ed-meta-sep" aria-hidden>·</span>}
                  </span>
                ))}
              </div>
            )}

            {salary && <div className="ts-ed-salary">{salary}</div>}

            <section aria-labelledby="ts-ed-about">
              <h2
                id="ts-ed-about"
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
                About this role
              </h2>
              {campaign.role_description ? (
                <p className="ts-ed-desc">{campaign.role_description}</p>
              ) : (
                <p className="ts-ed-desc ts-ed-desc-empty">
                  Full role details will be shared with shortlisted candidates.
                </p>
              )}
            </section>

            <section aria-labelledby="ts-ed-apply" className="ts-ed-card">
              <h2
                id="ts-ed-apply"
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
            </section>
          </main>

          <footer className="ts-ed-footer">
            Powered by TalentStream · POPIA compliant
          </footer>
        </div>
      </div>
    </>
  );
};

export default editorial;
