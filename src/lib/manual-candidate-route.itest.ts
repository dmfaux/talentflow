import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Seams ────────────────────────────────────────────────────────────
// getApiTenant → getSession() reads a cookie; in a DB test there is no request
// context, so mock getSession to return a chosen tenant. tenantFromSession,
// orgScope, the RBAC guards, and the route body all run for real.
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

const enqueued = vi.hoisted(() => ({
  jobs: [] as { payload: unknown; opts: unknown }[],
}));
vi.mock("@/lib/queue", () => ({
  getQueue: () => ({
    enqueue: async (payload: unknown, opts: unknown) => {
      enqueued.jobs.push({ payload, opts });
    },
  }),
}));

// Keep the real template fns / subject resolver; stub only the wire send.
const emails = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string; candidateId: string }[],
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendCandidateEmail: async (
      to: string,
      subject: string,
      _html: string,
      candidateId: string
    ) => {
      emails.sent.push({ to, subject, candidateId });
      return "msg_test_1";
    },
  };
});

vi.mock("@/lib/azure-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azure-storage")>();
  return {
    ...actual,
    uploadCV: async (orgId: string, slug: string, candidateId: string) =>
      `cvs/${orgId}/${slug}/${candidateId}/cv.pdf`,
  };
});

const ceiling = vi.hoisted(() => ({ over: false }));
vi.mock("@/lib/spend-ceiling", () => ({
  getCeilingStatus: async () => ({ over: ceiling.over }),
}));

import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  campaigns,
  candidateActionAudit,
  candidates,
  clients,
  memberships,
  organizations,
  users,
} from "@/db/schema";
import { CURRENT_ATTESTATION } from "@/lib/consent";
import { POST } from "@/app/api/admin/campaigns/[id]/candidates/route";
import { eq } from "drizzle-orm";

const RUN = !!process.env.DATABASE_URL;

const fx = {
  orgA: "",
  brandA: "",
  campActive: "",
  campClosed: "",
  owner: "",
  viewer: "",
};

const GATING_CONFIG = [
  {
    id: "eligible",
    label: "Eligible to work?",
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
const CONSENT = { version: CURRENT_ATTESTATION, basis: "verbal" };

function jsonReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctxParam = (id: string) => ({ params: Promise.resolve({ id }) });
const login = (s: Record<string, unknown>) => {
  sessionHolder.current = s;
};
const asOwner = () =>
  login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });

const auditActions = async (candidateId: string) =>
  (
    await db
      .select({ action: candidateActionAudit.action })
      .from(candidateActionAudit)
      .where(eq(candidateActionAudit.candidate_id, candidateId))
  )
    .map((r) => r.action)
    .sort();

describe.skipIf(!RUN)("POST /api/admin/campaigns/[id]/candidates", () => {
  beforeAll(async () => {
    await db.delete(organizations);

    [fx.orgA] = (
      await db
        .insert(organizations)
        .values({ slug: "mar-org", name: "Mar Org" })
        .returning({ id: organizations.id })
    ).map((o) => o.id);
    [fx.brandA] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgA, slug: "mar-brand", name: "Mar Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    const campaignValues = {
      org_id: fx.orgA,
      client_id: fx.brandA,
      role_title: "Engineer",
      gating_config: GATING_CONFIG,
      scoring_rubric: FULL_RUBRIC,
    };
    [fx.campActive] = (
      await db
        .insert(campaigns)
        .values({ ...campaignValues, slug: "mar-active", status: "active" })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.campClosed] = (
      await db
        .insert(campaigns)
        .values({ ...campaignValues, slug: "mar-closed", status: "closed" })
        .returning({ id: campaigns.id })
    ).map((c) => c.id);
    [fx.owner] = (
      await db
        .insert(users)
        .values({
          org_id: fx.orgA,
          org_role: "owner",
          first_name: "Owner",
          last_name: "One",
          email: "owner@example.com",
          password_hash: "x",
        })
        .returning({ id: users.id })
    ).map((u) => u.id);
    [fx.viewer] = (
      await db
        .insert(users)
        .values({
          org_id: fx.orgA,
          org_role: null,
          first_name: "View",
          last_name: "Only",
          email: "viewer@example.com",
          password_hash: "x",
        })
        .returning({ id: users.id })
    ).map((u) => u.id);
    await db.insert(memberships).values({
      user_id: fx.viewer,
      client_id: fx.brandA,
      brand_role: "viewer",
    });
  });

  beforeEach(() => {
    enqueued.jobs = [];
    emails.sent = [];
    ceiling.over = false;
    sessionHolder.current = null;
  });

  it("invite path: 201, invited stub, branded invite email, audited", async () => {
    asOwner();
    const res = await POST(
      jsonReq({ path: "invite", name: "Iva Invite", email: "Iva@Example.com" }),
      ctxParam(fx.campActive)
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("invited");

    const c = await db.query.candidates.findFirst({
      where: eq(candidates.id, data.candidate_id),
    });
    expect(c?.status).toBe("invited");
    expect(c?.email).toBe("iva@example.com");

    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0].candidateId).toBe(data.candidate_id);
    expect(await auditActions(data.candidate_id)).toEqual([
      "candidate_notified",
      "manual_add",
    ]);
    // An invited stub is not scored.
    expect(enqueued.jobs.some((j) => (j.payload as { type?: string }).type === "candidate-processing")).toBe(false);
  });

  it("skip path (pasted CV): 201, scored, fully audited", async () => {
    asOwner();
    const res = await POST(
      jsonReq({
        path: "skip",
        name: "Sven Skip",
        email: "sven@example.com",
        cv_text: "Seasoned engineer, ten years.",
        consent: CONSENT,
      }),
      ctxParam(fx.campActive)
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.status).toBe("gating_passed");
    expect(data.gating_passed).toBe(true);

    expect(
      enqueued.jobs.some(
        (j) => (j.payload as { type?: string }).type === "candidate-processing"
      )
    ).toBe(true);
    expect(emails.sent).toHaveLength(1);
    expect(await auditActions(data.candidate_id)).toEqual([
      "candidate_notified",
      "consent_attested",
      "cv_provided",
      "gating_recorded",
      "manual_add",
    ]);
  });

  it("skip path (multipart CV file): 201, cv_url stored", async () => {
    asOwner();
    const fd = new FormData();
    fd.set("path", "skip");
    fd.set("name", "Fiona File");
    fd.set("email", "fiona@example.com");
    fd.set("consent", JSON.stringify(CONSENT));
    fd.set("cv", new File([Buffer.from("%PDF-1.4 test")], "cv.pdf", { type: "application/pdf" }));
    const req = new NextRequest("http://localhost/api/test", { method: "POST", body: fd });

    const res = await POST(req, ctxParam(fx.campActive));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    const c = await db.query.candidates.findFirst({
      where: eq(candidates.id, data.candidate_id),
    });
    expect(c?.cv_url).toContain(`/${data.candidate_id}/cv.pdf`);
  });

  it("dedup: a second add with the same email is 409", async () => {
    asOwner();
    const body = {
      path: "skip",
      name: "Dup",
      email: "dup@example.com",
      cv_text: "x",
      consent: CONSENT,
    };
    expect((await POST(jsonReq(body), ctxParam(fx.campActive))).status).toBe(201);
    expect((await POST(jsonReq(body), ctxParam(fx.campActive))).status).toBe(409);
  });

  it("closed campaign: 409", async () => {
    asOwner();
    const res = await POST(
      jsonReq({ path: "invite", name: "Late", email: "late@example.com" }),
      ctxParam(fx.campClosed)
    );
    expect(res.status).toBe(409);
  });

  it("viewer is forbidden (403)", async () => {
    login({ userId: fx.viewer, orgId: fx.orgA, orgRole: null, isOperator: false });
    const res = await POST(
      jsonReq({ path: "invite", name: "No", email: "no@example.com" }),
      ctxParam(fx.campActive)
    );
    expect(res.status).toBe(403);
  });

  it("skip without a CV: 400", async () => {
    asOwner();
    const res = await POST(
      jsonReq({ path: "skip", name: "No CV", email: "nocv@example.com", consent: CONSENT }),
      ctxParam(fx.campActive)
    );
    expect(res.status).toBe(400);
  });

  it("skip with basis 'other' and no note: 400", async () => {
    asOwner();
    const res = await POST(
      jsonReq({
        path: "skip",
        name: "Bad Consent",
        email: "badconsent@example.com",
        cv_text: "x",
        consent: { version: CURRENT_ATTESTATION, basis: "other" },
      }),
      ctxParam(fx.campActive)
    );
    expect(res.status).toBe(400);
  });
});
