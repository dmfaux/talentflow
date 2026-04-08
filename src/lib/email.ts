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

function wrapTemplate(body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e8e4;">
        <tr><td style="padding:32px 36px;">
          ${body}
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999;">
        Powered by TalentStream
      </p>
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
    <h2 style="margin:0 0 16px;font-size:20px;color:#1B4332;font-weight:normal;font-style:italic;">
      Application Received
    </h2>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Hi ${candidateName},
    </p>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Thank you for applying for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. We've received your application and it is now being processed.
    </p>
    <p style="margin:0;font-size:15px;color:#666;line-height:1.6;">
      You'll hear from us soon with an update on the next steps.
    </p>
  `);
}

export function gatingPassedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1B4332;font-weight:normal;font-style:italic;">
      Application Update
    </h2>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Hi ${candidateName},
    </p>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Great news — you meet the initial requirements for the <strong>${roleTitle}</strong> role at <strong>${clientName}</strong>. Your CV is now being reviewed by our team.
    </p>
    <p style="margin:0;font-size:15px;color:#666;line-height:1.6;">
      We'll be in touch with the outcome shortly. Thank you for your patience.
    </p>
  `);
}

export function passwordResetEmail(
  firstName: string,
  resetUrl: string
): string {
  return wrapTemplate(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1B4332;font-weight:normal;font-style:italic;">
      Reset your password
    </h2>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Hi ${firstName},
    </p>
    <p style="margin:0 0 16px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      We received a request to reset your TalentStream password. Click the button below to choose a new one. This link will expire in 1 hour.
    </p>
    <p style="margin:0 0 24px;">
      <a href="${resetUrl}" style="display:inline-block;background:#0c0c0e;color:#fafaf7;text-decoration:none;padding:12px 20px;border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:500;">
        Reset password
      </a>
    </p>
    <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
      If you didn't request this, you can safely ignore this email — your password won't change.
    </p>
  `);
}

export function gatingFailedEmail(
  candidateName: string,
  roleTitle: string,
  clientName: string
): string {
  return wrapTemplate(`
    <h2 style="margin:0 0 16px;font-size:20px;color:#1B4332;font-weight:normal;font-style:italic;">
      Application Update
    </h2>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Hi ${candidateName},
    </p>
    <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
      Thank you for your interest in the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>. Unfortunately, your profile does not meet the specific requirements for this role at this time.
    </p>
    <p style="margin:0;font-size:15px;color:#666;line-height:1.6;">
      We encourage you to apply for future opportunities that may be a better fit. We wish you all the best.
    </p>
  `);
}
