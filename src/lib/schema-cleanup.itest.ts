import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import {
  campaigns,
  candidates,
  clients,
  memberships,
  organizations,
  users,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

// S13 schema cleanup — the transitional single-tenant crutches are gone now
// that the org/brand model is fully load-bearing. This proves the DDL outcome:
// the 10 BEFORE INSERT triggers + 6 functions dropped, users.client_id /
// security_group dropped, the finalised uniqueness set, and that the writers
// (not a trigger) are what stamp org_id.
const RUN = !!process.env.DATABASE_URL;

const SLUG = "s13clean";

const fx = { org: "", brand: "", campaign: "" };

describe.skipIf(!RUN)("S13 schema cleanup (DB-backed)", () => {
  beforeAll(async () => {
    // Self-contained fixture, idempotent across runs (org delete cascades to
    // brand/campaign/users via the org_id FKs).
    await db.delete(organizations).where(eq(organizations.slug, `${SLUG}-org`));

    const [org] = await db
      .insert(organizations)
      .values({ slug: `${SLUG}-org`, name: "S13 Org" })
      .returning({ id: organizations.id });
    fx.org = org.id;

    const [brand] = await db
      .insert(clients)
      .values({ org_id: fx.org, slug: `${SLUG}-brand`, name: "S13 Brand" })
      .returning({ id: clients.id });
    fx.brand = brand.id;

    const [camp] = await db
      .insert(campaigns)
      .values({
        org_id: fx.org,
        client_id: fx.brand,
        slug: "s13-camp",
        role_title: "Role",
        gating_config: [],
        scoring_rubric: {},
      })
      .returning({ id: campaigns.id });
    fx.campaign = camp.id;
  });

  afterAll(async () => {
    await db.delete(organizations).where(eq(organizations.slug, `${SLUG}-org`));
  });

  it("drops the 10 transitional BEFORE INSERT triggers (S1)", async () => {
    // Every transitional trigger was named trg_<table>_org_id — none survive.
    const rows = (await db.execute(
      sql`SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_%_org_id'`
    )) as unknown as { tgname: string }[];
    expect(rows.map((r) => r.tgname)).toEqual([]);
  });

  it("drops the 6 trigger functions", async () => {
    const rows = (await db.execute(
      sql`SELECT proname FROM pg_proc WHERE proname LIKE 'set_org_id%'`
    )) as unknown as { proname: string }[];
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("drops users.client_id and users.security_group", async () => {
    const rows = (await db.execute(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_name = 'users'
            AND column_name IN ('client_id', 'security_group')`
    )) as unknown as { column_name: string }[];
    expect(rows.map((r) => r.column_name)).toEqual([]);
  });

  it("finalises the uniqueness set to exactly the decided rules", async () => {
    const rows = (await db.execute(
      sql`SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'organizations_slug_idx', 'clients_slug_idx',
              'users_org_email_idx', 'users_operator_email_idx',
              'jobs_dedup_idx'
            )`
    )) as unknown as { indexname: string; indexdef: string }[];
    const def = new Map(rows.map((r) => [r.indexname, r.indexdef]));

    for (const name of [
      "organizations_slug_idx",
      "clients_slug_idx",
      "users_org_email_idx",
      "users_operator_email_idx",
      "jobs_dedup_idx",
    ]) {
      expect(def.has(name), `${name} present`).toBe(true);
      expect(def.get(name)).toContain("UNIQUE");
    }

    // organizations.slug — unique.
    expect(def.get("organizations_slug_idx")).toMatch(/\(slug\)/);

    // clients.slug — GLOBAL unique (keyed on slug alone, no org_id). This is
    // load-bearing for S12's org-less {brandSlug}.{appDomain} rewrite; a
    // concurrent reviewer must NOT "tidy" it into a per-org (org_id, slug).
    const clientsSlug = def.get("clients_slug_idx")!;
    expect(clientsSlug).toMatch(/\(slug\)/);
    expect(clientsSlug).not.toMatch(/org_id/);

    // users — per-org email unique + operator-email partial unique.
    expect(def.get("users_org_email_idx")).toMatch(/org_id/);
    expect(def.get("users_operator_email_idx")).toMatch(/is_operator/);

    // jobs dedup — S10's namespaced single-column partial (Decision B): there is
    // NO (org_id, deduplication_id) composite; per-tenant safety comes from the
    // namespaced value, not a second index column.
    const dedup = def.get("jobs_dedup_idx")!;
    expect(dedup).toMatch(/deduplication_id/);
    expect(dedup).not.toMatch(/org_id/);
  });

  it("rejects an org_id-less candidate insert (the trigger safety-net is gone)", async () => {
    // Pre-S13 the trigger would have rescued this from the campaign; now the
    // NOT NULL fires loudly — proving both that the net is removed and that
    // writers must (and do) stamp org_id themselves.
    await expect(
      db.execute(
        sql`INSERT INTO candidates (campaign_id, name, email)
            VALUES (${fx.campaign}, 'No Org', 'noorg@s13.test')`
      )
    ).rejects.toThrow();

    // Nothing leaked through — the insert was rejected, not silently rescued.
    const leaked = await db.query.candidates.findFirst({
      where: eq(candidates.email, "noorg@s13.test"),
    });
    expect(leaked).toBeFalsy();
  });

  it("grants a new user brand access via a membership row (not users.client_id)", async () => {
    const [u] = await db
      .insert(users)
      .values({
        org_id: fx.org,
        org_role: null,
        is_operator: false,
        first_name: "Mem",
        last_name: "S13",
        email: "member@s13.test",
        password_hash: "x",
      })
      .returning({ id: users.id });

    await db
      .insert(memberships)
      .values({ user_id: u.id, client_id: fx.brand, brand_role: "recruiter" });

    const m = await db.query.memberships.findFirst({
      where: eq(memberships.user_id, u.id),
    });
    expect(m?.client_id).toBe(fx.brand);
    expect(m?.brand_role).toBe("recruiter");
  });
});
