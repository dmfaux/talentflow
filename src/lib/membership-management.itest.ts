import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

// ── Seam mocks (mirror invitations.itest.ts) ─────────────────────────
// getApiTenant → getSession() + getActiveBrandCookie() read cookies; in a DB
// test there is no request scope, so back both with settable holders. Everything
// else (tenantFromSession, the guards, the route bodies) runs for real.
const sessionHolder = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));
const brandHolder = vi.hoisted(() => ({ current: null as string | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getSession: async () => sessionHolder.current,
    getActAsClaim: async () => null,
    getActiveBrandCookie: async () => brandHolder.current,
  };
});
vi.mock("@/lib/queue", () => ({ getQueue: () => ({ enqueue: async () => {} }) }));

import { db } from "@/db";
import { clients, memberships, organizations, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";

import { POST as addMembership } from "@/app/api/admin/users/[id]/memberships/route";
import { DELETE as removeMembership } from "@/app/api/admin/users/[id]/memberships/[clientId]/route";
import { PATCH as userPatch } from "@/app/api/admin/users/[id]/route";

const RUN = !!process.env.DATABASE_URL;

function jsonReq(body?: unknown, method = "POST"): NextRequest {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const idParam = (id: string) => ({ params: Promise.resolve({ id }) });
const memParam = (id: string, clientId: string) => ({
  params: Promise.resolve({ id, clientId }),
});

type Session = {
  userId: string;
  orgId: string | null;
  orgRole: "owner" | "org_admin" | null;
  isOperator: boolean;
};
function login(s: Session) {
  sessionHolder.current = s;
}

// ── Fixture (own orgs, cleaned up — NOT a full-table wipe) ────────────
const SLUGS = {
  orgA: "memmgmt-org-a",
  orgB: "memmgmt-org-b",
  brandA1: "memmgmt-brand-a1",
  brandA2: "memmgmt-brand-a2",
  brandB: "memmgmt-brand-b",
};
const fx = {
  orgA: "",
  orgB: "",
  brandA1: "",
  brandA2: "",
  brandB: "",
  owner: "",
  orgAdmin: "",
  member: "", // brand-scoped, starts with no memberships
  promoteMe: "", // brand-scoped, seeded with two brands (promotion test)
  recruiter: "", // brand-scoped actor lacking manage_member
  ownerB: "",
};
const PW = bcrypt.hashSync("password123", 4);

async function cleanup() {
  await db
    .delete(organizations)
    .where(inArray(organizations.slug, [SLUGS.orgA, SLUGS.orgB]));
}

async function seedUser(
  orgId: string,
  email: string,
  orgRole: "owner" | "org_admin" | null
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      org_id: orgId,
      org_role: orgRole,
      is_operator: false,
      first_name: "Test",
      last_name: email.split("@")[0],
      email,
      password_hash: PW,
    })
    .returning({ id: users.id });
  return u.id;
}

async function membershipCount(userId: string): Promise<number> {
  const rows = await db.query.memberships.findMany({
    where: eq(memberships.user_id, userId),
    columns: { id: true },
  });
  return rows.length;
}

describe.skipIf(!RUN)("member brand-access management (DB-backed)", () => {
  beforeAll(async () => {
    await cleanup();

    [fx.orgA, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: SLUGS.orgA, name: "MemMgmt Org A" },
          { slug: SLUGS.orgB, name: "MemMgmt Org B" },
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

    fx.owner = await seedUser(fx.orgA, "owner@memmgmt-a.test", "owner");
    fx.orgAdmin = await seedUser(fx.orgA, "orgadmin@memmgmt-a.test", "org_admin");
    fx.member = await seedUser(fx.orgA, "member@memmgmt-a.test", null);
    fx.promoteMe = await seedUser(fx.orgA, "promote@memmgmt-a.test", null);
    fx.recruiter = await seedUser(fx.orgA, "recruiter@memmgmt-a.test", null);
    fx.ownerB = await seedUser(fx.orgB, "owner@memmgmt-b.test", "owner");

    await db.insert(memberships).values([
      { user_id: fx.recruiter, client_id: fx.brandA1, brand_role: "recruiter" },
      { user_id: fx.promoteMe, client_id: fx.brandA1, brand_role: "recruiter" },
      { user_id: fx.promoteMe, client_id: fx.brandA2, brand_role: "viewer" },
    ]);
  });

  afterAll(async () => {
    await cleanup();
    sessionHolder.current = null;
    brandHolder.current = null;
  });

  describe("add membership RBAC + scoping", () => {
    it("brand-scoped member (no manage_member) → 403", async () => {
      login({ userId: fx.recruiter, orgId: fx.orgA, orgRole: null, isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "viewer" }),
        idParam(fx.member)
      );
      expect(res.status).toBe(403);
    });

    it("cross-org target → 404", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "viewer" }),
        idParam(fx.ownerB)
      );
      expect(res.status).toBe(404);
    });

    it("cross-org brand → 404 (never crosses tenants)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandB, brandRole: "viewer" }),
        idParam(fx.member)
      );
      expect(res.status).toBe(404);
    });

    it("org_admin targeting an owner → 403 (cannot touch a higher rank)", async () => {
      login({ userId: fx.orgAdmin, orgId: fx.orgA, orgRole: "org_admin", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "viewer" }),
        idParam(fx.owner)
      );
      expect(res.status).toBe(403);
    });

    it("targeting an org-level user → 409 (they already span all brands)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "viewer" }),
        idParam(fx.orgAdmin)
      );
      expect(res.status).toBe(409);
    });

    it("invalid brand role → 400", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "superuser" }),
        idParam(fx.member)
      );
      expect(res.status).toBe(400);
    });
  });

  describe("multi-brand membership (the core gap)", () => {
    it("links a member to a first brand → 201", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "recruiter" }),
        idParam(fx.member)
      );
      expect(res.status).toBe(201);
      expect(await membershipCount(fx.member)).toBe(1);
    });

    it("links the SAME member to a SECOND brand → 201 (two memberships)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA2, brandRole: "viewer" }),
        idParam(fx.member)
      );
      expect(res.status).toBe(201);
      expect(await membershipCount(fx.member)).toBe(2);
    });

    it("re-adding an existing brand upserts the role (no duplicate row)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await addMembership(
        jsonReq({ clientId: fx.brandA1, brandRole: "brand_admin" }),
        idParam(fx.member)
      );
      expect(res.status).toBe(201);
      expect(await membershipCount(fx.member)).toBe(2); // still two, role updated
      const m = await db.query.memberships.findFirst({
        where: and(
          eq(memberships.user_id, fx.member),
          eq(memberships.client_id, fx.brandA1)
        ),
      });
      expect(m?.brand_role).toBe("brand_admin");
    });
  });

  describe("remove membership", () => {
    it("removes one brand → 200, leaving the other intact", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await removeMembership(
        jsonReq(undefined, "DELETE"),
        memParam(fx.member, fx.brandA1)
      );
      expect(res.status).toBe(200);
      expect(await membershipCount(fx.member)).toBe(1);
      const gone = await db.query.memberships.findFirst({
        where: and(
          eq(memberships.user_id, fx.member),
          eq(memberships.client_id, fx.brandA1)
        ),
      });
      expect(gone).toBeFalsy();
    });

    it("cross-org brand → 404", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await removeMembership(
        jsonReq(undefined, "DELETE"),
        memParam(fx.member, fx.brandB)
      );
      expect(res.status).toBe(404);
    });
  });

  describe("promotion clears now-dead memberships", () => {
    it("promoting a Member to org_admin wipes their per-brand rows", async () => {
      expect(await membershipCount(fx.promoteMe)).toBe(2); // seeded with two
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await userPatch(
        jsonReq({ orgRole: "org_admin" }, "PATCH"),
        idParam(fx.promoteMe)
      );
      expect(res.status).toBe(200);
      const u = await db.query.users.findFirst({
        where: eq(users.id, fx.promoteMe),
        columns: { org_role: true },
      });
      expect(u?.org_role).toBe("org_admin");
      expect(await membershipCount(fx.promoteMe)).toBe(0);
    });
  });

  describe("org-role guards still hold", () => {
    it("demoting the last active owner → 409 (no lockout)", async () => {
      login({ userId: fx.owner, orgId: fx.orgA, orgRole: "owner", isOperator: false });
      const res = await userPatch(
        jsonReq({ orgRole: "" }, "PATCH"),
        idParam(fx.owner)
      );
      expect(res.status).toBe(409);
    });
  });
});
