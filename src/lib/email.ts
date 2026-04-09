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

const FONT_HEADING = "'Trebuchet MS',Arial,Helvetica,sans-serif";
const FONT_BODY = "Arial,Helvetica,sans-serif";

const C = {
  cobalt: "#2c5bff",
  ink: "#11123c",
  inkSoft: "#2f3941",
  secondary: "#5a6b7a",
  muted: "#9fb5c4",
  canvas: "#f0f3f7",
  surface: "#ffffff",
  border: "#d1dce6",
  moss: "#0a8a5a",
  headerMuted: "#5a6b7a",
} as const;

interface TemplateOptions {
  preheaderText: string;
  headerBarColor?: string;
}

function ctaButton(text: string, url: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
      <tr><td align="left">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:46px;v-text-anchor:middle;width:200px;" arcsize="13%" stroke="f" fillcolor="${C.cobalt}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:${FONT_BODY};font-size:15px;font-weight:bold;">${text}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${url}" style="display:inline-block;background-color:${C.cobalt};color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-family:${FONT_BODY};font-size:15px;font-weight:bold;mso-padding-alt:0;text-align:center;">
          ${text}
        </a>
        <!--<![endif]-->
      </td></tr>
    </table>`;
}

function fallbackLink(url: string): string {
  return `
    <p style="margin:12px 0 0;font-family:${FONT_BODY};font-size:13px;color:${C.secondary};line-height:1.5;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${url}" style="color:${C.cobalt};word-break:break-all;text-decoration:underline;">${url}</a>
    </p>`;
}

function infoBox(content: string, borderColor: string = C.cobalt): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
      <tr>
        <td style="background-color:${C.canvas};border-left:3px solid ${borderColor};border-radius:0 4px 4px 0;padding:14px 16px;font-family:${FONT_BODY};font-size:14px;color:${C.ink};line-height:1.5;">
          ${content}
        </td>
      </tr>
    </table>`;
}

function heading(text: string): string {
  return `<h2 style="margin:0 0 20px;font-family:${FONT_HEADING};font-size:22px;font-weight:700;color:${C.ink};letter-spacing:-0.01em;">${text}</h2>`;
}

function greeting(name: string, color: string = C.ink): string {
  return `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:15px;color:${color};line-height:1.6;">Hi ${name},</p>`;
}

function para(text: string, color: string = C.ink): string {
  return `<p style="margin:0 0 14px;font-family:${FONT_BODY};font-size:15px;color:${color};line-height:1.6;">${text}</p>`;
}

function mutedPara(text: string): string {
  return `<p style="margin:0;font-family:${FONT_BODY};font-size:13px;color:${C.secondary};line-height:1.6;">${text}</p>`;
}

function wrapTemplate(body: string, options: TemplateOptions): string {
  const barColor = options.headerBarColor ?? C.cobalt;
  const preheader = options.preheaderText;

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title></title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: #1a1b2e !important; }
      .email-card { background-color: #232440 !important; border-color: #3a3b5c !important; }
      .email-heading { color: #e8e8f0 !important; }
      .email-body { color: #d0d0dc !important; }
      .email-secondary { color: #9090a8 !important; }
      .email-muted { color: #6a6a82 !important; }
      .email-info-box { background-color: #2a2b48 !important; }
      .email-divider { border-color: #3a3b5c !important; }
      .email-brand { color: #5b82ff !important; }
    }
    @media screen and (max-width: 600px) {
      .email-card { width: 100% !important; }
      .email-content { padding-left: 24px !important; padding-right: 24px !important; }
      .email-btn a { display: block !important; width: 100% !important; text-align: center !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${C.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!--[if !mso]><!-->
  <div style="display:none;font-size:1px;color:${C.canvas};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${preheader}${"&#847; &zwnj; &nbsp; ".repeat(30)}
  </div>
  <!--<![endif]-->

  <!--[if mso]><table width="600" cellpadding="0" cellspacing="0" align="center" role="presentation"><tr><td><![endif]-->

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" class="email-bg" style="background-color:${C.canvas};">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" role="presentation" class="email-card" style="background-color:${C.surface};border:1px solid ${C.border};border-radius:8px;max-width:560px;width:100%;">

        <!-- Header bar -->
        <tr><td style="background-color:${barColor};height:6px;border-radius:8px 8px 0 0;font-size:0;line-height:0;" class="email-bar">&nbsp;</td></tr>

        <!-- Brand wordmark -->
        <tr><td style="padding:28px 36px 0;" class="email-content">
          <p style="margin:0;font-family:${FONT_HEADING};font-size:18px;font-weight:700;color:${C.cobalt};letter-spacing:-0.02em;" class="email-brand">TalentStream</p>
        </td></tr>

        <!-- Content -->
        <tr><td style="padding:24px 36px 32px;" class="email-content">
          ${body}
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 36px;" class="email-content">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td class="email-divider" style="border-top:1px solid ${C.border};font-size:0;line-height:0;">&nbsp;</td></tr></table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:16px 36px 24px;" class="email-content">
          <p style="margin:0;font-family:${FONT_BODY};font-size:12px;color:${C.muted};line-height:1.5;" class="email-muted">
            Powered by <span style="color:${C.secondary};">TalentStream</span><br>
            This is an automated message. Please do not reply directly to this email.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>

  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>`;
}

export function applicationReceivedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(
    `${heading("Application Received")}
    ${greeting(candidateName)}
    ${para(`Thank you for applying for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. We've received your application and it is now being processed.`)}
    ${infoBox(`<strong style="color:${C.ink};">Role:</strong> ${roleTitle}<br><strong style="color:${C.ink};">Company:</strong> ${clientName}`)}
    ${para("You'll hear from us soon with an update on the next steps.", C.secondary)}`,
    { preheaderText: `We've received your application for ${roleTitle} at ${clientName}` }
  );
}

export function gatingPassedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(
    `${heading("Good News")}
    ${greeting(candidateName)}
    ${para(`Great news \u2014 you meet the initial requirements for the <strong>${roleTitle}</strong> role at <strong>${clientName}</strong>. Your CV is now being reviewed by our team.`)}
    ${infoBox(`&#10003; <strong style="color:${C.moss};">Initial requirements met</strong><br><span style="color:${C.secondary};">${roleTitle} at ${clientName}</span>`, C.moss)}
    ${para("We'll be in touch with the outcome shortly. Thank you for your patience.", C.secondary)}`,
    { preheaderText: `Great news about your application for ${roleTitle}` }
  );
}

export function passwordResetEmail(
  firstName: string,
  resetUrl: string
): string {
  return wrapTemplate(
    `${heading("Reset Your Password")}
    ${greeting(firstName)}
    ${para("We received a request to reset your TalentStream password. Click the button below to choose a new one.")}
    ${infoBox("This link will expire in <strong>1 hour</strong>.")}
    ${ctaButton("Reset Password", resetUrl)}
    <div style="margin-top:24px;">
      ${mutedPara("If you didn't request this, you can safely ignore this email \u2014 your password won't change.")}
    </div>`,
    { preheaderText: "Reset your TalentStream password" }
  );
}

export function gatingFailedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(
    `${heading("Application Update")}
    ${greeting(candidateName, C.inkSoft)}
    ${para(`Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. Unfortunately, your profile does not meet the specific requirements for this role at this time.`, C.inkSoft)}
    ${para("We encourage you to apply for future opportunities that may be a better fit. We wish you all the best.", C.secondary)}`,
    {
      preheaderText: `Update on your application for ${roleTitle} at ${clientName}`,
      headerBarColor: C.headerMuted,
    }
  );
}

export function rejectionEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(
    `${heading("Application Update")}
    ${greeting(candidateName, C.inkSoft)}
    ${para(`Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. After careful consideration, we've decided not to move forward with your application at this time.`, C.inkSoft)}
    ${para("We appreciate the time you invested in applying and encourage you to keep an eye out for future opportunities. We wish you all the best in your career.", C.secondary)}`,
    {
      preheaderText: `Update on your application for ${roleTitle} at ${clientName}`,
      headerBarColor: C.headerMuted,
    }
  );
}

export function chatInvitationEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string,
  chatUrl: string
): string {
  return wrapTemplate(
    `${heading("We'd Like to Chat")}
    ${greeting(candidateName)}
    ${para(`We have a few follow-up questions about your application for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. This should only take a few minutes.`)}
    ${infoBox(`<strong style="color:${C.ink};">Role:</strong> ${roleTitle}<br><strong style="color:${C.ink};">Company:</strong> ${clientName}`)}
    <div class="email-btn">
      ${ctaButton("Start Chat", chatUrl)}
    </div>
    ${fallbackLink(chatUrl)}`,
    { preheaderText: "We'd like to ask you a few follow-up questions about your application" }
  );
}

export function chatAccessEmail(
  candidateName: string,
  roleTitle: string,
  magicLinkUrl: string
): string {
  return wrapTemplate(
    `${heading("Verify Your Identity")}
    ${greeting(candidateName)}
    ${para(`We received a request to access your chat for the <strong>${roleTitle}</strong> application. Click below to verify your identity and continue the conversation.`)}
    ${infoBox("This link expires in <strong>1 hour</strong>.")}
    <div class="email-btn">
      ${ctaButton("Verify &amp; Continue", magicLinkUrl)}
    </div>
    <div style="margin-top:24px;">
      ${mutedPara("If you didn't request this, you can safely ignore this email.")}
    </div>`,
    { preheaderText: "Verify your identity to access your chat" }
  );
}
