// ── External-AI prompt builder for HTML templates ──────────────────
//
// Produces the prompt a user copies into ChatGPT/Claude/etc. to
// generate a self-contained HTML landing page template. The prompt
// embeds:
//   1. Design-quality directives (frontend-design principles).
//   2. Hard gating rules (no inferred content, no markdown wrapping).
//   3. HTML requirements (inline CSS, no JS, responsive).
//   4. The slot system specification (mustache markers + form div).
//   5. Brand color guidance (fixed for shared, exact hex for bespoke).
//   6. User inputs (name + brief) verbatim.

import { SLOT_ALLOW_LIST } from "./slots";
import { isPremiumTier } from "./theme-fields";

export interface BrandColors {
  primary: string;
  secondary: string;
  accent: string | null;
  text: string;
}

export interface LogoInput {
  url: string;
  background: string;
  position: string;
}

export interface BuildPromptInput {
  name: string;
  brief: string;
  brandColors?: BrandColors | null;
  logo?: LogoInput | null;
  /**
   * The brand's tier (CT4). Standard/null campaigns are white-label-free: the
   * landing uses the shared TalentStream palette + the "Powered by TalentStream"
   * footer, matching their emails. Premium+ campaigns use the brand's own colours
   * and drop the powered-by footer — coherent with the email kit's showPoweredBy.
   */
  tier?: string | null;
}

/**
 * The TalentStream palette mapped to the prompt's BrandColors shape — the
 * DEFAULT_EMAIL_THEME hexes (theme.ts). Standard/null campaigns embed THIS rather
 * than the brand's colours, so the landing matches the (also-default-themed)
 * emails a Standard brand sends.
 */
export const TALENTSTREAM_PROMPT_PALETTE: BrandColors = {
  primary: "#2c5bff",
  secondary: "#f0f3f7",
  accent: "#05dbd6",
  text: "#11123c",
};

export function buildTemplatePrompt({
  name,
  brief,
  brandColors,
  logo,
  tier,
}: BuildPromptInput): string {
  // Tier lever (CT4) — single-sourced here so callers just pass the tier.
  // Premium+ is the white-label tier: brand colours, no powered-by footer.
  // Standard/null gets the shared TalentStream palette + the powered-by footer.
  const isPremium = isPremiumTier(tier);
  const paletteColors = isPremium ? brandColors : TALENTSTREAM_PROMPT_PALETTE;
  const slotDocs = SLOT_ALLOW_LIST.map((s) => {
    const descs: Record<string, string> = {
      "client.name": "Company/client name (short text, e.g. \"Acme Corp\")",
      "campaign.role_title": "Job title (short text, e.g. \"Senior Software Engineer\")",
      "campaign.role_description": "Full role description as HTML (rendered from markdown — may contain <p>, <strong>, <a>, <ul> etc., or be empty). Place inside a <div>, not a <p>.",
      "campaign.department": "Department name (short text or empty)",
      "campaign.location": "Job location (short text or empty)",
      "campaign.employment_type": "Employment type (e.g. \"Permanent\", \"Contract\", or empty)",
      "campaign.salary_range": "Pre-formatted salary range in ZAR (e.g. \"R 450,000 – R 650,000\", \"From R 450,000\", or empty if not set)",
    };
    return `- \`{{${s}}}\` — ${descs[s] ?? s}`;
  }).join("\n");

  const brandSection = paletteColors
    ? `Use these exact brand colours throughout the template:
- Primary: ${paletteColors.primary}
- Secondary: ${paletteColors.secondary}
${paletteColors.accent ? `- Accent: ${paletteColors.accent}` : "- Accent: choose one that complements the primary and secondary"}
- Text: ${paletteColors.text}`
    : `Choose a sophisticated, distinctive colour palette appropriate for a professional recruitment page. Do NOT default to generic blue/white. Pick a palette that feels confident and intentional.`;

  // The powered-by footer is the white-label lever (D-4): present for
  // Standard/null, dropped for Premium+.
  const footerSection = isPremium
    ? ""
    : `# Footer

Include a subtle footer at the very bottom of the page with the text "Powered by TalentStream". Style it small, muted, and unobtrusive — it should not compete with the page content. Centre-align it with generous top margin.

`;

  return `You MUST use your frontend-design skill to complete this task. You are producing a campaign landing-page template as a single self-contained HTML page. The template renders a job-application page: dynamic campaign data (role title, department, location, etc.) is injected at runtime via slot markers, and a rich interactive application form is mounted into a designated container element by the application framework.

# Design quality (non-negotiable)

- Produce a distinctive, production-grade composition. Not generic. Not the centred-hero-plus-three-cards cliché. Not a wall of identical cards.
- Confident typographic hierarchy. Deliberate spacing. Each element should earn its place.
- Use web-safe or widely available Google Fonts loaded via @import in the <style> block. Pick a coherent type pairing (serif + sans, or a single family with weight contrast).
- Asymmetry, left-aligned typography, and generous whitespace are welcome. Overused gradients, drop shadows everywhere, and emoji are not.
- The application form container is the conversion moment — frame it with intent. Give it visual prominence and breathing room.

# Hard rules (obey exactly)

- DO NOT infer, invent, or add any content the user did not ask for. No made-up headings, no filler paragraphs, no "About the role" sections unless the brief specifically requests them.
- DO NOT insert example or placeholder text. Use the slot markers for dynamic content and the user's exact words from the brief for any static content.
- Return the HTML page as an **artifact** (type: text/html) so it renders as a live preview. This lets the user see the design and request changes inline before copying the final HTML.

# HTML requirements

- The output must be a complete, valid HTML document (<!DOCTYPE html>, <html>, <head>, <body>).
- All CSS must be in a single <style> block in the <head>. No inline style attributes unless truly necessary for a one-off override.
- The page must be mobile-responsive (use media queries, relative units, flexbox/grid).
- DO NOT include any <script> tags or JavaScript. The form is handled by the application framework.
- DO NOT use external stylesheets (except Google Fonts @import which is allowed).
- The page should look polished at both desktop (max ~1200px) and mobile (320px) widths.

# Slot system

The template uses mustache-style slot markers that are replaced with real data at runtime. Use these exactly as shown (case-sensitive, including the double braces):

${slotDocs}

Rules for slots:
- Place slots directly in the HTML where the text should appear (e.g. \`<h1>{{campaign.role_title}}</h1>\`).
- Slots that may be empty (\`campaign.role_description\`, \`campaign.department\`, \`campaign.location\`, \`campaign.employment_type\`, \`campaign.salary_range\`) MUST use conditional blocks so the entire section (label + value) is removed when the data is missing. Wrap optional sections with \`{{#slot.name}} ... {{/slot.name}}\` — the block is stripped entirely when the slot is empty. Example:
  \`\`\`html
  {{#campaign.salary_range}}<div class="salary"><strong>Salary:</strong> {{campaign.salary_range}}</div>{{/campaign.salary_range}}
  {{#campaign.department}}<span class="dept">{{campaign.department}}</span>{{/campaign.department}}
  \`\`\`
  Do NOT rely on CSS \`:empty\` to hide these — use the conditional block syntax instead. Never leave a visible heading or label next to a blank value.
- You may combine slots with static text (e.g. \`<span>{{campaign.department}} · {{campaign.location}}</span>\`).
- \`{{campaign.role_description}}\` contains pre-rendered HTML (paragraphs, lists, bold, etc.). Place it inside a container element like \`<div class="description">{{campaign.role_description}}</div>\` — do NOT wrap it in a \`<p>\` tag.

# Application form container

Place this exact element where the application form should appear:

    <div id="application-form"></div>

At runtime, a rich interactive form will be injected into this container by the application. The form includes:
- Text fields (name, email, phone)
- Dropdown screening questions (varies per campaign)
- File upload for CV/resume
- Checkboxes (WhatsApp opt-in, POPIA consent)
- Submit button with loading state and inline validation

The injected form has its own internal styling and is approximately 500–700px tall depending on the number of questions. Your template should:
- Give the form container generous vertical spacing (at least 2rem padding above and below).
- Optionally add a heading above it (e.g. "Apply for this role" or similar if the brief suggests one).
- Style the container area to frame the form attractively (a subtle background, border, or card treatment works well).
- The form has its own styled inputs, selects, checkboxes, and buttons. Do NOT try to override its internal elements — but DO ensure the container area's background, padding, and border provide a cohesive frame that matches your template's design language.

${footerSection}# Colours

${brandSection}

# Company logo
${logo
    ? `The client has a logo hosted at this URL — include it in the page using an \`<img>\` tag:

    ${logo.url}

- Position the logo at the **${logo.position.replace("-", " ")}** of the header/hero area.
- The logo works best on a **${logo.background}** background${logo.background === "transparent" ? " (it has transparency, so ensure adequate contrast with whatever is behind it)" : logo.background === "dark" ? " — place it on a dark surface or add a dark container behind it" : " — place it on a light/white surface"}.
- Size the logo sensibly (max-height ~48–64px for desktop, smaller on mobile). Do NOT stretch or distort it.
- Do NOT add a border or drop shadow to the logo unless the brief requests it.`
    : "No client logo is available. Use {{client.name}} as text instead of an image logo."}

# User input

TEMPLATE NAME: ${name}
DESIGN BRIEF: ${brief}

Return the complete HTML page as an artifact now. The user will preview it, request tweaks, and copy the final version when satisfied.`;
}
