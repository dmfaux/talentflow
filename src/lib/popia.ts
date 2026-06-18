import { db } from "@/db";
import {
  campaigns,
  candidates,
  chatMessages,
  chatTokens,
  clients,
  conversations,
  messages,
  organizations,
  scoringLogs,
} from "@/db/schema";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { deleteCV, deleteOrgBlobsByPrefix } from "./azure-storage";

/** Org-scope predicate for the by-email/expiry POPIA queries. Mirrors
 *  orgScope's null-semantics: a non-acting operator (orgId null) matches
 *  nothing rather than every org. Tenant routes pass ctx.effectiveOrgId so a
 *  purge/lookup can never reach another org's candidates. */
function orgFilter(orgId: string | null) {
  return orgId ? eq(candidates.org_id, orgId) : sql`false`;
}

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

  // Delete chat PII (S11). Since chat replaced WhatsApp it is now THE candidate
  // PII channel: conversation transcripts (chat_messages), the conversations,
  // and the magic-link auth tokens (chat_tokens). FK-safe order — chat_messages
  // is a child of conversations, so delete the messages first (by the
  // candidate's conversation set), then the conversations, then the tokens.
  await db
    .delete(chatMessages)
    .where(
      inArray(
        chatMessages.conversation_id,
        db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.candidate_id, candidateId))
      )
    );
  await db.delete(conversations).where(eq(conversations.candidate_id, candidateId));
  await db.delete(chatTokens).where(eq(chatTokens.candidate_id, candidateId));

  // Nullify PII fields, keep analytics data. The persistent SHA-256
  // chat_token_hash on the candidate is also a PII credential — clear it.
  await db
    .update(candidates)
    .set({
      name: "Purged",
      email: "purged@removed.com",
      phone: null,
      cv_url: null,
      cv_text: null,
      chat_token_hash: null,
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

export async function handleDataAccessRequest(
  email: string,
  orgId: string | null
) {
  const normalizedEmail = email.trim().toLowerCase();

  const records = await db.query.candidates.findMany({
    where: and(eq(candidates.email, normalizedEmail), orgFilter(orgId)),
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
      // Chat is now the primary PII channel (replaced WhatsApp) — include the
      // transcripts in the POPIA "access" export for completeness (S11).
      conversations: {
        columns: { id: true, lifecycle: true, status: true, created_at: true },
        with: {
          chatMessages: {
            columns: { role: true, content: true, created_at: true },
          },
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
      chat_conversations: r.conversations.map((c) => ({
        conversation_id: c.id,
        lifecycle: c.lifecycle,
        status: c.status,
        started_at: c.created_at,
        messages: c.chatMessages.map((cm) => ({
          role: cm.role,
          content: cm.content,
          sent_at: cm.created_at,
        })),
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
  email: string,
  orgId: string | null
): Promise<{ purged: number }> {
  const normalizedEmail = email.trim().toLowerCase();

  const records = await db.query.candidates.findMany({
    where: and(
      eq(candidates.email, normalizedEmail),
      isNull(candidates.purged_at),
      orgFilter(orgId)
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

export async function findAndPurgeExpiredCandidates(
  orgId: string | null
): Promise<{ purged: number }> {
  const now = new Date();

  const expired = await db.query.candidates.findMany({
    where: and(
      lte(candidates.data_purge_at, now),
      isNull(candidates.purged_at),
      orgFilter(orgId)
    ),
    columns: { id: true },
  });

  for (const record of expired) {
    await purgeCandidateData(record.id);
  }

  console.log(`findAndPurgeExpiredCandidates: purged ${expired.length} records`);
  return { purged: expired.length };
}

// ── Org-complete hard purge (S11) ───────────────────────────────────
//
// The operator-only, irreversible tenant deletion (gated on status='deleted' +
// typed-slug confirmation in the route). Every org-scoped table has org_id
// NOT NULL with onDelete: cascade from organizations, so a SINGLE
// DELETE FROM organizations cascades the whole tenant (clients, campaigns,
// candidates, scoring_logs, conversations, chat_messages, chat_tokens,
// messages, events, invitations, memberships via FK chains, org-scoped users,
// org-scoped jobs, usage_events) — leaving ZERO org rows. An explicit FK-safe
// teardown is the documented fallback only if a cascade is ever lost.
//
// Survivors by design: operators (users.org_id NULL), global jobs (jobs.org_id
// NULL), and operator_audit rows (target_org_id SET NULL → the route's metadata
// snapshot keeps the purge_org audit queryable). Returns the pre-cascade counts
// for the audit metadata.
export async function purgeOrganizationData(
  orgId: string
): Promise<{ counts: { brands: number; campaigns: number; candidates: number } }> {
  // Snapshot counts BEFORE the cascade — for the operator_audit metadata.
  const [[brandCount], [campaignCount], [candidateCount]] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(clients).where(eq(clients.org_id, orgId)),
    db.select({ total: sql<number>`count(*)::int` }).from(campaigns).where(eq(campaigns.org_id, orgId)),
    db.select({ total: sql<number>`count(*)::int` }).from(candidates).where(eq(candidates.org_id, orgId)),
  ]);

  // Wipe blobs by prefix (external system, outside the DB cascade). Keys off
  // cvs/{orgId}/** and logos/{orgId}/**, so it needs no row values; safe no-op
  // when storage is unconfigured. The DB delete remains the "zero rows" oracle.
  await deleteOrgBlobsByPrefix(orgId, "cv");
  await deleteOrgBlobsByPrefix(orgId, "logo");

  // One cascade delete wipes every org-scoped row.
  await db.delete(organizations).where(eq(organizations.id, orgId));

  console.log(`purgeOrganizationData: purged org ${orgId}`);
  return {
    counts: {
      brands: brandCount.total,
      campaigns: campaignCount.total,
      candidates: candidateCount.total,
    },
  };
}
