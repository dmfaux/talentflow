import { db } from "@/db";
import { messages } from "@/db/schema";

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
    html: string
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
        async send(from, to, subject, html) {
          const { data, error } = await client.emails.send({
            from,
            to,
            subject,
            html,
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
        async send(from, to, subject, html) {
          const info = await transporter.sendMail({ from, to, subject, html });
          return { id: info.messageId ?? null, error: null };
        },
      };
    }
  }
  return _transport;
}

const FROM =
  process.env.EMAIL_FROM ?? "TalentStream <apply@talentstream.co.za>";

// ── Send email ───────────────────────────────────────────────────────

export async function sendTransactionalEmail(
  to: string,
  subject: string,
  htmlBody: string
): Promise<string | null> {
  try {
    const { id, error } = await getTransport().send(FROM, to, subject, htmlBody);

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
  candidateId: string
): Promise<string | null> {
  try {
    const { id, error } = await getTransport().send(FROM, to, subject, htmlBody);

    if (error) {
      console.error("sendCandidateEmail error:", error);
    }

    await db.insert(messages).values({
      candidate_id: candidateId,
      channel: "email",
      direction: "outbound",
      content: subject,
      status: error ? "failed" : "sent",
      external_id: id,
    });

    return id;
  } catch (err) {
    console.error("sendCandidateEmail exception:", err);
    return null;
  }
}

// ── Email templates ──────────────────────────────────────────────────

/* Warm parchment + deep forest + copper accent palette */
const C = {
  bg: "#f0ece4",
  card: "#ffffff",
  brand: "#1a3a2a",
  accent: "#b8875a",
  text: "#2c2c2c",
  muted: "#7a756d",
  faint: "#a09a90",
  border: "#e8e3da",
  infoBg: "#f9f7f3",
} as const;

function emailHeading(label: string, title: string): string {
  return `
    <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:${C.accent};font-weight:600;">${label}</p>
    <h1 style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:26px;color:${C.brand};font-weight:normal;line-height:1.3;">${title}</h1>`;
}

function emailP(html: string, last = false): string {
  return `<p style="margin:0${last ? "" : " 0 16px"};font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${C.text};line-height:1.65;">${html}</p>`;
}

function emailNote(html: string): string {
  return `<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:${C.muted};line-height:1.6;">${html}</p>`;
}

function emailBtn(text: string, url: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;">
      <tr><td style="background-color:${C.brand};border-radius:6px;">
        <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:600;letter-spacing:0.02em;">${text}&ensp;&#8594;</a>
      </td></tr>
    </table>`;
}

function emailInfoCard(items: [string, string][]): string {
  const rows = items
    .map(
      ([label, value], i) => `
    <p style="margin:0 0 2px;font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${C.muted};">${label}</p>
    <p style="margin:0${i < items.length - 1 ? " 0 14px" : ""};font-family:Georgia,'Times New Roman',serif;font-size:17px;color:${C.text};">${value}</p>`
    )
    .join("");

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;">
      <tr>
        <td width="3" style="background-color:${C.accent};border-radius:2px 0 0 2px;"></td>
        <td style="padding:16px 20px;background-color:${C.infoBg};">
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
  return `<p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${C.muted};line-height:1.5;">
    If the button doesn&rsquo;t work, copy this link into your browser:<br>
    <a href="${url}" style="color:${C.brand};word-break:break-all;text-decoration:underline;">${url}</a>
  </p>`;
}

function wrapTemplate(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>TalentStream</title>
</head>
<body style="margin:0;padding:0;background-color:${C.bg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.bg};">
    <tr><td align="center" style="padding:48px 16px;">

      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
        <!-- Top accent bar -->
        <tr><td style="height:4px;background-color:${C.brand};border-radius:4px 4px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Card -->
        <tr><td style="background:${C.card};border-left:1px solid ${C.border};border-right:1px solid ${C.border};">

          <!-- Brand header -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:24px 40px;border-bottom:1px solid ${C.border};">
              <span style="font-family:Georgia,'Times New Roman',serif;font-size:13px;letter-spacing:0.14em;color:${C.brand};text-transform:uppercase;">TalentStream</span>
            </td></tr>
          </table>

          <!-- Body -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:36px 40px 40px;">
              ${body}
            </td></tr>
          </table>

        </td></tr>

        <!-- Bottom accent bar -->
        <tr><td style="height:2px;background-color:${C.brand};border-radius:0 0 4px 4px;font-size:0;line-height:0;">&nbsp;</td></tr>
      </table>

      <!-- Footer -->
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;">
        <tr><td style="padding:20px 40px;text-align:center;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${C.faint};line-height:1.5;">
            Sent by TalentStream&ensp;&middot;&ensp;Automated message &mdash; please do not reply
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
