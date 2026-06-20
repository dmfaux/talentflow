// ── External-AI prompt builder for bespoke EMAIL templates (CT6) ─────
//
// The email analogue of prompt-builder.ts. Emails are not landing pages:
// they must survive Outlook/Gmail, so the prompt forces table-based,
// inline-styled, MSO-safe HTML (no flexbox/grid, no CSS custom properties,
// no <script>) rather than the modern free-form CSS the landing prompt
// invites. It is PER-TEMPLATE: the prompt embeds that template's purpose,
// tone, slot contract, and required action link from EMAIL_SLOT_SPECS.

import {
  type BrandColors,
  type LogoInput,
  TALENTSTREAM_PROMPT_PALETTE,
} from "./prompt-builder";
import {
  EMAIL_SLOT_DESCRIPTIONS,
  EMAIL_SLOT_SPECS,
  type EmailSlotName,
  type EmailTemplateType,
} from "./email-slots";
import { isPremiumTier } from "./theme-fields";

export interface BuildEmailPromptInput {
  type: EmailTemplateType;
  /** Brand voice / style notes the operator wants honoured (optional). */
  brief?: string | null;
  brandColors?: BrandColors | null;
  logo?: LogoInput | null;
  /** Brand tier — Premium+ uses brand colours and drops the powered-by footer. */
  tier?: string | null;
}

function slotDoc(name: EmailSlotName, required: boolean): string {
  return `- \`{{${name}}}\`${required ? " **(required)**" : ""} — ${EMAIL_SLOT_DESCRIPTIONS[name]}`;
}

export function buildEmailTemplatePrompt({
  type,
  brief,
  brandColors,
  logo,
  tier,
}: BuildEmailPromptInput): string {
  const spec = EMAIL_SLOT_SPECS[type];
  const isPremium = isPremiumTier(tier);
  const paletteColors = isPremium ? brandColors : TALENTSTREAM_PROMPT_PALETTE;

  const requiredSet = new Set<EmailSlotName>(spec.required);
  const slotDocs = spec.allowed
    .map((s) => slotDoc(s, requiredSet.has(s)))
    .join("\n");

  const optionalSlots = spec.allowed.filter((s) => !requiredSet.has(s));
  const conditionalNote = optionalSlots.length
    ? `Some slots may be empty (${optionalSlots
        .map((s) => `\`{{${s}}}\``)
        .join(
          ", "
        )}). Wrap any sentence or element that depends on a possibly-empty slot in a conditional block \`{{#slot.name}} ... {{/slot.name}}\` so it disappears entirely when the value is absent — never leave a dangling label or empty quotation.`
    : "";

  const requiredNote = spec.required.length
    ? `\n\n# Required action link\n\nThis email MUST contain ${spec.required
        .map((s) => `\`{{${s}}}\``)
        .join(
          " and "
        )} inside the href of a clear, prominent button (and ideally also as a plain-text fallback link below it). Without it the candidate cannot continue and the email is rejected. Build the button as a bulletproof table-based button (a \`<table>\` with a background-colour \`<td>\` wrapping an \`<a>\`), NOT a CSS-styled \`<div>\`.`
    : "";

  const brandSection = paletteColors
    ? `Use these exact brand colours throughout:
- Primary: ${paletteColors.primary}
- Secondary/surface: ${paletteColors.secondary}
${paletteColors.accent ? `- Accent: ${paletteColors.accent}` : "- Accent: choose one that complements the primary and secondary"}
- Text: ${paletteColors.text}`
    : `Choose a confident, professional colour palette. Do NOT default to generic blue/white.`;

  const footerSection = isPremium
    ? ""
    : `# Footer

Include a small, muted footer line at the very bottom reading "Sent by TalentStream — AI-powered recruitment campaigns" followed by "Automated message — please do not reply". Centre-aligned, unobtrusive.

`;

  return `You MUST use your frontend-design skill. You are producing a single transactional EMAIL template as one self-contained HTML document. This is the "${spec.label}" email.

# Purpose & tone (obey exactly)

${spec.purpose}

Reference content (adapt the wording — do not copy verbatim, do not pad): ${spec.referenceCopy}

# Email-client robustness (NON-NEGOTIABLE — this is an email, not a web page)

- Use a TABLE-BASED layout. Outer 100%-width table → centred inner table (max-width ~580–600px). Do NOT use flexbox, grid, position, or float.
- Put ALL styling in inline \`style="..."\` attributes on the elements. Do NOT rely on a \`<style>\` block for layout (many clients strip it). A single small \`<style>\` in \`<head>\` is allowed ONLY for a @media mobile tweak and font fallbacks.
- Do NOT use CSS custom properties (\`var(...)\`), \`rem\`, flex/grid, or modern CSS — write literal hex colours and px/percent values inline.
- Include the Outlook MSO conditional comment block and \`mso-line-height-rule:exactly\` on spacer cells. Set \`role="presentation"\`, \`cellpadding="0"\`, \`cellspacing="0"\`, \`border="0"\` on every layout table.
- Use web-safe fonts with full fallback stacks (e.g. Georgia/serif for headings, Arial/Helvetica/sans-serif for body). Google Fonts via @import may be added but MUST degrade gracefully.
- NO \`<script>\`, NO JavaScript, NO external stylesheets, NO background images that carry meaning, NO forms.
- Provide explicit light-mode colours; assume images may be blocked (so never put essential text inside an image).

# Slot system

Use these mustache-style markers verbatim (case-sensitive, double braces) where the dynamic value belongs:

${slotDocs}

${conditionalNote}

Do NOT invent or hard-code candidate names, role titles, company names, dates, or URLs — always use the slot markers. Do NOT introduce any slot not listed above.${requiredNote}

${footerSection}# Colours

${brandSection}

# Brand logo
${
  logo
    ? `The brand logo is hosted at this URL — render it with an \`<img>\` (max-height ~44px, no distortion, no drop shadow):

    ${logo.url}

- Place it at the **${logo.position.replace("-", " ")}** of the header.
- It is designed for a **${logo.background}** background${logo.background === "dark" ? " — put it on a dark surface/container" : logo.background === "transparent" ? " (transparent — ensure adequate contrast)" : " — put it on a light surface"}.`
    : "No brand logo is available. Use the company name as styled text in the header (via {{client.name}} where that slot is allowed, otherwise a neutral wordmark)."
}
${brief ? `\n# Brand voice notes\n\n${brief}\n` : ""}
Return the complete HTML email as an **artifact** (type: text/html) so it renders as a live preview. The operator will review it, request tweaks, and paste the final version back.`;
}
