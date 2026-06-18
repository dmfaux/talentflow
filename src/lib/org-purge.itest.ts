import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Seam mock ────────────────────────────────────────────────────────
// Operator session for the purge route; everything else runs for real.
const sessionHolder = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => sessionHolder.current,
    getActAsClaim: async () => null,
    getActiveBrandCookie: async () => null,
  };
});

import { db } from "@/db";
import {
  campaigns,
  candidates,
  chatMessages,
  chatTokens,
  clients,
  conversations,
  events,
  invitations,
  jobs,
  memberships,
  messages,
  operatorAudit,
  organizations,
  scoringLogs,
  usageEvents,
  users,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { NextRequest } from "next/server";

import { purgeCandidateData, purgeOrganizationData } from "@/lib/popia";
import { POST as purgeRoute } from "@/app/api/operator/organizations/[id]/purge/route";

const RUN = !!process.env.DATABASE_URL;

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.4" },
    body: JSON.stringify(body),
  });
}
const idParam = (id: string) => ({ params: Promise.resolve({ id }) });
const countWhere = async (
  table: PgTable & { org_id: AnyPgColumn },
  orgId: string
): Promise<number> => {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.org_id, orgId));
  return row.n;
};

const fx = {
  orgA: "",
  orgB: "",
  brandA: "",
  campaignA: "",
  candA: "",
  brandMemberA: "",
  operator: "",
  candB: "",
};

async function seed() {
  await db.delete(operatorAudit);
  await db.delete(jobs);
  await db.delete(usageEvents);
  await db.delete(candidates);
  await db.delete(campaigns);
  await db.delete(memberships);
  await db.delete(invitations);
  await db.delete(users);
  await db.delete(clients);
  await db.delete(organizations);

  [fx.orgA, fx.orgB] = (
    await db
      .insert(organizations)
      .values([
        { slug: "org-a", name: "Org A" },
        { slug: "org-b", name: "Org B" },
      ])
      .returning({ id: organizations.id })
  ).map((o) => o.id);

  [fx.brandA] = (
    await db
      .insert(clients)
      .values({ org_id: fx.orgA, slug: "brand-a", name: "Brand A" })
      .returning({ id: clients.id })
  ).map((c) => c.id);
  const [brandB] = await db
    .insert(clients)
    .values({ org_id: fx.orgB, slug: "brand-b", name: "Brand B" })
    .returning({ id: clients.id });

  [fx.campaignA] = (
    await db
      .insert(campaigns)
      .values({
        org_id: fx.orgA,
        client_id: fx.brandA,
        slug: "campaign-a",
        role_title: "Role A",
        status: "active",
        gating_config: [],
        scoring_rubric: {},
      })
      .returning({ id: campaigns.id })
  ).map((c) => c.id);
  const [campaignB] = await db
    .insert(campaigns)
    .values({
      org_id: fx.orgB,
      client_id: brandB.id,
      slug: "campaign-b",
      role_title: "Role B",
      status: "active",
      gating_config: [],
      scoring_rubric: {},
    })
    .returning({ id: campaigns.id });

  [fx.candA] = (
    await db
      .insert(candidates)
      .values({
        org_id: fx.orgA,
        campaign_id: fx.campaignA,
        name: "Cand A",
        email: "cand-a@applicant.test",
        chat_token_hash: "deadbeef",
        status: "follow_up",
      })
      .returning({ id: candidates.id })
  ).map((c) => c.id);
  const [cb] = await db
    .insert(candidates)
    .values({
      org_id: fx.orgB,
      campaign_id: campaignB.id,
      name: "Cand B",
      email: "cand-b@applicant.test",
      status: "new",
    })
    .returning({ id: candidates.id });
  fx.candB = cb.id;

  // Chat PII for cand A.
  const [conv] = await db
    .insert(conversations)
    .values({ org_id: fx.orgA, candidate_id: fx.candA })
    .returning({ id: conversations.id });
  await db.insert(chatMessages).values([
    { org_id: fx.orgA, conversation_id: conv.id, role: "user", content: "hi" },
    { org_id: fx.orgA, conversation_id: conv.id, role: "assistant", content: "hello" },
  ]);
  await db.insert(chatTokens).values({
    org_id: fx.orgA,
    candidate_id: fx.candA,
    token_hash: "tok-hash",
    expires_at: new Date(Date.now() + 3600_000),
  });
  await db.insert(messages).values({
    org_id: fx.orgA,
    candidate_id: fx.candA,
    channel: "email",
    direction: "outbound",
    content: "msg",
  });
  await db.insert(scoringLogs).values({
    org_id: fx.orgA,
    candidate_id: fx.candA,
    model_version: "test",
    full_prompt: "p",
    full_response: "r",
  });
  await db.insert(events).values({
    org_id: fx.orgA,
    campaign_id: fx.campaignA,
    event_type: "view",
    session_id: "s1",
  });
  await db.insert(usageEvents).values({ org_id: fx.orgA, kind: "candidate_created" });

  // Org-scoped users + a brand membership (cascades via the client).
  const [member] = await db
    .insert(users)
    .values({
      org_id: fx.orgA,
      client_id: fx.brandA,
      org_role: null,
      is_operator: false,
      first_name: "Mem",
      last_name: "A",
      email: "member@org-a.test",
      password_hash: "x",
      security_group: "user",
    })
    .returning({ id: users.id });
  fx.brandMemberA = member.id;
  await db
    .insert(memberships)
    .values({ user_id: member.id, client_id: fx.brandA, brand_role: "recruiter" });
  await db.insert(invitations).values({
    org_id: fx.orgA,
    email: "invitee@org-a.test",
    token_hash: "inv-hash",
    org_role: "org_admin",
    expires_at: new Date(Date.now() + 3600_000),
  });

  // Survivors-by-design: an operator (org_id NULL) + a global job (org_id NULL).
  const [op] = await db
    .insert(users)
    .values({
      org_id: null,
      org_role: null,
      is_operator: true,
      first_name: "Ops",
      last_name: "User",
      email: "operator@ops.test",
      password_hash: "x",
      security_group: "admin",
    })
    .returning({ id: users.id });
  fx.operator = op.id;
  await db.insert(jobs).values({ type: "global-tick", payload: { type: "global-tick" }, org_id: null });
  // An org-scoped job (must be cascaded).
  await db.insert(jobs).values({
    type: "candidate-processing",
    payload: { type: "candidate-processing", candidateId: fx.candA },
    org_id: fx.orgA,
  });
}

describe.skipIf(!RUN)("S11 POPIA chat purge + org cascade (DB-backed)", () => {
  beforeEach(async () => {
    await seed();
    sessionHolder.current = null;
  });

  it("purgeCandidateData deletes chat PII + anonymises the candidate", async () => {
    await purgeCandidateData(fx.candA);

    const counts = await Promise.all([
      countWhere(conversations, fx.orgA),
      countWhere(chatMessages, fx.orgA),
      db.select({ n: sql<number>`count(*)::int` }).from(chatTokens).where(eq(chatTokens.candidate_id, fx.candA)),
      db.select({ n: sql<number>`count(*)::int` }).from(messages).where(eq(messages.candidate_id, fx.candA)),
      db.select({ n: sql<number>`count(*)::int` }).from(scoringLogs).where(eq(scoringLogs.candidate_id, fx.candA)),
    ]);
    expect(counts[0]).toBe(0); // conversations
    expect(counts[1]).toBe(0); // chat_messages
    expect(counts[2][0].n).toBe(0); // chat_tokens
    expect(counts[3][0].n).toBe(0); // messages
    expect(counts[4][0].n).toBe(0); // scoring_logs

    const cand = await db.query.candidates.findFirst({
      where: eq(candidates.id, fx.candA),
    });
    expect(cand?.purged_at).toBeTruthy();
    expect(cand?.name).toBe("Purged");
    expect(cand?.email).toBe("purged@removed.com");
    expect(cand?.chat_token_hash).toBeNull();
  });

  it("purgeOrganizationData leaves zero org rows; survivors + org B intact", async () => {
    await purgeOrganizationData(fx.orgA);

    // Every org-scoped table has zero rows for org A.
    for (const table of [
      clients,
      campaigns,
      candidates,
      conversations,
      chatMessages,
      chatTokens,
      messages,
      scoringLogs,
      events,
      usageEvents,
      invitations,
    ]) {
      expect(await countWhere(table, fx.orgA)).toBe(0);
    }
    expect(await countWhere(jobs, fx.orgA)).toBe(0); // org-scoped job cascaded
    expect(await countWhere(users, fx.orgA)).toBe(0); // org-scoped users cascaded

    // The org row itself is gone.
    expect(
      await db.query.organizations.findFirst({ where: eq(organizations.id, fx.orgA) })
    ).toBeUndefined();

    // The brand membership cascaded with its client.
    const mem = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(eq(memberships.user_id, fx.brandMemberA));
    expect(mem[0].n).toBe(0);

    // Survivors: operator (org_id NULL) + global job (org_id NULL).
    expect(
      await db.query.users.findFirst({ where: eq(users.id, fx.operator) })
    ).toBeTruthy();
    const globalJobs = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(sql`${jobs.org_id} IS NULL`);
    expect(globalJobs[0].n).toBeGreaterThanOrEqual(1);

    // Org B fully intact.
    expect(await countWhere(clients, fx.orgB)).toBe(1);
    expect(await countWhere(candidates, fx.orgB)).toBe(1);
  });

  it("purge route (deleted + slug) wipes the org and leaves a durable audit row", async () => {
    // Soft-delete first (the interlock), then operator purges with the slug.
    await db.update(organizations).set({ status: "deleted" }).where(eq(organizations.id, fx.orgA));
    sessionHolder.current = {
      userId: fx.operator,
      orgId: null,
      orgRole: null,
      isOperator: true,
    };

    const res = await purgeRoute(jsonReq({ confirm: "org-a" }), idParam(fx.orgA));
    expect(res.status).toBe(200);

    expect(
      await db.query.organizations.findFirst({ where: eq(organizations.id, fx.orgA) })
    ).toBeUndefined();

    // The purge_org audit survives: target_org_id nulled by the cascade, but
    // metadata.slug/name keep it queryable (Decision C).
    const audit = await db.query.operatorAudit.findFirst({
      where: eq(operatorAudit.action, "purge_org"),
    });
    expect(audit).toBeTruthy();
    expect(audit?.target_org_id).toBeNull();
    expect((audit?.metadata as { slug?: string } | null)?.slug).toBe("org-a");
  });
});
