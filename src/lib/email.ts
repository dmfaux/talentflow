import { db } from "@/db";
import { candidates, messages } from "@/db/schema";
import { DEFAULT_EMAIL_THEME, type EmailTheme } from "@/lib/theme";
import {
  replaceEmailSlots,
  type EmailSlotData,
  type EmailTemplateType,
} from "@/lib/email-slots";
import { BODY_MARKER } from "@/lib/email-shell";
import { appHostOrigin } from "@/lib/host";
import { readableTextOn } from "@/lib/theme-colors";
import { DEFAULT_EMAIL_COPY } from "@/lib/theme-copy";
import { recordUsageEvent } from "@/lib/usage";
import { eq } from "drizzle-orm";

// ── Transport abstraction ───────────────────────────────────────────

interface SendResult {
  id: string | null;
  error: unknown | null;
}

interface EmailTransport {
  send(
    from: string,
    to: string,
    subject: string,
    html: string,
    replyTo?: string
  ): Promise<SendResult>;
}

let _transport: EmailTransport | null = null;

function getTransport(): EmailTransport {
  if (!_transport) {
    if (process.env.EMAIL_PROVIDER === "resend") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Resend } = require("resend");
      const client = new Resend(process.env.RESEND_API_KEY);
      _transport = {
        async send(from, to, subject, html, replyTo) {
          const { data, error } = await client.emails.send({
            from,
            to,
            subject,
            html,
            ...(replyTo ? { replyTo } : {}),
          });
          return { id: data?.id ?? null, error };
        },
      };
    } else {
      // Default: SMTP (Mailpit in dev)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? "localhost",
        port: Number(process.env.SMTP_PORT ?? 1026),
        secure: false,
      });
      _transport = {
        async send(from, to, subject, html, replyTo) {
          const info = await transporter.sendMail({
            from,
            to,
            subject,
            html,
            ...(replyTo ? { replyTo } : {}),
          });
          return { id: info.messageId ?? null, error: null };
        },
      };
    }
  }
  return _transport;
}

const FROM =
  process.env.EMAIL_FROM ?? "TalentStream <apply@talentstream.co.za>";

/** Bare email address from a possibly-display-name From header
 *  ("Name <a@b.com>" → "a@b.com"). */
function addressOf(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}

// ── Per-brand sending identity (S10, Decision D) ────────────────────

export interface BrandEmailIdentity {
  /** Full From header. Display name may be personalised per brand, but the
   *  address is always the verified EMAIL_FROM address (deliverability-safe). */
  from: string;
  /** Reply-To, set only when the brand configured one. */
  replyTo?: string;
}

/**
 * Deliverability-safe per-brand identity. Personalises the DISPLAY name only —
 * the verified envelope-from (EMAIL_FROM's address) is always retained, because
 * brands have no SPF/DKIM/domain verification and spoofing their domain would
 * tank deliverability. A brand with neither field set yields exactly today's
 * behaviour: the global FROM and no Reply-To. Safe for unverified brands.
 */
export function brandEmailIdentity(
  brand?: { from_name?: string | null; reply_to_email?: string | null } | null
): BrandEmailIdentity {
  const fromName = brand?.from_name?.trim();
  const replyTo = brand?.reply_to_email?.trim() || undefined;
  return {
    from: fromName ? `${fromName} <${addressOf(FROM)}>` : FROM,
    replyTo,
  };
}

// ── Send email ───────────────────────────────────────────────────────

export async function sendTransactionalEmail(
  to: string,
  subject: string,
  htmlBody: string,
  identity?: BrandEmailIdentity
): Promise<string | null> {
  try {
    const { id, error } = await getTransport().send(
      identity?.from ?? FROM,
      to,
      subject,
      htmlBody,
      identity?.replyTo
    );

    if (error) {
      console.error("sendTransactionalEmail error:", error);
      return null;
    }

    return id;
  } catch (err) {
    console.error("sendTransactionalEmail exception:", err);
    return null;
  }
}

export async function sendCandidateEmail(
  to: string,
  subject: string,
  htmlBody: string,
  candidateId: string,
  identity?: BrandEmailIdentity
): Promise<string | null> {
  try {
    const { id, error } = await getTransport().send(
      identity?.from ?? FROM,
      to,
      subject,
      htmlBody,
      identity?.replyTo
    );

    if (error) {
      console.error("sendCandidateEmail error:", error);
    }

    // messages.org_id is NOT NULL (S5). Derive org + brand from the candidate
    // so the message log + usage meter carry the tenant explicitly rather than
    // relying on the DB trigger (dropped in S13). Skip the log if the candidate
    // is gone. email_sent metering is centralised here so every candidate email
    // is counted exactly once regardless of call site.
    const candidate = await db.query.candidates.findFirst({
      where: eq(candidates.id, candidateId),
      columns: { org_id: true },
      with: { campaign: { columns: { client_id: true } } },
    });
    if (candidate) {
      await db.insert(messages).values({
        org_id: candidate.org_id,
        candidate_id: candidateId,
        channel: "email",
        direction: "outbound",
        content: subject,
        status: error ? "failed" : "sent",
        external_id: id,
      });
      recordUsageEvent({
        orgId: candidate.org_id,
        brandId: candidate.campaign?.client_id ?? null,
        kind: "email_sent",
        candidateId,
      });
    }

    return id;
  } catch (err) {
    console.error("sendCandidateEmail exception:", err);
    return null;
  }
}

// ── Email templates ──────────────────────────────────────────────────

/** Minimal HTML escape for admin-supplied free text that is embedded in email
 *  bodies. Covers the five characters that matter inside HTML attribute and
 *  element content contexts. Pure (theme-independent) → stays module-level. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build a theme-bound email kit. Every helper closes over `theme`, reading
 * `P.x` (= `theme.palette.x`) and the font stacks where the old module-level
 * `C`/`FONT_*` constants were read. The palette keys rename the old `C` keys —
 * cobalt→primary, cobaltDeep→primaryDeep, cobaltTint→primaryTint,
 * vermillion→accent — with identical hex values, so under DEFAULT_EMAIL_THEME
 * every template is byte-identical to its pre-CT1 output (locked by the email
 * snapshot test). FONT_DISPLAY/FONT_SANS are local aliases of the theme fonts so
 * those interpolations stay untouched.
 */
function makeEmailKit(theme: EmailTheme) {
  const P = theme.palette;
  const FONT_DISPLAY = theme.fontDisplay;
  const FONT_SANS = theme.fontSans;
  // Button label sits ON the primary colour — pick black/white by WCAG contrast
  // so a light brand primary (e.g. a yellow) keeps a legible label. The default
  // cobalt primary resolves to white, so this is byte-identical for that theme.
  const onPrimary = readableTextOn(P.primary);

  function emailHeading(label: string, title: string): string {
    return `
    <p style="margin:0 0 10px;font-family:${FONT_SANS};font-size:11px;text-transform:uppercase;letter-spacing:0.16em;color:${P.primary};font-weight:600;">
      <span style="display:inline-block;width:18px;height:1px;background-color:${P.accent};vertical-align:middle;margin-right:10px;"></span>${label}
    </p>
    <h1 class="ts-headline" style="margin:0 0 24px;font-family:${FONT_DISPLAY};font-size:30px;color:${P.ink};font-weight:400;line-height:1.12;letter-spacing:-0.015em;">${title}</h1>`;
  }

  function emailP(html: string, last = false): string {
    return `<p style="margin:0${last ? "" : " 0 16px"};font-family:${FONT_SANS};font-size:15px;color:${P.inkSoft};line-height:1.7;">${html}</p>`;
  }

  function emailNote(html: string): string {
    return `<p style="margin:20px 0 0;padding-top:18px;border-top:1px solid ${P.border};font-family:${FONT_SANS};font-size:13px;color:${P.inkMuted};line-height:1.65;">${html}</p>`;
  }

  function emailBtn(text: string, url: string): string {
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
      <tr><td style="background-color:${P.primary};border-radius:8px;">
        <a href="${url}" style="display:inline-block;padding:14px 28px;color:${onPrimary};text-decoration:none;font-family:${FONT_SANS};font-size:14px;font-weight:600;letter-spacing:0.01em;">${text}&ensp;&#8594;</a>
      </td></tr>
    </table>`;
  }

  function emailInfoCard(items: [string, string][]): string {
    const rows = items
      .map(
        ([label, value], i) => `
    <p style="margin:0 0 3px;font-family:${FONT_SANS};font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:${P.inkMuted};font-weight:600;">${label}</p>
    <p style="margin:0${i < items.length - 1 ? " 0 14px" : ""};font-family:${FONT_DISPLAY};font-size:18px;color:${P.ink};line-height:1.3;">${value}</p>`
      )
      .join("");

    return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
      <tr>
        <td width="3" style="background-color:${P.primary};border-radius:2px 0 0 2px;font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:18px 22px;background-color:${P.primaryTint};border-radius:0 4px 4px 0;">
          ${rows}
        </td>
      </tr>
    </table>`;
  }

  function emailFallbackLink(url: string): string {
    // The fallback URL is helper text, not a call to action, so it reads in muted
    // ink rather than the brand primary. Carry the colour on BOTH the anchor and an
    // inner <span>: the global `a { color: primary }` rule (and some clients' link
    // auto-recolouring) can win over an anchor's own colour, but an inner span's
    // colour is honoured — so the link stays muted everywhere.
    return `<p style="margin:14px 0 0;font-family:${FONT_SANS};font-size:12px;color:${P.inkMuted};line-height:1.55;">
    If the button doesn&rsquo;t work, copy this link into your browser:<br>
    <a href="${url}" style="color:${P.inkMuted};word-break:break-all;text-decoration:underline;"><span style="color:${P.inkMuted};">${url}</span></a>
  </p>`;
  }

  /* Brand header. When the theme carries a logo (a bespoke theme, or a gallery/
   * default theme that adopted the rendering brand's logo), render it as an
   * <img> — sized (~44px), aligned by logo.position, with a dark surface only
   * when logo.background is "dark", and no border/shadow (mirrors
   * prompt-builder.ts:132-141). When logo is null (the DEFAULT_EMAIL_THEME path),
   * render the email-safe TalentStream funnel wordmark unchanged — SVG is
   * inconsistent across clients (Gmail strips inline SVG), so the mark is a 4-bar
   * descending funnel built from tables, followed by the lowercase wordmark. */
  function brandHeader(): string {
    if (theme.logo) {
      const pos = theme.logo.position.toLowerCase();
      const align = pos.includes("right")
        ? "right"
        : pos.includes("cent")
          ? "center"
          : "left";
      const cellStyle =
        theme.logo.background === "dark"
          ? ` style="padding:10px 14px;background-color:${P.ink};border-radius:6px;"`
          : "";
      return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}" style="border-collapse:separate;">
      <tr><td${cellStyle}>
        <img src="${theme.logo.url}" alt="Logo" style="display:block;max-height:44px;width:auto;border:0;outline:none;text-decoration:none;">
      </td></tr>
    </table>`;
    }

    const bar = (width: number, opacity: string) =>
      `<tr><td height="3" width="${width}" style="background-color:${P.primary};opacity:${opacity};border-radius:2px;font-size:0;line-height:3px;mso-line-height-rule:exactly;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td height="3" colspan="2" style="font-size:0;line-height:3px;mso-line-height-rule:exactly;">&nbsp;</td></tr>`;

    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
      <tr>
        <!-- Mark: 4 descending cobalt bars = candidate funnel -->
        <td valign="middle" style="padding-right:12px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="26" style="border-collapse:separate;">
            ${bar(26, "1")}
            ${bar(20, "0.78")}
            ${bar(13, "0.58")}
            <tr>
              <td height="3" width="7" style="background-color:${P.primary};opacity:0.4;border-radius:2px;font-size:0;line-height:3px;mso-line-height-rule:exactly;">&nbsp;</td>
              <td valign="middle" style="padding-left:3px;font-size:0;line-height:0;">
                <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:${P.accent};"></span>
              </td>
            </tr>
          </table>
        </td>
        <!-- Wordmark -->
        <td valign="middle">
          <span style="font-family:${FONT_SANS};font-size:19px;font-weight:700;letter-spacing:-0.03em;color:${P.ink};line-height:1;">
            talent<span style="color:${P.primary};">stream</span>
          </span>
        </td>
      </tr>
    </table>`;
  }

  function wrapTemplate(body: string): string {
    // CT7 fonts: one @import per chosen web font (display + body), resolved from
    // theme.fontImports. Under the default theme this expands to the same two
    // Instrument families the email previously loaded — split across two @import
    // lines rather than one combined URL (the only intended default-theme snapshot
    // change). RD-1: a pre-CT7 snapshot has NO fontImports key (undefined) — it
    // back-fills to the Instrument default so an active legacy campaign keeps its
    // web fonts. A theme that deliberately chose system fonts stores an explicit
    // [] (not undefined), which `??` preserves → no @import.
    const fontImports = (theme.fontImports ?? DEFAULT_EMAIL_THEME.fontImports ?? [])
      .map((u) => `@import url('${u}');`)
      .join("\n    ");
    // Footer: the powered-by attribution only when the theme allows it; a
    // white-label theme (show_powered_by false) drops it for a neutral line. The
    // second line's text is now sourced from the theme's shared footer copy.
    // Emitted as authored (not re-escaped) — consistent with how greeting / body
    // copy templates flow through replaceEmailSlots, which escapes slot VALUES,
    // not the surrounding copy. The default copy ("Automated message — please do
    // not reply", real em dash U+2014) renders the same em-dash glyph the old
    // hard-coded "&mdash;" entity did — visually identical across clients.
    const copy = DEFAULT_EMAIL_COPY;
    const footerLine = copy.shared.footer;
    const footerText = theme.showPoweredBy
      ? `Sent by TalentStream&ensp;&middot;&ensp;AI-powered recruitment campaigns<br>
            ${footerLine}`
      : footerLine;
    return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>TalentStream</title>
  <!--[if mso]>
  <style type="text/css">
    table, td, div, h1, p { font-family: Georgia, 'Times New Roman', serif; }
  </style>
  <![endif]-->
  <style type="text/css">
    ${fontImports}
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    a { color:${P.primary}; }
    @media (max-width: 620px) {
      .ts-card { width:100% !important; max-width:100% !important; }
      .ts-pad { padding-left:28px !important; padding-right:28px !important; }
      .ts-headline { font-size:26px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${P.bg};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${P.bg};">
    <tr><td align="center" style="padding:56px 16px;">

      <table role="presentation" class="ts-card" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;">

        <!-- Top accent bar — cobalt -->
        <tr><td style="height:3px;background-color:${P.primary};border-radius:6px 6px 0 0;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>

        <!-- Card -->
        <tr><td style="background:${P.card};border-left:1px solid ${P.border};border-right:1px solid ${P.border};border-bottom:1px solid ${P.border};border-radius:0 0 6px 6px;">

          <!-- Brand header -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="ts-pad" style="padding:26px 44px 24px;border-bottom:1px solid ${P.border};">
              ${brandHeader()}
            </td></tr>
          </table>

          <!-- Body -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="ts-pad" style="padding:40px 44px 44px;">
              ${body}
            </td></tr>
          </table>

        </td></tr>
      </table>

      <!-- Footer -->
      <table role="presentation" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;">
        <tr><td style="padding:22px 44px;text-align:center;">
          <p style="margin:0;font-family:${FONT_SANS};font-size:11px;color:${P.inkFaint};line-height:1.55;letter-spacing:0.02em;">
            ${footerText}
          </p>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
  }

  return {
    wrapTemplate,
    emailHeading,
    emailP,
    emailNote,
    emailBtn,
    emailInfoCard,
    emailFallbackLink,
    brandHeader,
  };
}

/** What each of the nine themed emails declares for the shared assembler. The
 *  assembler owns the cross-email structure (heading → greeting → message →
 *  extras → sign-off) so every template renders one shared wrapper; each email
 *  only supplies its own heading, default prose, and always-render structural
 *  pieces. */
interface ThemedEmailSpec {
  type: EmailTemplateType;
  theme: EmailTheme;
  data: EmailSlotData;
  /** The email's eyebrow + title (unchanged per email). */
  heading: { label: string; title: string };
  /** The prose paragraph(s) — one or more emailP()s joined by the same
   *  "\n    " separator the per-fn template literals used. */
  defaultMessageHtml: string;
  /** Structural pieces that ALWAYS render regardless of a body override —
   *  emailInfoCard / emailBtn / emailFallbackLink / closing emailNote — already
   *  joined by "\n    ". This is why an action email never loses its button to a
   *  copy override. "" when the email has no structural extras. */
  extrasHtml: string;
}

/**
 * The SINGLE assembler every themed email flows through. It builds the shared
 * greeting + the email's default prose + optional sign-off, then renders the card
 * body either INTO the theme's bespoke email shell (custom/Premium themes — the
 * assembled body replaces the shell's BODY_MARKER, so it inherits the bespoke
 * chrome) or INTO the in-code default chrome (wrapTemplate). Either way the body
 * content is deterministic, so an action email never loses its button to
 * free-form HTML.
 *
 * Byte-preservation: under DEFAULT_EMAIL_THEME (no shell) the assembled pieces
 * join to the exact "\n    "-separated body the old per-fn template literals
 * produced (greeting = "Hi {{candidate.name}}," → "Hi Sam,"; empty sign-off →
 * nothing), wrapped by the unchanged default chrome.
 */
function renderThemedEmail(spec: ThemedEmailSpec): string {
  const { theme, data } = spec;
  const { wrapTemplate, emailHeading, emailP, emailNote } = makeEmailKit(theme);

  const copy = DEFAULT_EMAIL_COPY;

  // Shared greeting (default "Hi {{candidate.name}}," → "Hi Sam,").
  const greeting = emailP(replaceEmailSlots(copy.shared.greeting, data));

  // The email's default prose message.
  const message = spec.defaultMessageHtml;

  // Optional shared sign-off: rendered only when non-blank (default empty →
  // nothing, preserving every template's tailored close).
  const signOff = copy.shared.signOff.trim()
    ? emailNote(replaceEmailSlots(copy.shared.signOff, data))
    : "";

  // Assemble the card body in order, joined exactly as the old per-fn literals:
  // a leading "\n    ", each piece separated by "\n    ", trailing "\n  ".
  const pieces = [
    emailHeading(spec.heading.label, spec.heading.title),
    greeting,
    message,
    spec.extrasHtml,
  ];
  if (signOff) pieces.push(signOff);
  const innerBody = `\n    ${pieces.join("\n    ")}\n  `;

  // A bespoke theme supplies its own MSO-safe email shell (chrome) with a
  // BODY_MARKER; the assembled body is injected there (the shell's own {{slots}}
  // — e.g. {{client.name}} in a header — resolve against the same data). Else the
  // in-code default chrome wraps the body.
  if (theme.emailShell && theme.emailShell.trim()) {
    return replaceEmailSlots(theme.emailShell, data).replace(
      BODY_MARKER,
      innerBody
    );
  }
  return wrapTemplate(innerBody);
}

/**
 * Resolve the plain-text subject for a campaign email (CT7). Subjects are plain
 * text (not HTML), so this substitutes slots WITHOUT HTML-escaping — distinct
 * from replaceEmailSlots, which escapes for HTML bodies. Reads the theme's
 * per-type subject override, falling back to the default subject; the default +
 * a role title is byte-identical to today's inline "… — ${roleTitle}".
 */
export function resolveEmailSubject(
  type: EmailTemplateType,
  data: EmailSlotData
): string {
  const template = DEFAULT_EMAIL_COPY.perType[type]!.subject!;
  return substitutePlainSlots(template, data);
}

/** Plain-text slot substitution for subjects: same slot paths as
 *  replaceEmailSlots (incl. conditional blocks) but NO HTML escaping, because a
 *  subject line is plain text, never HTML. */
function substitutePlainSlots(template: string, data: EmailSlotData): string {
  const value = (name: string): string => {
    const map: Record<string, string | null | undefined> = {
      "candidate.name": data.candidate?.name,
      "campaign.role_title": data.campaign?.role_title,
      "client.name": data.client?.name,
      "action.url": data.action?.url,
      "chat.close_by_date": data.chat?.close_by_date,
      "admin.reason": data.admin?.reason,
    };
    const raw = map[name];
    return raw === null || raw === undefined ? "" : String(raw);
  };
  return template
    .replace(/\{\{#([^}]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, inner) =>
      value(name.trim()) ? inner : ""
    )
    .replace(/\{\{([^}]+)\}\}/g, (_, name) => value(name.trim()));
}

export function applicationReceivedEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  const { emailP, emailInfoCard, emailNote } = makeEmailKit(theme);
  return renderThemedEmail({
    type: "applicationReceived",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
    },
    heading: { label: "Confirmation", title: "We&rsquo;ve got your application" },
    defaultMessageHtml: emailP(
      "Thank you for applying. We&rsquo;ve received your application and it&rsquo;s now being reviewed."
    ),
    extrasHtml: `${emailInfoCard([["Role", roleTitle], ["Company", clientName]])}\n    ${emailNote("You&rsquo;ll hear from us soon with an update on next steps.")}`,
  });
}

export function gatingPassedEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  const { emailP, emailNote } = makeEmailKit(theme);
  return renderThemedEmail({
    type: "gatingPassed",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
    },
    heading: { label: "Good news", title: "You&rsquo;re moving forward" },
    defaultMessageHtml: emailP(
      `Great news &mdash; you meet the initial requirements for the <strong>${roleTitle}</strong> role at <strong>${clientName}</strong>. Your application is now being reviewed by the team.`
    ),
    extrasHtml: emailNote(
      "We&rsquo;ll be in touch with the outcome shortly. Thank you for your patience."
    ),
  });
}

export function passwordResetEmail(
  firstName: string,
  resetUrl: string
): string {
  // Non-campaign template: always the default theme, never parameterised.
  const { wrapTemplate, emailHeading, emailP, emailBtn, emailNote } =
    makeEmailKit(DEFAULT_EMAIL_THEME);
  return wrapTemplate(`
    ${emailHeading("Account security", "Reset your password")}
    ${emailP(`Hi ${firstName},`)}
    ${emailP("We received a request to reset your TalentStream password. Click below to choose a new one. This link expires in 1&nbsp;hour.")}
    ${emailBtn("Reset password", resetUrl)}
    ${emailNote("If you didn&rsquo;t request this, you can safely ignore this email &mdash; your password won&rsquo;t change.")}
  `);
}

/** Internal team notification for a homepage "request access" enquiry. The source
 *  is a public, unauthenticated form, so the submitted address is HTML-escaped and
 *  carried as Reply-To (set by the caller) so the team can respond directly.
 *  Non-campaign → always the default theme, sent unmetered via
 *  sendTransactionalEmail. */
export function contactRequestEmail(email: string, submittedAt: string): string {
  const addr = escapeHtml(email);
  const when = escapeHtml(submittedAt);
  const { wrapTemplate, emailHeading, emailP, emailInfoCard, emailNote } =
    makeEmailKit(DEFAULT_EMAIL_THEME);
  return wrapTemplate(`
    ${emailHeading("New enquiry", "Someone wants to start a campaign")}
    ${emailP("A visitor requested access from the TalentStream homepage.")}
    ${emailInfoCard([["Work email", addr], ["Received", when]])}
    ${emailNote("Just reply to this email to reach them directly.")}
  `);
}

/** Colleague invitation to join an org on TalentStream (S8). Credential-granting
 *  link with a 7-day TTL. orgName + inviterName are DB free text → HTML-escaped. */
export function invitationEmail(
  orgName: string,
  inviterName: string,
  acceptUrl: string
): string {
  const org = escapeHtml(orgName);
  const inviter = inviterName.trim() ? escapeHtml(inviterName.trim()) : null;
  const intro = inviter
    ? `<strong>${inviter}</strong> has invited you to join <strong>${org}</strong> on TalentStream.`
    : `You&rsquo;ve been invited to join <strong>${org}</strong> on TalentStream.`;
  // Non-campaign template: always the default theme, never parameterised.
  const { wrapTemplate, emailHeading, emailP, emailBtn, emailFallbackLink, emailNote } =
    makeEmailKit(DEFAULT_EMAIL_THEME);
  return wrapTemplate(`
    ${emailHeading("Invitation", "You&rsquo;ve been invited")}
    ${emailP(intro)}
    ${emailP("Set up your account to get started. This invitation expires in 7&nbsp;days.")}
    ${emailBtn("Accept invitation", acceptUrl)}
    ${emailFallbackLink(acceptUrl)}
    ${emailNote("If you weren&rsquo;t expecting this invitation, you can safely ignore this email.")}
  `);
}

export type SpendAlertVariant = "threshold" | "summary" | "hardcap";

/** Spend-alert email (usage-based pricing, Phase 5). Org-level, non-campaign →
 *  always the default theme, sent unmetered via sendTransactionalEmail. orgName
 *  is DB free text → HTML-escaped. The unsubscribe link is token-only/public. */
export function spendAlertEmail(input: {
  variant: SpendAlertVariant;
  orgName: string;
  period: string; // 'YYYY-MM'
  usedCredits: number;
  includedCredits: number;
  pctUsed: number;
  spendInclVat: number;
  usageUrl: string;
  unsubscribeUrl: string;
}): string {
  const org = escapeHtml(input.orgName);
  const credits = (n: number) =>
    n.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
  const zar = (n: number) =>
    `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const copy: Record<
    SpendAlertVariant,
    { label: string; title: string; lead: string }
  > = {
    threshold: {
      label: "Spend alert",
      title: "Approaching your credit allowance",
      lead: `<strong>${org}</strong> has used <strong>${input.pctUsed}%</strong> of its monthly AI-credit allowance for ${input.period}.`,
    },
    hardcap: {
      label: "Spend ceiling reached",
      title: "New scoring is paused",
      lead: `<strong>${org}</strong> has reached its spend ceiling for ${input.period}. New candidate scoring is paused; work already in progress will finish. Raise the ceiling to resume intake.`,
    },
    summary: {
      label: "Spend summary",
      title: `Your spend for ${input.period}`,
      lead: `Here&rsquo;s the AI-spend summary for <strong>${org}</strong>.`,
    },
  };
  const c = copy[input.variant];

  const { wrapTemplate, emailHeading, emailP, emailInfoCard, emailBtn, emailFallbackLink, emailNote } =
    makeEmailKit(DEFAULT_EMAIL_THEME);
  return wrapTemplate(`
    ${emailHeading(c.label, c.title)}
    ${emailP(c.lead)}
    ${emailInfoCard([
      ["Period", input.period],
      ["Credits used", `${credits(input.usedCredits)} of ${credits(input.includedCredits)}`],
      ["Used", `${input.pctUsed}%`],
      ["Spend (incl. VAT)", zar(input.spendInclVat)],
    ])}
    ${emailBtn("View Usage & Spend", input.usageUrl)}
    ${emailFallbackLink(input.usageUrl)}
    ${emailNote(`You&rsquo;re receiving this because you subscribed to spend alerts. <a href="${input.unsubscribeUrl}">Unsubscribe</a>.`)}
  `);
}

/** Internal staff reminder that candidates are sitting in `pending_rejection`
 *  awaiting a human accept/dismiss decision (human-in-the-loop rejection). Sent
 *  to a brand's recruiters/admins when items go stale — first after a few days,
 *  then weekly. Org/brand-level, non-campaign → always the default theme, sent
 *  unmetered via sendTransactionalEmail. brandName + recipientName are DB free
 *  text → HTML-escaped. */
export function pendingRejectionReminderEmail(input: {
  recipientName: string;
  brandName: string;
  count: number;
  oldestDays: number;
  reviewUrl: string;
}): string {
  const brand = escapeHtml(input.brandName);
  const name = escapeHtml(input.recipientName.trim() || "there");
  const verb = input.count === 1 ? "candidate is" : "candidates are";
  const days = `${input.oldestDays} day${input.oldestDays === 1 ? "" : "s"}`;
  const { wrapTemplate, emailHeading, emailP, emailInfoCard, emailBtn, emailFallbackLink, emailNote } =
    makeEmailKit(DEFAULT_EMAIL_THEME);
  return wrapTemplate(`
    ${emailHeading("Action needed", "Candidates awaiting your decision")}
    ${emailP(`Hi ${name},`)}
    ${emailP(`<strong>${input.count}</strong> ${verb} recommended for rejection on <strong>${brand}</strong> and waiting for someone to accept or dismiss the recommendation. No candidate is rejected automatically &mdash; these stay open until a person decides.`)}
    ${emailInfoCard([
      ["Awaiting decision", String(input.count)],
      ["Oldest waiting", days],
    ])}
    ${emailBtn("Review candidates", input.reviewUrl)}
    ${emailFallbackLink(input.reviewUrl)}
    ${emailNote("You&rsquo;re receiving this because you manage candidates for this brand.")}
  `);
}

/** South African EFT tax invoice email (usage-based pricing, Phase 6). Org-level
 *  → always the default theme, sent unmetered. The `issued` variant lists the
 *  priced lines; `overdue` is a payment reminder. VAT number + EFT banking
 *  details come from env (BILLING_VAT_NUMBER / BILLING_BANK_DETAILS). */
export function invoiceEmail(input: {
  variant: "issued" | "overdue";
  orgName: string;
  invoice: {
    invoice_no: string;
    period: string;
    subtotal_ex_vat: number;
    vat_amount: number;
    total_incl_vat: number;
    issued_at: Date | null;
    due_at: Date | null;
    status: string;
  };
  priced?: import("@/lib/pricing").PricedInvoice;
}): string {
  const org = escapeHtml(input.orgName);
  const inv = input.invoice;
  const zar = (n: number) =>
    `R${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const date = (d: Date | null) =>
    d
      ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })
      : "—";

  const vatNumber = process.env.BILLING_VAT_NUMBER;
  const bankDetails = process.env.BILLING_BANK_DETAILS;
  const statementUrl = `${appHostOrigin()}/billing`;

  const { wrapTemplate, emailHeading, emailP, emailInfoCard, emailBtn, emailNote } =
    makeEmailKit(DEFAULT_EMAIL_THEME);

  // Line breakdown (issued only). priced.lines already ends with the VAT line.
  const lineRows: [string, string][] = (input.priced?.lines ?? []).map((l) => [
    l.description,
    zar(l.amountZar),
  ]);

  const summary: [string, string][] = [
    ["Invoice no.", inv.invoice_no],
    ["Billing period", inv.period],
    ["Issued", date(inv.issued_at)],
    ["Due", date(inv.due_at)],
    ["Total (incl. VAT)", zar(inv.total_incl_vat)],
  ];

  const eftBlock = bankDetails
    ? emailInfoCard([
        ["Pay by EFT to", escapeHtml(bankDetails)],
        ["Reference", inv.invoice_no],
      ])
    : emailNote(`Please use <strong>${inv.invoice_no}</strong> as your payment reference.`);

  const vatNote = vatNumber
    ? emailNote(`Tax invoice. VAT registration no. ${escapeHtml(vatNumber)}. VAT charged at 15%.`)
    : emailNote("Tax invoice. VAT charged at 15%.");

  if (input.variant === "overdue") {
    return wrapTemplate(`
      ${emailHeading("Payment overdue", "Your invoice is past due")}
      ${emailP(`Invoice <strong>${inv.invoice_no}</strong> for <strong>${org}</strong> was due on ${date(inv.due_at)} and is now overdue.`)}
      ${emailInfoCard(summary)}
      ${eftBlock}
      ${emailBtn("View statement", statementUrl)}
      ${emailNote("If you&rsquo;ve already paid, please disregard this reminder.")}
      ${vatNote}
    `);
  }

  return wrapTemplate(`
    ${emailHeading("Tax invoice", `Invoice ${escapeHtml(inv.invoice_no)}`)}
    ${emailP(`Here&rsquo;s your TalentStream tax invoice for <strong>${org}</strong>, billing period ${inv.period}.`)}
    ${emailInfoCard(summary)}
    ${lineRows.length ? emailInfoCard(lineRows) : ""}
    ${eftBlock}
    ${emailBtn("View statement", statementUrl)}
    ${vatNote}
  `);
}

export function gatingFailedEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  const { emailP, emailNote } = makeEmailKit(theme);
  return renderThemedEmail({
    type: "gatingFailed",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
    },
    heading: { label: "Application update", title: "Thank you for applying" },
    defaultMessageHtml: emailP(
      `Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. Unfortunately, your profile does not meet the specific requirements for this role at this time.`
    ),
    extrasHtml: emailNote(
      "We encourage you to apply for future opportunities that may be a better fit. We wish you all the best."
    ),
  });
}

export function rejectionEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string,
  /** Optional reviewer feedback, shown to the candidate ONLY when the reviewer
   *  opted in. Rendered verbatim (HTML-escaped) as a feedback paragraph before
   *  the standard closing note. */
  reviewerFeedback?: string
): string {
  const { emailP, emailNote } = makeEmailKit(theme);
  const cleaned = reviewerFeedback?.trim();
  const feedbackBlock = cleaned
    ? emailP(
        `The reviewer shared the following feedback: &ldquo;${escapeHtml(cleaned)}&rdquo;`
      )
    : "";
  return renderThemedEmail({
    type: "rejection",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
    },
    heading: {
      label: "Application update",
      title: "Thank you for your interest",
    },
    defaultMessageHtml: emailP(
      `Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. After careful consideration, we&rsquo;ve decided not to move forward with your application at this time.`
    ),
    extrasHtml: `${feedbackBlock ? `${feedbackBlock}\n    ` : ""}${emailNote(
      "We appreciate the time you invested and encourage you to keep an eye out for future opportunities. We wish you all the best in your career."
    )}`,
  });
}

export function chatInvitationEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string,
  chatUrl: string
): string {
  const { emailP, emailInfoCard, emailBtn, emailFallbackLink } =
    makeEmailKit(theme);
  return renderThemedEmail({
    type: "chatInvitation",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
      action: { url: chatUrl },
    },
    heading: { label: "Next step", title: "We&rsquo;d like to chat" },
    defaultMessageHtml: emailP(
      "We have a few follow-up questions about your application. This should only take a few minutes."
    ),
    extrasHtml: `${emailInfoCard([["Role", roleTitle], ["Company", clientName]])}\n    ${emailBtn("Start chat", chatUrl)}\n    ${emailFallbackLink(chatUrl)}`,
  });
}

export function chatAccessEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  magicLinkUrl: string
): string {
  const { emailP, emailBtn, emailNote } = makeEmailKit(theme);
  return renderThemedEmail({
    type: "chatAccess",
    theme,
    data: {
      // No client name on this template (the magic-link verify email has no
      // company context — mirrors EMAIL_SLOT_SPECS.chatAccess).
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      action: { url: magicLinkUrl },
    },
    heading: { label: "Verification", title: "Confirm your identity" },
    defaultMessageHtml: emailP(
      `We received a request to access your chat for the <strong>${roleTitle}</strong> application. Click below to verify your identity and continue. This link expires in 1&nbsp;hour.`
    ),
    extrasHtml: `${emailBtn("Verify &amp; continue", magicLinkUrl)}\n    ${emailNote("If you didn&rsquo;t request this, you can safely ignore this email.")}`,
  });
}

// ── Nudge / no-response / rejection-confirmation templates ─────────

/** Reminder fired partway through the follow-up window for ghost candidates.
 *  Honest, not an ultimatum — frames the close as "we'll assume you're no
 *  longer interested", matching the blameless no_response terminal state. */
export function chatNudgeEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string,
  chatUrl: string,
  closeByDate: string
): string {
  const { emailP, emailBtn, emailFallbackLink } = makeEmailKit(theme);
  return renderThemedEmail({
    type: "chatNudge",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
      action: { url: chatUrl },
      chat: { close_by_date: closeByDate },
    },
    heading: {
      label: "Reminder",
      title: "We&rsquo;d still love to hear from you",
    },
    defaultMessageHtml: `${emailP(`We&rsquo;re still interested in your application for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>, but we haven&rsquo;t heard back from our earlier chat invitation.`)}\n    ${emailP(`If we don&rsquo;t hear from you by <strong>${closeByDate}</strong>, we&rsquo;ll assume you&rsquo;re no longer interested and close your application for this role.`)}`,
    extrasHtml: `${emailBtn("Continue chat", chatUrl)}\n    ${emailFallbackLink(chatUrl)}`,
  });
}

/** Terminal email for candidates who never engaged with the follow-up chat.
 *  Blameless by design — no judgment on the candidate, just a statement that
 *  the application is being closed. Kept distinct from rejectionEmail so the
 *  candidate understands no evaluation decision was made. */
export function noResponseEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  const { emailP, emailNote } = makeEmailKit(theme);
  return renderThemedEmail({
    type: "noResponse",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
    },
    heading: {
      label: "Application update",
      title: "We&rsquo;ve closed your application",
    },
    defaultMessageHtml: emailP(
      `We reached out with a few follow-up questions about your application for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>, but we haven&rsquo;t heard back &mdash; so we&rsquo;ve closed your application for this role.`
    ),
    extrasHtml: emailNote(
      "Thank you for your interest. We wish you the very best in your search and hope to see you apply for a future opportunity."
    ),
  });
}

/** Backstop confirmation email after an in-chat rejection has been delivered.
 *  Short and plain — the warmth (such as it is) already happened in the chat.
 *  This exists so the candidate has a written record if they never reopen the
 *  conversation. Admin's optional reason is rendered verbatim after HTML
 *  escaping. */
export function rejectionConfirmationEmail(
  theme: EmailTheme,
  candidateName: string,
  roleTitle: string,
  clientName: string,
  adminReason?: string
): string {
  const { emailP, emailNote } = makeEmailKit(theme);
  const cleaned = adminReason?.trim();
  const reasonBlock = cleaned
    ? emailP(`They asked us to share the following note: &ldquo;${escapeHtml(cleaned)}&rdquo;`)
    : "";
  return renderThemedEmail({
    type: "rejectionConfirmation",
    theme,
    data: {
      candidate: { name: candidateName },
      campaign: { role_title: roleTitle },
      client: { name: clientName },
      // Pass through verbatim (slot replacement escapes it); null when absent so
      // the {{#admin.reason}}…{{/admin.reason}} conditional block collapses.
      admin: { reason: adminReason ?? null },
    },
    heading: {
      label: "Application update",
      title: "Confirming our earlier message",
    },
    defaultMessageHtml: emailP(
      `This is a written confirmation of the message shared with you in your chat: the recruitment team for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong> has decided not to move forward with your application.`
    ),
    // The optional recruiter-note paragraph ALWAYS renders here (independent of a
    // body override) and collapses to a blank line — preserving the original
    // "\n    \n    <note>" spacing — when absent.
    extrasHtml: `${reasonBlock}\n    ${emailNote("We appreciate the time you invested and wish you the very best in your career.")}`,
  });
}
