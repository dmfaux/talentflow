import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Seams ────────────────────────────────────────────────────────────
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
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({ enqueue: async () => {} }),
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return { ...actual, sendCandidateEmail: async () => "msg_test" };
});
vi.mock("@/lib/azure-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azure-storage")>();
  return { ...actual, uploadCV: async () => null, deleteCV: async () => {} };
});
vi.mock("@/lib/spend-ceiling", () => ({
  getCeilingStatus: async () => ({ over: false }),
}));
vi.mock("@/lib/org-status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/org-status")>();
  return { ...actual, getOrgStatus: async () => "active" };
});

import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  campaigns,
  candidateActionAudit,
  candidates,
  chatMessages,
  clients,
  organizations,
  users,
} from "@/db/schema";
import { verifyMagicLinkToken } from "@/lib/chat-auth";
import { CURRENT_ATTESTATION } from "@/lib/consent";
import {
  addCandidateByInvite,
  addCandidateBySkip,
} from "@/lib/manual-candidate";
import { POST as applyPost } from "@/app/api/apply/[clientSlug]/[campaignSlug]/route";
import { POST as optOutPost } from "@/app/api/candidates/opt-out/route";
import { POST as resendPost } from "@/app/api/admin/candidates/[id]/resend-invite/route";
import { GET as exportGet } from "@/app/api/admin/candidates/[id]/audit/export/route";
import { GET as statusGet } from "@/app/api/candidates/status/route";
import { createConversation } from "@/lib/chat";
import { eq } from "drizzle-orm";

const RUN = !!process.env.DATABASE_URL;
const fx = { orgA: "", brandA: "", campA: "", owner: "" };

const GATING_CONFIG = [
  {
    id: "eligible",
    label: "Eligible?",
    type: "select",
    options: [{ value: "yes" }, { value: "no" }],
    pass_criteria: ["yes"],
  },
];
const FULL_RUBRIC = {
  must_haves: ["TypeScript"],
  nice_to_haves: [],
  dealbreakers: [],
  dimension_weights: { skills: 25, experience: 25, progression: 25, tenure: 25 },
  min_score: 5,
};
const CONSENT = { version: CURRENT_ATTESTATION, basis: "verbal" as const, note: null };

const candidateRow = (id: string) =>
  db.query.candidates.findFirst({ where: eq(candidates.id, id) });
const auditActions = async (id: string) =>
  (
    await db
      .select({ action: candidateActionAudit.action })
      .from(candidateActionAudit)
      .where(eq(candidateActionAudit.candidate_id, id))
  ).map((r) => r.action);

const asOwner = () => {
  sessionHolder.current = {
    userId: fx.owner,
    orgId: fx.orgA,
    orgRole: "owner",
    isOperator: false,
  };
};

function skipInput(email: string) {
  return {
    orgId: fx.orgA,
    campaignId: fx.campA,
    actorUserId: fx.owner,
    name: "Skip Person",
    email,
    cvText: "Experienced engineer.",
    cvProvenance: "paste" as const,
    gatingAnswers: null,
    gatingConfig: GATING_CONFIG,
    consent: CONSENT,
  };
}

describe.skipIf(!RUN)("recruiter-add endpoints (DB-backed)", () => {
  let clientSlug = "";
  let campaignSlug = "";

  beforeAll(async () => {
    await db.delete(organizations);
    [fx.orgA] = (
      await db
        .insert(organizations)
        .values({ slug: "end-org", name: "End Org" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "end-brand", name: "End Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.campA] = (
      await db
        .insert(campaigns)
        .values({
          org_id: fx.orgA,
          client_id: fx.brandA,
          slug: "end-camp",
          role_title: "Engineer",
          status: "active",
          gating_config: GATING_CONFIG,
          scoring_rubric: FULL_RUBRIC,
        })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.owner] = (
      await db
        .insert(users)
        .values({
          org_id: fx.orgA,
          org_role: "owner",
          first_name: "Olga",
          last_name: "Owner",
          email: "olga@example.com",
          password_hash: "x",
        })
        .returning({ id: users.id })
    ).map((u) => u.id);
    clientSlug = "end-brand";
    campaignSlug = "end-camp";
  });

  beforeEach(() => {
    sessionHolder.current = null;
  });

  const applyParams = () => ({
    params: Promise.resolve({ clientSlug, campaignSlug }),
  });
  const applyReq = (body: unknown) =>
    new NextRequest("http://localhost/api/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("invite completion upgrades the stub to a real applicant", async () => {
    const stub = await addCandidateByInvite({
      orgId: fx.orgA,
      campaignId: fx.campA,
      actorUserId: fx.owner,
      name: "Stub",
      email: "stub@example.com",
    });

    const res = await applyPost(
      applyReq({
        name: "Real Name",
        email: "stub@example.com",
        popia_consent: true,
        answers: { eligible: "yes" },
        invite_token: stub.inviteTokenRaw,
      }),
      applyParams()
    );
    expect(res.status).toBe(201);

    const c = await candidateRow(stub.candidateId);
    expect(c?.status).toBe("gating_passed");
    expect(c?.popia_consent_at).not.toBeNull(); // real first-party consent
    expect(c?.source).toBe("recruiter_manual"); // not overwritten
    expect(c?.gating_source).toBeNull(); // candidate self-answered
    expect(c?.invite_expires_at).toBeNull();

    // No second candidate row was created for this email.
    const all = await db
      .select({ id: candidates.id })
      .from(candidates)
      .where(eq(candidates.email, "stub@example.com"));
    expect(all).toHaveLength(1);

    // Token is now consumed.
    expect(await verifyMagicLinkToken(stub.inviteTokenRaw, { consume: false })).toBeNull();
  });

  it("invite completion rejects an invalid/expired token with 410", async () => {
    const res = await applyPost(
      applyReq({
        name: "Nope",
        email: "nope@example.com",
        popia_consent: true,
        answers: { eligible: "yes" },
        invite_token: "deadbeef-not-a-real-token",
      }),
      applyParams()
    );
    expect(res.status).toBe(410);
  });

  it("opt-out withdraws and purges the candidate, audited", async () => {
    const added = await addCandidateBySkip(skipInput("optout@example.com"));

    const res = await optOutPost(
      new NextRequest(
        `http://localhost/api/candidates/opt-out?t=${added.chatTokenRaw}`,
        { method: "POST" }
      )
    );
    expect(res.status).toBe(200);

    const c = await candidateRow(added.candidateId);
    expect(c?.status).toBe("withdrawn");
    expect(c?.purged_at).not.toBeNull();
    expect(c?.email).toBe("purged@removed.com"); // PII scrubbed by purge
    expect(await auditActions(added.candidateId)).toContain("opt_out");
  });

  it("resend-invite mints a fresh token for an invited stub", async () => {
    const stub = await addCandidateByInvite({
      orgId: fx.orgA,
      campaignId: fx.campA,
      actorUserId: fx.owner,
      name: "Resend Me",
      email: "resend@example.com",
    });
    asOwner();
    const res = await resendPost(
      new NextRequest("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ id: stub.candidateId }) }
    );
    expect(res.status).toBe(200);
    expect(await auditActions(stub.candidateId)).toContain("candidate_notified");
  });

  it("resend-invite refuses a non-invited candidate with 409", async () => {
    const added = await addCandidateBySkip(skipInput("notinvited@example.com"));
    asOwner();
    const res = await resendPost(
      new NextRequest("http://localhost/x", { method: "POST" }),
      { params: Promise.resolve({ id: added.candidateId }) }
    );
    expect(res.status).toBe(409);
  });

  it("audit export returns CSV of the candidate's trail", async () => {
    const added = await addCandidateBySkip(skipInput("export@example.com"));
    asOwner();
    const res = await exportGet(
      new NextRequest("http://localhost/x", { method: "GET" }),
      { params: Promise.resolve({ id: added.candidateId }) }
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("consent_attested");
    expect(body).toContain("manual_add");
    expect(body.split("\r\n")[0]).toContain("timestamp,action");
  });

  // ── View-application status portal ─────────────────────────────────

  const statusReq = (token: string | null) =>
    new NextRequest("http://localhost/api/candidates/status", {
      headers: token ? { "x-chat-token": token } : {},
    });

  it("status portal confirms a skip-path candidate's consent (idempotent) and reports in_review", async () => {
    const added = await addCandidateBySkip(skipInput("portal@example.com"));
    const before = await candidateRow(added.candidateId);
    expect(before?.popia_consent_at).toBeNull(); // attested, not yet confirmed

    const res = await statusGet(statusReq(added.chatTokenRaw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "in_review" });

    const after = await candidateRow(added.candidateId);
    expect(after?.popia_consent_at).not.toBeNull();
    expect(await auditActions(added.candidateId)).toContain("consent_confirmed");
    const confirmedAt = after?.popia_consent_at;

    // Second visit is a no-op: timestamp frozen, no duplicate audit.
    await statusGet(statusReq(added.chatTokenRaw));
    const after2 = await candidateRow(added.candidateId);
    expect(after2?.popia_consent_at?.getTime()).toBe(confirmedAt?.getTime());
    const confirmCount = (await auditActions(added.candidateId)).filter(
      (a) => a === "consent_confirmed"
    ).length;
    expect(confirmCount).toBe(1);
  });

  it("status portal points the candidate into a live conversation when one exists", async () => {
    const added = await addCandidateBySkip(skipInput("portalchat@example.com"));
    const convId = await createConversation(
      fx.orgA,
      added.candidateId,
      "Skip Person",
      "Engineer",
      "End Brand",
      "dormant",
      [],
      "recruiter_manual"
    );

    const res = await statusGet(statusReq(added.chatTokenRaw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      state: "chat_ready",
      conversationId: convId,
    });
  });

  it("status portal reports withdrawn for a withdrawn candidate", async () => {
    const added = await addCandidateBySkip(
      skipInput("portalwithdrawn@example.com")
    );
    await db
      .update(candidates)
      .set({ status: "withdrawn" })
      .where(eq(candidates.id, added.candidateId));

    const res = await statusGet(statusReq(added.chatTokenRaw));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "withdrawn" });
  });

  it("status portal rejects an unknown token with 401", async () => {
    const res = await statusGet(statusReq("not-a-real-token"));
    expect(res.status).toBe(401);
  });

  it("createConversation greets a recruiter-added candidate without thanking them for applying", async () => {
    const added = await addCandidateBySkip(skipInput("greeting@example.com"));
    const convId = await createConversation(
      fx.orgA,
      added.candidateId,
      "Skip Person",
      "Engineer",
      "End Brand",
      "dormant",
      [],
      "recruiter_manual"
    );
    const [msg] = await db
      .select({ content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.conversation_id, convId))
      .limit(1);
    expect(msg?.content).toContain("added you to the Engineer role");
    expect(msg?.content).not.toContain("Thanks for applying");
  });
});
