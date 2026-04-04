import { db } from "@/db";
import { candidates, messages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    // TODO: Validate webhook signature using WATI_WEBHOOK_SECRET
    // WATI's webhook signing mechanism should be verified here once
    // their documentation confirms the signature format.

    const body = await request.json();

    // WATI webhook payload structure
    const phone = body.waId ?? body.senderPhoneNumber ?? body.from;
    const text = body.text ?? body.message ?? body.body ?? "";
    const externalId = body.messageId ?? body.id ?? null;

    if (!phone || !text) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // Normalize phone: strip leading + and spaces
    const normalizedPhone = phone.replace(/[^0-9]/g, "");

    // Look up candidate by phone number
    const candidate = await db.query.candidates.findFirst({
      where: eq(candidates.phone, phone),
      columns: { id: true, follow_up_notes: true },
    });

    // Try with normalized number if no match
    const matched =
      candidate ??
      (await db.query.candidates.findFirst({
        where: eq(candidates.phone, normalizedPhone),
        columns: { id: true, follow_up_notes: true },
      }));

    if (!matched) {
      // Unknown sender — log but don't error
      console.warn(`WhatsApp webhook: no candidate found for phone ${phone}`);
      return NextResponse.json({ ok: true });
    }

    // Log inbound message
    await db.insert(messages).values({
      candidate_id: matched.id,
      channel: "whatsapp",
      direction: "inbound",
      content: text,
      status: "delivered",
      external_id: externalId,
    });

    // Append to follow-up notes
    const timestamp = new Date().toISOString();
    const noteEntry = `[${timestamp}] WhatsApp: ${text}`;
    const existingNotes = matched.follow_up_notes ?? "";
    const updatedNotes = existingNotes
      ? `${existingNotes}\n${noteEntry}`
      : noteEntry;

    await db
      .update(candidates)
      .set({
        follow_up_notes: updatedNotes,
        updated_at: new Date(),
      })
      .where(eq(candidates.id, matched.id));

    // TODO: Automated re-scoring — when a candidate's WhatsApp reply
    // resolves an AI flag, we could trigger a re-score with the new
    // context appended to the CV text. For now, the admin reviews
    // follow_up_notes manually and decides whether to re-score.

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("WhatsApp webhook error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
