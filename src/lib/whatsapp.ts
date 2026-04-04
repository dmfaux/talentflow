import { db } from "@/db";
import { candidates, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sendCandidateEmail } from "./email";

/*
 * WATI Template Setup
 * -------------------
 * The following templates must be created and approved in the WATI dashboard:
 *
 * 1. "application_followup" — for asking clarifying questions about a candidate's CV
 *    Parameters: {{1}} = candidate name, {{2}} = question text
 *
 * 2. "application_status" — for general status updates
 *    Parameters: {{1}} = candidate name, {{2}} = role title, {{3}} = status message
 */

function getBaseUrl(): string {
  const url = process.env.WATI_API_URL;
  if (!url) throw new Error("WATI_API_URL is not set");
  return url.replace(/\/$/, "");
}

function getApiKey(): string {
  const key = process.env.WATI_API_KEY;
  if (!key) throw new Error("WATI_API_KEY is not set");
  return key;
}

// ── Send template message ────────────────────────────────────────────

export async function sendWhatsAppMessage(
  phone: string,
  templateName: string,
  templateParams: { name: string; value: string }[],
  candidateId: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${getBaseUrl()}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(phone)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          template_name: templateName,
          broadcast_name: `candidate_${candidateId}`,
          parameters: templateParams,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("WATI API error:", data);
      await db.insert(messages).values({
        candidate_id: candidateId,
        channel: "whatsapp",
        direction: "outbound",
        content: `Template: ${templateName}`,
        template_id: templateName,
        status: "failed",
        external_id: null,
      });
      return null;
    }

    const externalId = data.messageId ?? data.id ?? null;

    await db.insert(messages).values({
      candidate_id: candidateId,
      channel: "whatsapp",
      direction: "outbound",
      content: `Template: ${templateName}`,
      template_id: templateName,
      status: "sent",
      external_id: externalId,
    });

    return externalId;
  } catch (err) {
    console.error("sendWhatsAppMessage exception:", err);
    return null;
  }
}

// ── Follow-up question ───────────────────────────────────────────────

export async function sendFollowUpQuestion(
  candidateId: string
): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, candidateId),
    with: { campaign: { with: { client: true } } },
  });

  if (!candidate) return;

  const flags = candidate.ai_flags as { type?: string; message?: string }[] | string[] | null;
  if (!flags || flags.length === 0) return;

  // Get the first flag as the question basis
  const firstFlag = typeof flags[0] === "string" ? flags[0] : (flags[0] as { message?: string }).message ?? String(flags[0]);
  const questionText = `We noticed something in your application that we'd like to clarify: ${firstFlag}. Could you provide more detail?`;

  if (candidate.whatsapp_opted_in && candidate.phone) {
    // Send via WhatsApp
    await sendWhatsAppMessage(
      candidate.phone,
      "application_followup",
      [
        { name: "1", value: candidate.name },
        { name: "2", value: questionText },
      ],
      candidateId
    );
  } else {
    // Fallback to email
    const roleTitle = candidate.campaign.role_title;
    const clientName = candidate.campaign.client?.name ?? "the company";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;border:1px solid #e8e8e4;">
        <tr><td style="padding:32px 36px;">
          <h2 style="margin:0 0 16px;font-size:20px;color:#1B4332;font-weight:normal;font-style:italic;">Quick Question</h2>
          <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">Hi ${candidate.name},</p>
          <p style="margin:0 0 12px;font-size:15px;color:#1a1a1a;line-height:1.6;">
            Thank you for applying for the <strong>${roleTitle}</strong> position at <strong>${clientName}</strong>.
            ${questionText}
          </p>
          <p style="margin:0;font-size:15px;color:#666;line-height:1.6;">
            Simply reply to this email with your response.
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#999;">Powered by TalentStream</p>
    </td></tr>
  </table>
</body></html>`;

    await sendCandidateEmail(
      candidate.email,
      `Quick question about your application — ${roleTitle}`,
      html,
      candidateId
    );
  }
}
