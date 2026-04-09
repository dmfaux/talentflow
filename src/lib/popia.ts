import { db } from "@/db";
import { candidates, messages, scoringLogs, campaigns, clients } from "@/db/schema";
import { and, eq, isNull, lte } from "drizzle-orm";
import { deleteCV } from "./azure-storage";

// ── Purge a single candidate's PII ──────────────────────────────────

export async function purgeCandidateData(candidateId: string): Promise<void> {
  const candidate = await db.query.candidates.findFirst({
    where: eq(candidates.id, candidateId),
    columns: { id: true, cv_url: true, purged_at: true },
  });

  if (!candidate || candidate.purged_at) return;

  // Delete CV from Azure
  if (candidate.cv_url) {
    try {
      await deleteCV(candidate.cv_url);
    } catch (err) {
      console.error(`purgeCandidateData: failed to delete CV for ${candidateId}:`, err);
    }
  }

  // Delete messages and scoring logs (contain PII in content/prompts)
  await db.delete(messages).where(eq(messages.candidate_id, candidateId));
  await db.delete(scoringLogs).where(eq(scoringLogs.candidate_id, candidateId));

  // Nullify PII fields, keep analytics data
  await db
    .update(candidates)
    .set({
      name: "Purged",
      email: "purged@removed.com",
      phone: null,
      cv_url: null,
      cv_text: null,
      follow_up_notes: null,
      shortlist_notes: null,
      ai_rationale: null,
      purged_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(candidates.id, candidateId));

  console.log(`purgeCandidateData: purged candidate ${candidateId}`);
}

// ── POPIA access request ────────────────────────────────────────────

export async function handleDataAccessRequest(email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  const records = await db.query.candidates.findMany({
    where: eq(candidates.email, normalizedEmail),
    with: {
      campaign: {
        columns: { role_title: true, slug: true },
        with: { client: { columns: { name: true, slug: true } } },
      },
      messages: {
        columns: { channel: true, direction: true, content: true, created_at: true },
      },
      scoringLogs: {
        columns: {
          score: true, dimensions: true, confidence: true,
          rationale: true, flags: true, recommendation: true,
          scoring_type: true, created_at: true,
        },
      },
    },
  });

  if (records.length === 0) return null;

  return {
    email: normalizedEmail,
    records: records.map((r) => ({
      candidate_id: r.id,
      campaign: {
        role_title: r.campaign.role_title,
        slug: r.campaign.slug,
        client_name: r.campaign.client?.name ?? null,
        client_slug: r.campaign.client?.slug ?? null,
      },
      personal_data: {
        name: r.name,
        email: r.email,
        phone: r.phone,
      },
      application_data: {
        gating_answers: r.gating_answers,
        gating_passed: r.gating_passed,
        status: r.status,
        source: r.source,
        applied_at: r.created_at,
      },
      ai_assessment: {
        score: r.ai_score,
        dimensions: r.ai_dimensions,
        confidence: r.ai_confidence,
        rationale: r.ai_rationale,
        flags: r.ai_flags,
      },
      ai_assessment_history: r.scoringLogs
        ?.filter((l) => l.score !== null)
        .map((l) => ({
          score: l.score,
          dimensions: l.dimensions,
          confidence: l.confidence,
          rationale: l.rationale,
          flags: l.flags,
          recommendation: l.recommendation,
          scoring_type: l.scoring_type,
          assessed_at: l.created_at,
        })) ?? [],
      messages: r.messages.map((m) => ({
        channel: m.channel,
        direction: m.direction,
        content: m.content,
        sent_at: m.created_at,
      })),
      consent: {
        popia_consent_at: r.popia_consent_at,
        data_purge_at: r.data_purge_at,
        purged_at: r.purged_at,
      },
    })),
    retrieved_at: new Date().toISOString(),
  };
}

// ── POPIA deletion request ──────────────────────────────────────────

export async function handleDataDeletionRequest(
  email: string
): Promise<{ purged: number }> {
  const normalizedEmail = email.trim().toLowerCase();

  const records = await db.query.candidates.findMany({
    where: and(
      eq(candidates.email, normalizedEmail),
      isNull(candidates.purged_at)
    ),
    columns: { id: true },
  });

  for (const record of records) {
    await purgeCandidateData(record.id);
  }

  return { purged: records.length };
}

// ── Scheduled purge of expired data ─────────────────────────────────

// TODO: Set up a cron job to call this function periodically.
// Options: Azure Container Apps scheduled task, Vercel cron,
// or a Next.js API route called by an external cron service.

export async function findAndPurgeExpiredCandidates(): Promise<{ purged: number }> {
  const now = new Date();

  const expired = await db.query.candidates.findMany({
    where: and(
      lte(candidates.data_purge_at, now),
      isNull(candidates.purged_at)
    ),
    columns: { id: true },
  });

  for (const record of expired) {
    await purgeCandidateData(record.id);
  }

  console.log(`findAndPurgeExpiredCandidates: purged ${expired.length} records`);
  return { purged: expired.length };
}
