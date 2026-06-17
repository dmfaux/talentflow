import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ── Seam mocks (mirror invitations.itest.ts / operator-isolation.itest.ts) ──
// getSession + getActiveBrandCookie read cookies; in a DB test there is no
// request scope, so back them with settable holders. The invite email is
// captured so the provision→accept flow can extract the raw token. Everything
// else (tenantFromSession, the guards, the transaction, the audit writes) runs
// for real against the seeded DB.
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

const emailHolder = vi.hoisted(() => ({ lastHtml: null as string | null }));
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendCandidateEmail: async () => null,
    sendTransactionalEmail: async (_to: string, _s: string, html: string) => {
      emailHolder.lastHtml = html;
      return "stub-id";
    },
  };
});

import { db } from "@/db";
import {
  clients,
  invitations,
  memberships,
  operatorAudit,
  organizations,
  users,
} from "@/db/schema";
import { and, eq, isNull, like } from "drizzle-orm";
import { NextRequest } from "next/server";

import { POST as provision } from "@/app/api/operator/organizations/route";
import { GET as orgGet } from "@/app/api/operator/organizations/[id]/route";
import { POST as resendInvite } from "@/app/api/operator/organizations/[id]/resend-invite/route";
import {
  GET as orgSettingsGet,
  PATCH as orgSettingsPatch,
} from "@/app/api/admin/organization/route";
import { POST as inviteAccept } from "@/app/api/auth/invite/accept/route";
import {
  GET as clientsGet,
  POST as clientsPost,
} from "@/app/api/admin/clients/route";
import {
  GET as clientGet,
  PATCH as clientPatch,
} from "@/app/api/admin/clients/[id]/route";

const RUN = !!process.env.DATABASE_URL;

const IP = "203.0.113.9";
function jsonReq(body?: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: {
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const ctxParam = (id: string) => ({ params: Promise.resolve({ id }) });

type Session = {
  userId: string;
  orgId: string | null;
  orgRole: "owner" | "org_admin" | null;
  isOperator: boolean;
};
function login(s: Session) {
  sessionHolder.current = s;
}

function tokenFromLastEmail(): string {
  const m = emailHolder.lastHtml?.match(/accept-invite\?token=([a-f0-9]+)/);
  if (!m) throw new Error("no accept token in captured email");
  return m[1];
}

// ── Fixture (own orgs, slug-prefixed cleanup — NOT a full-table wipe) ──
const PREFIX = "s9prov-";
const SLUGS = {
  orgA: "s9prov-org-a",
  orgB: "s9prov-org-b",
  brandA1: "s9prov-brand-a1",
  brandA2: "s9prov-brand-a2",
  brandB: "s9prov-brand-b",
};
const OPERATOR_EMAIL = "operator@s9prov.test";
const fx = {
  operator: "",
  orgA: "",
  orgB: "",
  brandA1: "",
  brandA2: "",
  brandB: "",
  ownerA: "",
  orgAdminA: "",
  recruiterA: "",
  brandAdminA1: "",
  ownerB: "",
};
const PW = bcrypt.hashSync("password123", 4);

async function cleanup() {
  if (fx.operator) {
    await db
      .delete(operatorAudit)
      .where(eq(operatorAudit.operator_user_id, fx.operator));
  }
  // Cascades brands/users/invitations/memberships of these orgs (incl. any
  // provisioned during the run — they all carry the s9prov- slug prefix).
  await db.delete(organizations).where(like(organizations.slug, `${PREFIX}%`));
  // The tenant-less operator is not cascaded by an org delete.
  await db.delete(users).where(eq(users.email, OPERATOR_EMAIL));
}

async function seedUser(
  orgId: string,
  clientId: string | null,
  email: string,
  orgRole: "owner" | "org_admin" | null
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      org_id: orgId,
      client_id: clientId,
      org_role: orgRole,
      is_operator: false,
      first_name: "Test",
      last_name: email.split("@")[0],
      email,
      password_hash: PW,
      security_group: "user",
    })
    .returning({ id: users.id });
  return u.id;
}

describe.skipIf(!RUN)("S9 provisioning + org/brand settings (DB-backed)", () => {
  beforeAll(async () => {
    await cleanup();

    const [operator] = await db
      .insert(users)
      .values({
        org_id: null,
        client_id: null,
        org_role: null,
        is_operator: true,
        first_name: "Ops",
        last_name: "User",
        email: OPERATOR_EMAIL,
        password_hash: PW,
        security_group: "admin",
      })
      .returning({ id: users.id });
    fx.operator = operator.id;

    [fx.orgA, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: SLUGS.orgA, name: "S9 Org A" },
          { slug: SLUGS.orgB, name: "S9 Org B" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandA1, fx.brandA2] = (
      await db
        .insert(clients)
        .values([
          { org_id: fx.orgA, slug: SLUGS.brandA1, name: "Brand A1" },
          { org_id: fx.orgA, slug: SLUGS.brandA2, name: "Brand A2" },
        ])
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.brandB] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgB, slug: SLUGS.brandB, name: "Brand B" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    fx.ownerA = await seedUser(fx.orgA, fx.brandA1, "owner@s9prov-a.test", "owner");
    fx.orgAdminA = await seedUser(fx.orgA, fx.brandA1, "orgadmin@s9prov-a.test", "org_admin");
    fx.recruiterA = await seedUser(fx.orgA, fx.brandA1, "recruiter@s9prov-a.test", null);
    fx.brandAdminA1 = await seedUser(fx.orgA, fx.brandA1, "brandadmin@s9prov-a.test", null);
    fx.ownerB = await seedUser(fx.orgB, fx.brandB, "owner@s9prov-b.test", "owner");

    await db.insert(memberships).values([
      { user_id: fx.recruiterA, client_id: fx.brandA1, brand_role: "recruiter" },
      { user_id: fx.brandAdminA1, client_id: fx.brandA1, brand_role: "brand_admin" },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    sessionHolder.current = null;
  });

  const asOperator = () =>
    login({ userId: fx.operator, orgId: null, orgRole: null, isOperator: true });

  // 1. Provision RBAC + audit
  describe("provision RBAC + audit", () => {
    it("operator → 201 with org + pending org-level invite + provision_org audit", async () => {
      asOperator();
      const res = await provision(
        jsonReq({
          name: "Provisioned One",
          slug: "s9prov-new-1",
          tier: "premium",
          ownerEmail: "newowner1@s9prov.test",
        })
      );
      expect(res.status).toBe(201);
      const { data } = await res.json();
      expect(data.organization.status).toBe("active");
      expect(data.organization.tier).toBe("premium");

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.slug, "s9prov-new-1"),
      });
      expect(org).toBeTruthy();

      const inv = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.org_id, org!.id),
          eq(invitations.email, "newowner1@s9prov.test")
        ),
      });
      expect(inv?.client_id).toBeNull(); // org-level invite
      expect(inv?.org_role).toBe("owner");
      expect(inv?.brand_role).toBeNull();
      expect(inv?.token_hash).toBeTruthy();
      expect(inv?.accepted_at).toBeNull();
      expect(inv!.expires_at.getTime()).toBeGreaterThan(Date.now());

      const audit = await db.query.operatorAudit.findFirst({
        where: and(
          eq(operatorAudit.operator_user_id, fx.operator),
          eq(operatorAudit.action, "provision_org"),
          eq(operatorAudit.target_org_id, org!.id)
        ),
      });
      expect(audit).toBeTruthy();
      expect(audit?.ip).toBe(IP);
      expect(audit?.ended_at).toBeTruthy(); // point-in-time
    });

    it("non-operators (owner / org_admin / recruiter) → 403", async () => {
      for (const u of [
        { userId: fx.ownerA, orgRole: "owner" as const },
        { userId: fx.orgAdminA, orgRole: "org_admin" as const },
        { userId: fx.recruiterA, orgRole: null },
      ]) {
        login({ userId: u.userId, orgId: fx.orgA, orgRole: u.orgRole, isOperator: false });
        const res = await provision(
          jsonReq({ name: "X", slug: "s9prov-nope", tier: "standard", ownerEmail: "x@s9prov.test" })
        );
        expect(res.status).toBe(403);
      }
      const dupe = await db.query.organizations.findFirst({
        where: eq(organizations.slug, "s9prov-nope"),
      });
      expect(dupe).toBeFalsy();
    });
  });

  // 2. Empty-org onboarding (provision → accept → login → first brand)
  it("provisioned Owner accepts into an empty isolated org and creates the first brand", async () => {
    asOperator();
    const created = await provision(
      jsonReq({
        name: "Provisioned Two",
        slug: "s9prov-new-2",
        tier: "standard",
        ownerEmail: "newowner2@s9prov.test",
      })
    );
    expect(created.status).toBe(201);
    const newOrgId = (await created.json()).data.organization.id;
    const token = tokenFromLastEmail();

    const accept = await inviteAccept(
      jsonReq({ token, firstName: "New", lastName: "Owner", password: "password123" })
    );
    expect(accept.status).toBe(200);
    expect(accept.headers.get("set-cookie")).toContain("admin_session=");

    const owner = await db.query.users.findFirst({
      where: eq(users.email, "newowner2@s9prov.test"),
    });
    expect(owner!.org_id).toBe(newOrgId);
    expect(owner!.org_role).toBe("owner");
    expect(owner!.client_id).toBeNull(); // empty-org bootstrap shape
    const m = await db.query.memberships.findFirst({
      where: eq(memberships.user_id, owner!.id),
    });
    expect(m).toBeFalsy(); // no membership row for an org-level Owner

    // The Owner logs in and creates the first brand in their isolated org.
    login({ userId: owner!.id, orgId: newOrgId, orgRole: "owner", isOperator: false });
    const brandRes = await clientsPost(
      jsonReq({ name: "First Brand", slug: "s9prov-newbrand-2" })
    );
    expect(brandRes.status).toBe(201);
    const brand = (await brandRes.json()).data;
    expect(brand.org_id).toBe(newOrgId);

    // And sees only their own org's brands (not Org A's).
    const list = await clientsGet();
    const rows = (await list.json()).data as { id: string; org_id: string }[];
    expect(rows.every((r) => r.org_id === newOrgId)).toBe(true);
    expect(rows.some((r) => r.id === fx.brandA1)).toBe(false);
  });

  // 3. Org-slug collision → generic, no second org
  it("provisioning a taken org slug → error, no second org", async () => {
    asOperator();
    const res = await provision(
      jsonReq({
        name: "Dupe",
        slug: SLUGS.orgA,
        tier: "standard",
        ownerEmail: "dupe@s9prov.test",
      })
    );
    expect(res.status).toBe(400);
    const count = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, SLUGS.orgA));
    expect(count.length).toBe(1);
  });

  // 4. Global-email guard
  it("provisioning with an email already used by a tenant user → 409, no org, colliding user untouched", async () => {
    asOperator();
    const res = await provision(
      jsonReq({
        name: "Collide",
        slug: "s9prov-new-4",
        tier: "standard",
        ownerEmail: "owner@s9prov-b.test", // ownerB's email (another org)
      })
    );
    expect(res.status).toBe(409);
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.slug, "s9prov-new-4"),
    });
    expect(org).toBeFalsy(); // transaction rolled back — no orphan org
    const ownerB = await db.query.users.findFirst({
      where: eq(users.email, "owner@s9prov-b.test"),
    });
    expect(ownerB?.id).toBe(fx.ownerB); // untouched
  });

  // 5. Resend supersede + already-onboarded guard
  it("resend supersedes the pending invite (fresh token); resend after accept → 409", async () => {
    asOperator();
    const created = await provision(
      jsonReq({
        name: "Provisioned Five",
        slug: "s9prov-new-5",
        tier: "standard",
        ownerEmail: "newowner5@s9prov.test",
      })
    );
    const newOrgId = (await created.json()).data.organization.id;
    const token1 = tokenFromLastEmail();

    asOperator();
    const resend = await resendInvite(jsonReq(undefined, "POST"), ctxParam(newOrgId));
    expect(resend.status).toBe(200);
    const token2 = tokenFromLastEmail();
    expect(token2).not.toBe(token1);

    // Exactly one live invite remains for the org.
    const pending = await db
      .select()
      .from(invitations)
      .where(and(eq(invitations.org_id, newOrgId), isNull(invitations.accepted_at)));
    expect(pending.length).toBe(1);

    // The superseded token1 no longer works; the fresh token2 does.
    const stale = await inviteAccept(
      jsonReq({ token: token1, firstName: "A", lastName: "B", password: "password123" })
    );
    expect(stale.status).toBe(400);
    const ok = await inviteAccept(
      jsonReq({ token: token2, firstName: "Five", lastName: "Owner", password: "password123" })
    );
    expect(ok.status).toBe(200);

    // After acceptance, a resend is refused.
    asOperator();
    const after = await resendInvite(jsonReq(undefined, "POST"), ctxParam(newOrgId));
    expect(after.status).toBe(409);
  });

  // 6. Onboarding status surfaced by the operator GET
  it("operator GET surfaces pending invite, then the accepted owner", async () => {
    asOperator();
    const created = await provision(
      jsonReq({
        name: "Provisioned Six",
        slug: "s9prov-new-6",
        tier: "standard",
        ownerEmail: "newowner6@s9prov.test",
      })
    );
    const newOrgId = (await created.json()).data.organization.id;
    const token = tokenFromLastEmail();

    asOperator();
    const pendingView = await orgGet(jsonReq(undefined, "GET"), ctxParam(newOrgId));
    const pendingData = (await pendingView.json()).data;
    expect(pendingData.owner).toBeNull();
    expect(pendingData.pendingInvite?.email).toBe("newowner6@s9prov.test");

    await inviteAccept(
      jsonReq({ token, firstName: "Six", lastName: "Owner", password: "password123" })
    );

    asOperator();
    const ownerView = await orgGet(jsonReq(undefined, "GET"), ctxParam(newOrgId));
    const ownerData = (await ownerView.json()).data;
    expect(ownerData.owner?.email).toBe("newowner6@s9prov.test");
    expect(ownerData.pendingInvite).toBeNull();
  });

  // 7. Tenant org settings
  describe("org settings PATCH", () => {
    it("owner edits name/contact (own org); ignores tier/billing/slug/status", async () => {
      login({ userId: fx.ownerA, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await orgSettingsPatch(
        jsonReq(
          {
            name: "Org A Renamed",
            contact_name: "Dana",
            contact_email: "dana@s9prov-a.test",
            tier: "enterprise",
            billing_email: "hacker@evil.test",
            slug: "hacked",
            status: "suspended",
          },
          "PATCH"
        )
      );
      expect(res.status).toBe(200);

      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, fx.orgA),
      });
      expect(org?.name).toBe("Org A Renamed");
      expect(org?.contact_email).toBe("dana@s9prov-a.test");
      // Ignored fields untouched.
      expect(org?.tier).toBe("standard");
      expect(org?.slug).toBe(SLUGS.orgA);
      expect(org?.status).toBe("active");
      expect(org?.billing_email).toBeNull();
    });

    it("recruiter (no org role) → 403", async () => {
      login({ userId: fx.recruiterA, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await orgSettingsPatch(jsonReq({ name: "Nope" }, "PATCH"));
      expect(res.status).toBe(403);
    });

    it("GET returns read-only tier + billing for display", async () => {
      login({ userId: fx.orgAdminA, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await orgSettingsGet();
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.id).toBe(fx.orgA);
      expect(data.tier).toBe("standard");
      expect("billing_email" in data).toBe(true);
    });
  });

  // 8. clients GET org-scoping (S4 carry-over regression)
  describe("clients GET org-scoping", () => {
    it("list → only the caller's org brands", async () => {
      login({ userId: fx.orgAdminA, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await clientsGet();
      const rows = (await res.json()).data as { id: string; org_id: string }[];
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.every((r) => r.org_id === fx.orgA)).toBe(true);
      expect(rows.some((r) => r.id === fx.brandB)).toBe(false);
    });
    it("GET [orgB-brand] → 404", async () => {
      login({ userId: fx.orgAdminA, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await clientGet(jsonReq(undefined, "GET"), ctxParam(fx.brandB));
      expect(res.status).toBe(404);
    });
  });

  // 9. clients PATCH RBAC matrix (per-field split)
  describe("clients PATCH RBAC split", () => {
    it("brand_admin edits their brand's branding → 200", async () => {
      login({ userId: fx.brandAdminA1, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await clientPatch(
        jsonReq({ notes: "edited by brand_admin", brand_primary_color: "#123456" }, "PATCH"),
        ctxParam(fx.brandA1)
      );
      expect(res.status).toBe(200);
      const brand = await db.query.clients.findFirst({ where: eq(clients.id, fx.brandA1) });
      expect(brand?.notes).toBe("edited by brand_admin");
    });

    it("brand_admin edits a sibling brand they don't belong to → 404", async () => {
      login({ userId: fx.brandAdminA1, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await clientPatch(
        jsonReq({ notes: "x" }, "PATCH"),
        ctxParam(fx.brandA2)
      );
      expect(res.status).toBe(404);
    });

    it("brand_admin changing the slug → 403 (org-level only)", async () => {
      login({ userId: fx.brandAdminA1, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await clientPatch(
        jsonReq({ slug: "s9prov-brand-a1-renamed" }, "PATCH"),
        ctxParam(fx.brandA1)
      );
      expect(res.status).toBe(403);
    });

    it("org_admin changes the slug → 200; tier in body is ignored", async () => {
      login({ userId: fx.orgAdminA, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await clientPatch(
        jsonReq({ slug: "s9prov-brand-a1-renamed", tier: "enterprise", name: "A1" }, "PATCH"),
        ctxParam(fx.brandA1)
      );
      expect(res.status).toBe(200);
      const brand = await db.query.clients.findFirst({ where: eq(clients.id, fx.brandA1) });
      expect(brand?.slug).toBe("s9prov-brand-a1-renamed");
      expect(brand?.tier).toBe("standard"); // tier ignored (operator-only)
    });
  });
});
