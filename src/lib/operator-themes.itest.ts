import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ── Seam mocks ───────────────────────────────────────────────────────
// As in operator-isolation.itest.ts: getSession is mocked to choose the caller;
// everything else (tenantFromSession, requireApiOperator, the route bodies, the
// operator_audit writes) runs for real against the seeded DB.
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
  clients,
  operatorAudit,
  organizations,
  themes,
  users,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

import { POST as createTheme, GET as listThemes } from "@/app/api/operator/themes/route";
import { PATCH as patchTheme } from "@/app/api/operator/themes/[id]/route";
import { POST as setDefault } from "@/app/api/operator/clients/[id]/default-theme/route";
import { POST as preview } from "@/app/api/operator/themes/preview/route";

const RUN = !!process.env.DATABASE_URL;

const PALETTE = {
  bg: "#f0f3f7",
  card: "#ffffff",
  primary: "#2c5bff",
  primaryDeep: "#1a45d4",
  primaryTint: "#e8eeff",
  accent: "#05dbd6",
  ink: "#11123c",
  inkSoft: "#2f3941",
  inkMuted: "#5a6b7a",
  inkFaint: "#9fb5c4",
  border: "#d1dce6",
};
const FONTS = {
  font_display: "Georgia, serif",
  font_sans: "Helvetica, Arial, sans-serif",
};

function jsonReq(body?: unknown, method = "POST", url = "http://localhost/api/test"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const idParam = (id: string) => ({ params: Promise.resolve({ id }) });

function loginOperator() {
  sessionHolder.current = {
    userId: fx.operator,
    orgId: null,
    orgRole: null,
    isOperator: true,
  };
}

const fx = {
  orgPremium: "",
  orgStandard: "",
  orgB: "",
  brandPremium: "",
  brandStandard: "",
  brandB: "",
  owner: "",
  operator: "",
};
const PW = bcrypt.hashSync("password123", 4);

describe.skipIf(!RUN)("CT2 operator theme console (DB-backed)", () => {
  beforeAll(async () => {
    await db.delete(operatorAudit);
    await db.delete(themes);
    await db.delete(users);
    await db.delete(clients);
    await db.delete(organizations);

    [fx.orgPremium, fx.orgStandard, fx.orgB] = (
      await db
        .insert(organizations)
        .values([
          { slug: "ct2-premium", name: "Premium Org", tier: "premium" },
          { slug: "ct2-standard", name: "Standard Org", tier: "standard" },
          { slug: "ct2-orgb", name: "Org B", tier: "enterprise" },
        ])
        .returning({ id: organizations.id })
    ).map((o) => o.id);

    [fx.brandPremium] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgPremium, slug: "ct2-brand-prem", name: "Premium Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.brandStandard] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgStandard, slug: "ct2-brand-std", name: "Standard Brand" })
        .returning({ id: clients.id })
    ).map((c) => c.id);
    [fx.brandB] = (
      await db
        .insert(clients)
        .values({ org_id: fx.orgB, slug: "ct2-brand-b", name: "Brand B" })
        .returning({ id: clients.id })
    ).map((c) => c.id);

    const [operator] = await db
      .insert(users)
      .values({
        org_id: null,
        org_role: null,
        is_operator: true,
        first_name: "Ops",
        last_name: "User",
        email: "operator@ct2.test",
        password_hash: PW,
      })
      .returning({ id: users.id });
    fx.operator = operator.id;

    const [owner] = await db
      .insert(users)
      .values({
        org_id: fx.orgPremium,
        org_role: "owner",
        is_operator: false,
        first_name: "Owner",
        last_name: "P",
        email: "owner@ct2.test",
        password_hash: PW,
      })
      .returning({ id: users.id });
    fx.owner = owner.id;
  });

  afterAll(() => {
    sessionHolder.current = null;
  });

  // Captured across tests.
  let galleryThemeId = "";
  let bespokeThemeId = "";
  let brandBThemeId = "";

  // ── Authz ──────────────────────────────────────────────────────────
  it("a tenant owner cannot author themes (403)", async () => {
    sessionHolder.current = {
      userId: fx.owner,
      orgId: fx.orgPremium,
      orgRole: "owner",
      isOperator: false,
    };
    const res = await createTheme(
      jsonReq({ name: "Nope", scope: "gallery", palette: PALETTE, ...FONTS })
    );
    expect(res.status).toBe(403);
  });

  // ── Gallery create (D-4 invariants) ────────────────────────────────
  it("creates a gallery theme, forcing powered-by + null org/client", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "Aurora",
        scope: "gallery",
        // These should be ignored/forced for a gallery theme.
        org_id: fx.orgPremium,
        client_id: fx.brandPremium,
        show_powered_by: false,
        palette: PALETTE,
        ...FONTS,
      })
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    galleryThemeId = data.id;
    expect(data.scope).toBe("gallery");
    expect(data.org_id).toBeNull();
    expect(data.client_id).toBeNull();
    expect(data.show_powered_by).toBe(true);
  });

  it("rejects a bad palette hex (400)", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "Broken",
        scope: "gallery",
        palette: { ...PALETTE, primary: "not-a-hex" },
        ...FONTS,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects landing_html missing the form mount (400)", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "NoForm",
        scope: "gallery",
        palette: PALETTE,
        ...FONTS,
        landing_html: "<html><body>no form</body></html>",
      })
    );
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/application-form/);
  });

  // ── Bespoke create (tier gate) ─────────────────────────────────────
  it("creates a white-label bespoke theme for a Premium brand", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "Premium Brand — Primary",
        scope: "custom",
        org_id: fx.orgPremium,
        client_id: fx.brandPremium,
        show_powered_by: false,
        palette: { ...PALETTE, primary: "#006341" },
        ...FONTS,
      })
    );
    expect(res.status).toBe(201);
    const { data } = await res.json();
    bespokeThemeId = data.id;
    expect(data.scope).toBe("custom");
    expect(data.client_id).toBe(fx.brandPremium);
    expect(data.show_powered_by).toBe(false);
  });

  it("rejects a bespoke theme for a Standard brand (400)", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "Standard — nope",
        scope: "custom",
        org_id: fx.orgStandard,
        client_id: fx.brandStandard,
        palette: PALETTE,
        ...FONTS,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects a cross-org bespoke theme (client not in org) (400)", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "Cross-org",
        scope: "custom",
        org_id: fx.orgPremium,
        client_id: fx.brandB, // belongs to orgB
        palette: PALETTE,
        ...FONTS,
      })
    );
    expect(res.status).toBe(400);
  });

  it("creates a bespoke theme for Brand B (Enterprise org)", async () => {
    loginOperator();
    const res = await createTheme(
      jsonReq({
        name: "Brand B — Primary",
        scope: "custom",
        org_id: fx.orgB,
        client_id: fx.brandB,
        palette: PALETTE,
        ...FONTS,
      })
    );
    expect(res.status).toBe(201);
    brandBThemeId = (await res.json()).data.id;
  });

  // ── Assign default ─────────────────────────────────────────────────
  it("assigns the bespoke theme as the Premium brand's default", async () => {
    loginOperator();
    const res = await setDefault(
      jsonReq({ theme_id: bespokeThemeId }),
      idParam(fx.brandPremium)
    );
    expect(res.status).toBe(200);
    const brand = await db.query.clients.findFirst({
      where: eq(clients.id, fx.brandPremium),
      columns: { default_theme_id: true },
    });
    expect(brand?.default_theme_id).toBe(bespokeThemeId);
  });

  it("lets a Standard brand inherit a gallery theme as default (200)", async () => {
    loginOperator();
    const res = await setDefault(
      jsonReq({ theme_id: galleryThemeId }),
      idParam(fx.brandStandard)
    );
    expect(res.status).toBe(200);
  });

  it("rejects assigning another brand's bespoke as a default (404)", async () => {
    loginOperator();
    const res = await setDefault(
      jsonReq({ theme_id: brandBThemeId }), // Brand B's bespoke
      idParam(fx.brandPremium)
    );
    expect(res.status).toBe(404);
  });

  it("clears a brand default with theme_id null (200)", async () => {
    loginOperator();
    const res = await setDefault(jsonReq({ theme_id: null }), idParam(fx.brandStandard));
    expect(res.status).toBe(200);
    const brand = await db.query.clients.findFirst({
      where: eq(clients.id, fx.brandStandard),
      columns: { default_theme_id: true },
    });
    expect(brand?.default_theme_id).toBeNull();
  });

  // ── Audit ──────────────────────────────────────────────────────────
  it("wrote theme_create + set_brand_default_theme audit rows", async () => {
    const creates = await db
      .select()
      .from(operatorAudit)
      .where(eq(operatorAudit.action, "theme_create"));
    expect(creates.length).toBeGreaterThanOrEqual(3);

    const sets = await db
      .select()
      .from(operatorAudit)
      .where(
        and(
          eq(operatorAudit.action, "set_brand_default_theme"),
          eq(operatorAudit.target_org_id, fx.orgPremium)
        )
      );
    expect(sets.length).toBeGreaterThanOrEqual(1);
    expect((sets[0].metadata as { to: string }).to).toBe(bespokeThemeId);
    // Point-in-time action → ended_at set (like set_tier).
    expect(sets[0].ended_at).not.toBeNull();
  });

  // ── Edit (re-assert invariants) ────────────────────────────────────
  it("edits a gallery theme name + palette (theme_update)", async () => {
    loginOperator();
    const res = await patchTheme(
      jsonReq({ name: "Aurora Borealis", palette: { ...PALETTE, accent: "#ff5a36" } }, "PATCH"),
      idParam(galleryThemeId)
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.name).toBe("Aurora Borealis");
    expect((data.palette as { accent: string }).accent).toBe("#ff5a36");
  });

  it("re-asserts invariants on a scope flip: gallery→custom without ids (400)", async () => {
    loginOperator();
    const res = await patchTheme(
      jsonReq({ scope: "custom" }, "PATCH"),
      idParam(galleryThemeId)
    );
    expect(res.status).toBe(400);
  });

  // ── List ───────────────────────────────────────────────────────────
  it("lists gallery ∪ a brand's bespoke for the console", async () => {
    loginOperator();
    const res = await listThemes(
      jsonReq(undefined, "GET", `http://localhost/api/operator/themes?org_id=${fx.orgPremium}&client_id=${fx.brandPremium}`)
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const ids = data.map((t: { id: string }) => t.id);
    expect(ids).toContain(galleryThemeId);
    expect(ids).toContain(bespokeThemeId);
    // Brand B's bespoke must NOT leak into the Premium brand's listing.
    expect(ids).not.toContain(brandBThemeId);
  });

  // ── Preview ────────────────────────────────────────────────────────
  it("renders themed HTML from the preview endpoint", async () => {
    loginOperator();
    const res = await preview(
      jsonReq({
        palette: { ...PALETTE, primary: "#006341" },
        ...FONTS,
        logo_url: null,
        logo_background: "light",
        logo_position: "top-left",
        show_powered_by: true,
      })
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.html).toContain("#006341"); // the brand palette colour
    expect(data.html).toContain("Northwind Studio"); // sample brand name
  });
});
