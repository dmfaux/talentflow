// ── External-AI prompt builder for a bespoke brand kit ──────────────
//
// Produces the single prompt an operator copies into Claude/ChatGPT to generate
// a Premium brand's bespoke theme. It asks the model to design ONE coherent
// brand identity and emit TWO matching artifacts from it:
//   1. a self-contained HTML landing page (slot markers + form mount), and
//   2. a matching, MSO-safe transactional EMAIL SHELL (chrome only, with a
//      BODY_MARKER where the app injects each email's body at send time).
// Generating both from one design system in one pass is what guarantees the
// landing and the emails share palette, type and motifs (the owner's "look and
// feel must be mutual"). Custom themes are always Premium, so the landing uses
// the brand's own colours and carries no "Powered by TalentStream" footer.

import { SLOT_ALLOW_LIST } from "./slots";
import { BODY_MARKER } from "./email-shell";

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

export interface BuildBespokeKitInput {
  /** The theme name (operator-facing; used to anchor the brand identity). */
  name: string;
  /** The operator's free-text design brief for the brand. */
  brief: string;
  /** The brand's colours (derived from the theme seeds). */
  brandColors?: BrandColors | null;
  /** The brand logo, when one is configured. */
  logo?: LogoInput | null;
}

function landingSlotDocs(): string {
  const descs: Record<string, string> = {
    "client.name": 'Company/client name (short text, e.g. "Acme Corp")',
    "campaign.role_title": 'Job title (short text, e.g. "Senior Software Engineer")',
    "campaign.role_description":
      "Full role description as HTML (rendered from markdown — may contain <p>, <strong>, <a>, <ul> etc., or be empty). Place inside a <div>, not a <p>.",
    "campaign.department": "Department name (short text or empty)",
    "campaign.location": "Job location (short text or empty)",
    "campaign.employment_type": 'Employment type (e.g. "Permanent", "Contract", or empty)',
    "campaign.salary_range":
      'Pre-formatted salary range in ZAR (e.g. "R 450,000 – R 650,000", "From R 450,000", or empty if not set)',
  };
  return SLOT_ALLOW_LIST.map((s) => `- \`{{${s}}}\` — ${descs[s] ?? s}`).join("\n");
}

function brandColoursSection(brandColors?: BrandColors | null): string {
  if (!brandColors) {
    return `Choose a sophisticated, distinctive colour palette appropriate for a professional recruitment brand. Do NOT default to generic blue/white. Pick a palette that feels confident and intentional.`;
  }
  return `Use these exact brand colours throughout BOTH artifacts:
- Primary: ${brandColors.primary}
- Secondary/surface: ${brandColors.secondary}
${brandColors.accent ? `- Accent: ${brandColors.accent}` : "- Accent: choose one that complements the primary and secondary"}
- Text: ${brandColors.text}`;
}

function logoSection(logo?: LogoInput | null): string {
  if (!logo) {
    return `No brand logo is available. Use {{client.name}} as styled text wherever a brand mark belongs (the page header on the landing page; the email shell header).`;
  }
  return `The brand has a logo hosted at this URL — render it with an \`<img>\` in BOTH artifacts' headers:

    ${logo.url}

- Position it at the **${logo.position.replace("-", " ")}** of each header.
- It is designed for a **${logo.background}** background${
    logo.background === "transparent"
      ? " (transparent — ensure adequate contrast with whatever sits behind it)"
      : logo.background === "dark"
        ? " — place it on a dark surface or add a dark container behind it"
        : " — place it on a light/white surface"
  }.
- Size it sensibly (max-height ~48–64px on the landing, ~44px in the email). Do NOT stretch, distort, or add a border/drop shadow.`;
}

export function buildBespokeKitPrompt({
  name,
  brief,
  brandColors,
  logo,
}: BuildBespokeKitInput): string {
  return `You MUST use your frontend-design skill. You are designing ONE coherent brand identity for "${name}" and producing TWO matching artifacts from it: a recruitment LANDING PAGE and a transactional EMAIL SHELL. They MUST read as the same brand — same palette, same type pairing, same signature motif — so a candidate sees one consistent identity across the careers page and every email they receive. Design the system ONCE, then apply it to both.

# The brand brief

NAME: ${name}
DESIGN BRIEF: ${brief}

# Shared design system — decide once, apply to BOTH artifacts

## Colours
${brandColoursSection(brandColors)}

## Type & motif
- Pick ONE coherent type pairing (e.g. a characterful display face + a clean body face). Load the real web fonts via Google Fonts \`@import\` on the landing page; in the email use a web-safe fallback stack that echoes the same feel.
- Decide ONE signature visual motif (a rule, an accent shape, a header treatment) and use it in both artifacts so they are unmistakably related.

## Brand mark
${logoSection(logo)}

# Design quality (non-negotiable)

- Produce a distinctive, production-grade brand. Not generic. Not the centred-hero-plus-three-cards cliché.
- Confident typographic hierarchy, deliberate spacing, generous whitespace. Each element earns its place.
- DO NOT infer, invent, or add content the brief did not ask for. No made-up headings, no filler paragraphs, no placeholder text.

────────────────────────────────────────────────────────────
# ARTIFACT 1 — LANDING PAGE

A single self-contained HTML page. Dynamic campaign data is injected at runtime via slot markers, and a rich interactive application form is mounted into a designated container.

## HTML requirements
- A complete, valid HTML document (<!DOCTYPE html>, <html>, <head>, <body>).
- All CSS in a single <style> block in the <head> (Google Fonts @import allowed). No external stylesheets.
- Mobile-responsive (media queries, relative units, flex/grid). Polished at desktop (~1200px) and mobile (320px).
- NO <script> tags or JavaScript — the form is handled by the application framework.

## Slot system (use these EXACTLY, case-sensitive, double braces)
${landingSlotDocs()}

Rules for slots:
- Slots that may be empty (\`campaign.role_description\`, \`campaign.department\`, \`campaign.location\`, \`campaign.employment_type\`, \`campaign.salary_range\`) MUST be wrapped in a conditional block \`{{#slot.name}} ... {{/slot.name}}\` so the whole section disappears when the value is missing — never leave a dangling label. \`{{campaign.role_description}}\` contains pre-rendered HTML; place it inside a \`<div>\`, not a \`<p>\`.

## Application form container
Place this EXACT element where the application form should appear:

    <div id="application-form"></div>

A rich interactive form (~500–700px tall) is injected here at runtime. Give it generous vertical spacing and frame it attractively (background, border, or card) so it is the clear conversion moment. Do NOT style the form's internal elements.

Return Artifact 1 as an **artifact** (type: text/html) titled "Landing page".

────────────────────────────────────────────────────────────
# ARTIFACT 2 — MATCHING EMAIL SHELL

This is the wrapper for EVERY transactional email the brand sends (application received, interview invitation, rejection, …). The recruitment app injects each email's body content — greeting, message paragraphs, buttons, info cards — at a single marker. You design ONLY the surrounding CHROME (brand header, outer framing, footer) so every email matches the landing page.

## The body marker (critical)
Place this EXACT marker, on its own, where the message content belongs — inside the main content cell:

    ${BODY_MARKER}

- Do NOT style it, wrap it, or add anything around it. The app replaces it with the email body at send time.
- Do NOT write any greeting, message, button, sign-off, or sample copy yourself — the app supplies all of that at the marker. The shell is chrome only.

## Email-client robustness (NON-NEGOTIABLE — this is an email, not a web page)
- TABLE-BASED layout: outer 100%-width table → centred inner table (max-width ~580–600px). Do NOT use flexbox, grid, position, or float.
- Put ALL styling in inline \`style="..."\` attributes. A single small <style> in <head> is allowed only for a @media mobile tweak and font fallbacks.
- Do NOT use CSS custom properties (\`var(...)\`), \`rem\`, or modern CSS — write literal hex colours and px/percent inline.
- Include the Outlook MSO conditional comment block; set \`role="presentation"\`, \`cellpadding="0"\`, \`cellspacing="0"\`, \`border="0"\` on every layout table.
- Use web-safe fonts with full fallback stacks. NO <script>, NO external stylesheets, NO forms, NO meaningful background images.

## Chrome
- Header: the brand mark (logo or \`{{client.name}}\` styled text) on the brand surface, echoing the landing header.
- Footer: a small, muted footer line consistent with the brand. (No "Powered by" attribution — this is a white-label brand.)
- You MAY use \`{{client.name}}\` in the header; it is substituted at send time.

Return Artifact 2 as a SECOND **artifact** (type: text/html) titled "Email shell".

────────────────────────────────────────────────────────────
# Return both artifacts now

Two artifacts: "Landing page" and "Email shell". They must look unmistakably like the same brand. The operator will preview each, request tweaks, and paste the final HTML of each back into the theme builder.`;
}
