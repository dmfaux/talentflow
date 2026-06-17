import { db } from "@/db";
import { candidates, messages } from "@/db/schema";
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

/* Brand palette — cobalt primary, vermillion accent, cream surface, charcoal ink.
 * Kept in lockstep with src/app/globals.css --color-* tokens so email visuals
 * stay aligned with the in-app brand. */
const C = {
  bg: "#f0f3f7", // cream — canvas
  card: "#ffffff", // paper
  cobalt: "#2c5bff", // primary, CTAs, links
  cobaltDeep: "#1a45d4", // button hover / second-layer
  cobaltTint: "#e8eeff", // info card fill
  vermillion: "#05dbd6", // editorial accent for eyebrow labels
  ink: "#11123c", // primary text
  inkSoft: "#2f3941", // secondary text / body
  inkMuted: "#5a6b7a", // notes / helper text
  inkFaint: "#9fb5c4", // footer
  border: "#d1dce6", // rules
} as const;

/* Font stacks — Google fonts aren't reliably loaded across email clients, so
 * these stacks fall back to widely-available system equivalents that match the
 * in-app feel (editorial serif headlines, clean sans body). */
const FONT_DISPLAY =
  "'Instrument Serif', Georgia, 'Times New Roman', 'DejaVu Serif', serif";
const FONT_SANS =
  "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif";

function emailHeading(label: string, title: string): string {
  return `
    <p style="margin:0 0 10px;font-family:${FONT_SANS};font-size:11px;text-transform:uppercase;letter-spacing:0.16em;color:${C.cobalt};font-weight:600;">
      <span style="display:inline-block;width:18px;height:1px;background-color:${C.vermillion};vertical-align:middle;margin-right:10px;"></span>${label}
    </p>
    <h1 class="ts-headline" style="margin:0 0 24px;font-family:${FONT_DISPLAY};font-size:30px;color:${C.ink};font-weight:400;line-height:1.12;letter-spacing:-0.015em;">${title}</h1>`;
}

function emailP(html: string, last = false): string {
  return `<p style="margin:0${last ? "" : " 0 16px"};font-family:${FONT_SANS};font-size:15px;color:${C.inkSoft};line-height:1.7;">${html}</p>`;
}

function emailNote(html: string): string {
  return `<p style="margin:20px 0 0;padding-top:18px;border-top:1px solid ${C.border};font-family:${FONT_SANS};font-size:13px;color:${C.inkMuted};line-height:1.65;">${html}</p>`;
}

function emailBtn(text: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
      <tr><td style="background-color:${C.cobalt};border-radius:8px;">
        <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-family:${FONT_SANS};font-size:14px;font-weight:600;letter-spacing:0.01em;">${text}&ensp;&#8594;</a>
      </td></tr>
    </table>`;
}

function emailInfoCard(items: [string, string][]): string {
  const rows = items
    .map(
      ([label, value], i) => `
    <p style="margin:0 0 3px;font-family:${FONT_SANS};font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:${C.inkMuted};font-weight:600;">${label}</p>
    <p style="margin:0${i < items.length - 1 ? " 0 14px" : ""};font-family:${FONT_DISPLAY};font-size:18px;color:${C.ink};line-height:1.3;">${value}</p>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
      <tr>
        <td width="3" style="background-color:${C.cobalt};border-radius:2px 0 0 2px;font-size:0;line-height:0;">&nbsp;</td>
        <td style="padding:18px 22px;background-color:${C.cobaltTint};border-radius:0 4px 4px 0;">
          ${rows}
        </td>
      </tr>
    </table>`;
}

/** Minimal HTML escape for admin-supplied free text that is embedded in email
 *  bodies. Covers the five characters that matter inside HTML attribute and
 *  element content contexts. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailFallbackLink(url: string): string {
  return `<p style="margin:14px 0 0;font-family:${FONT_SANS};font-size:12px;color:${C.inkMuted};line-height:1.55;">
    If the button doesn&rsquo;t work, copy this link into your browser:<br>
    <a href="${url}" style="color:${C.cobalt};word-break:break-all;text-decoration:underline;">${url}</a>
  </p>`;
}

/* Email-safe wordmark + mark built from HTML tables, since SVG is inconsistent
 * across clients (Gmail in particular strips inline SVG). The mark is a 4-bar
 * descending funnel (cobalt) tied to the in-app Logo component, followed by the
 * lowercase "talentstream" wordmark with "stream" in cobalt. */
function brandHeader(): string {
  const bar = (width: number, opacity: string) =>
    `<tr><td height="3" width="${width}" style="background-color:${C.cobalt};opacity:${opacity};border-radius:2px;font-size:0;line-height:3px;mso-line-height-rule:exactly;">&nbsp;</td><td style="font-size:0;line-height:0;">&nbsp;</td></tr>
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
              <td height="3" width="7" style="background-color:${C.cobalt};opacity:0.4;border-radius:2px;font-size:0;line-height:3px;mso-line-height-rule:exactly;">&nbsp;</td>
              <td valign="middle" style="padding-left:3px;font-size:0;line-height:0;">
                <span style="display:inline-block;width:5px;height:5px;border-radius:50%;background-color:${C.vermillion};"></span>
              </td>
            </tr>
          </table>
        </td>
        <!-- Wordmark -->
        <td valign="middle">
          <span style="font-family:${FONT_SANS};font-size:19px;font-weight:700;letter-spacing:-0.03em;color:${C.ink};line-height:1;">
            talent<span style="color:${C.cobalt};">stream</span>
          </span>
        </td>
      </tr>
    </table>`;
}

function wrapTemplate(body: string): string {
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
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600;700&display=swap');
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; }
    a { color:${C.cobalt}; }
    @media (max-width: 620px) {
      .ts-card { width:100% !important; max-width:100% !important; }
      .ts-pad { padding-left:28px !important; padding-right:28px !important; }
      .ts-headline { font-size:26px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};">
    <tr><td align="center" style="padding:56px 16px;">

      <table role="presentation" class="ts-card" width="580" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;width:100%;">

        <!-- Top accent bar — cobalt -->
        <tr><td style="height:3px;background-color:${C.cobalt};border-radius:6px 6px 0 0;font-size:0;line-height:0;mso-line-height-rule:exactly;">&nbsp;</td></tr>

        <!-- Card -->
        <tr><td style="background:${C.card};border-left:1px solid ${C.border};border-right:1px solid ${C.border};border-bottom:1px solid ${C.border};border-radius:0 0 6px 6px;">

          <!-- Brand header -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td class="ts-pad" style="padding:26px 44px 24px;border-bottom:1px solid ${C.border};">
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
          <p style="margin:0;font-family:${FONT_SANS};font-size:11px;color:${C.inkFaint};line-height:1.55;letter-spacing:0.02em;">
            Sent by TalentStream&ensp;&middot;&ensp;AI-powered recruitment campaigns<br>
            Automated message &mdash; please do not reply
          </p>
        </td></tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

export function applicationReceivedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    ${emailHeading("Confirmation", "We&rsquo;ve got your application")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP("Thank you for applying. We&rsquo;ve received your application and it&rsquo;s now being reviewed.")}
    ${emailInfoCard([["Role", roleTitle], ["Company", clientName]])}
    ${emailNote("You&rsquo;ll hear from us soon with an update on next steps.")}
  `);
}

export function gatingPassedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    ${emailHeading("Good news", "You&rsquo;re moving forward")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`Great news &mdash; you meet the initial requirements for the <strong>${roleTitle}</strong> role at <strong>${clientName}</strong>. Your application is now being reviewed by the team.`)}
    ${emailNote("We&rsquo;ll be in touch with the outcome shortly. Thank you for your patience.")}
  `);
}

export function passwordResetEmail(
  firstName: string,
  resetUrl: string
): string {
  return wrapTemplate(`
    ${emailHeading("Account security", "Reset your password")}
    ${emailP(`Hi ${firstName},`)}
    ${emailP("We received a request to reset your TalentStream password. Click below to choose a new one. This link expires in 1&nbsp;hour.")}
    ${emailBtn("Reset password", resetUrl)}
    ${emailNote("If you didn&rsquo;t request this, you can safely ignore this email &mdash; your password won&rsquo;t change.")}
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
  return wrapTemplate(`
    ${emailHeading("Invitation", "You&rsquo;ve been invited")}
    ${emailP(intro)}
    ${emailP("Set up your account to get started. This invitation expires in 7&nbsp;days.")}
    ${emailBtn("Accept invitation", acceptUrl)}
    ${emailFallbackLink(acceptUrl)}
    ${emailNote("If you weren&rsquo;t expecting this invitation, you can safely ignore this email.")}
  `);
}

export function gatingFailedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    ${emailHeading("Application update", "Thank you for applying")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. Unfortunately, your profile does not meet the specific requirements for this role at this time.`)}
    ${emailNote("We encourage you to apply for future opportunities that may be a better fit. We wish you all the best.")}
  `);
}

export function rejectionEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    ${emailHeading("Application update", "Thank you for your interest")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. After careful consideration, we&rsquo;ve decided not to move forward with your application at this time.`)}
    ${emailNote("We appreciate the time you invested and encourage you to keep an eye out for future opportunities. We wish you all the best in your career.")}
  `);
}

export function chatInvitationEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string,
  chatUrl: string
): string {
  return wrapTemplate(`
    ${emailHeading("Next step", "We&rsquo;d like to chat")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP("We have a few follow-up questions about your application. This should only take a few minutes.")}
    ${emailInfoCard([["Role", roleTitle], ["Company", clientName]])}
    ${emailBtn("Start chat", chatUrl)}
    ${emailFallbackLink(chatUrl)}
  `);
}

export function chatAccessEmail(
  candidateName: string,
  roleTitle: string,
  magicLinkUrl: string
): string {
  return wrapTemplate(`
    ${emailHeading("Verification", "Confirm your identity")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`We received a request to access your chat for the <strong>${roleTitle}</strong> application. Click below to verify your identity and continue. This link expires in 1&nbsp;hour.`)}
    ${emailBtn("Verify &amp; continue", magicLinkUrl)}
    ${emailNote("If you didn&rsquo;t request this, you can safely ignore this email.")}
  `);
}

// ── Nudge / no-response / rejection-confirmation templates ─────────

/** Reminder fired partway through the follow-up window for ghost candidates.
 *  Honest, not an ultimatum — frames the close as "we'll assume you're no
 *  longer interested", matching the blameless no_response terminal state. */
export function chatNudgeEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string,
  chatUrl: string,
  closeByDate: string
): string {
  return wrapTemplate(`
    ${emailHeading("Reminder", "We&rsquo;d still love to hear from you")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`We&rsquo;re still interested in your application for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>, but we haven&rsquo;t heard back from our earlier chat invitation.`)}
    ${emailP(`If we don&rsquo;t hear from you by <strong>${closeByDate}</strong>, we&rsquo;ll assume you&rsquo;re no longer interested and close your application for this role.`)}
    ${emailBtn("Continue chat", chatUrl)}
    ${emailFallbackLink(chatUrl)}
  `);
}

/** Terminal email for candidates who never engaged with the follow-up chat.
 *  Blameless by design — no judgment on the candidate, just a statement that
 *  the application is being closed. Kept distinct from rejectionEmail so the
 *  candidate understands no evaluation decision was made. */
export function noResponseEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    ${emailHeading("Application update", "We&rsquo;ve closed your application")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`We reached out with a few follow-up questions about your application for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>, but we haven&rsquo;t heard back &mdash; so we&rsquo;ve closed your application for this role.`)}
    ${emailNote("Thank you for your interest. We wish you the very best in your search and hope to see you apply for a future opportunity.")}
  `);
}

/** Backstop confirmation email after an in-chat rejection has been delivered.
 *  Short and plain — the warmth (such as it is) already happened in the chat.
 *  This exists so the candidate has a written record if they never reopen the
 *  conversation. Admin's optional reason is rendered verbatim after HTML
 *  escaping. */
export function rejectionConfirmationEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string,
  adminReason?: string
): string {
  const cleaned = adminReason?.trim();
  const reasonBlock = cleaned
    ? emailP(`They asked us to share the following note: &ldquo;${escapeHtml(cleaned)}&rdquo;`)
    : "";
  return wrapTemplate(`
    ${emailHeading("Application update", "Confirming our earlier message")}
    ${emailP(`Hi ${candidateName},`)}
    ${emailP(`This is a written confirmation of the message shared with you in your chat: the recruitment team for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong> has decided not to move forward with your application.`)}
    ${reasonBlock}
    ${emailNote("We appreciate the time you invested and wish you the very best in your career.")}
  `);
}
