// ── Demo cast — the pure, DB-free description of the seeded tenants (S14) ─────
//
// This module is intentionally free of any DB / storage / env imports so the
// membership-grant rules can be unit-tested with zero infrastructure
// (vitest.config.ts, *.test.ts). seed.ts imports the cast + buildMembershipRows
// and turns them into real rows; the demo content (campaigns/candidates/…) is
// generated procedurally in seed.ts on top of this skeleton.
//
// Grant rules (the lockout/over-grant guardrails the slice warns about):
//   • Owners / Org-Admins carry an `org_role` and NO membership rows — the
//     org_role grants reach across every brand in their org.
//   • Brand-scoped users carry `org_role = null` and exactly their declared
//     membership(s). Zero memberships would lock them out; a membership on an
//     org-role user would over-grant. buildMembershipRows throws on either.
//   • Operators are tenant-less (org NULL) and carry no membership.

import type { BrandRole } from "@/lib/rbac";
import type { OrgRole } from "@/lib/auth";

export interface DemoBrand {
  /** Globally-unique brand slug (clients.slug is GLOBAL-unique — S12 contract). */
  slug: string;
  name: string;
  /** Source key into the branding palette in seed.ts. */
  branding: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  billing_email: string;
  notes: string;
}

export interface DemoOrg {
  slug: string;
  name: string;
  brands: DemoBrand[];
}

export interface DemoMembership {
  brandSlug: string;
  role: BrandRole;
}

export interface DemoUser {
  email: string;
  firstName: string;
  lastName: string;
  /** Home-org slug, or null for the tenant-less operator. */
  orgSlug: string | null;
  orgRole: OrgRole | null;
  isOperator: boolean;
  /** One row may be is_active:false — see the shared-email demo (Decision E). */
  isActive: boolean;
  memberships: DemoMembership[];
  /** Documentation only — why this user exists in the demo. */
  note: string;
}

// ── The two demo orgs (globally-distinct brand slugs) ────────────────────────

export const DEMO_ORGS: DemoOrg[] = [
  {
    slug: "northwind-group",
    name: "Northwind Group",
    brands: [
      {
        slug: "northwind-bank",
        name: "Northwind Bank",
        branding: "emerald",
        contact_name: "Thandi Mkhize",
        contact_email: "thandi.mkhize@northwind.example",
        contact_phone: "+27 11 294 4444",
        billing_email: "accounts@northwind.example",
        notes: "Digital banking division — core platform & payments hiring.",
      },
      {
        slug: "northwind-insure",
        name: "Northwind Insure",
        branding: "azure",
        contact_name: "Michael van der Merwe",
        contact_email: "michael.vdm@northwind.example",
        contact_phone: "+27 11 529 2888",
        billing_email: "accounts@northwind.example",
        notes: "Short-term insurance division — actuarial & data roles.",
      },
    ],
  },
  {
    slug: "summit-holdings",
    name: "Summit Holdings",
    brands: [
      {
        slug: "summit-retail",
        name: "Summit Retail",
        branding: "forest",
        contact_name: "Lerato Mokoena",
        contact_email: "lerato.mokoena@summit.example",
        contact_phone: "+27 21 407 9111",
        billing_email: "finance@summit.example",
        notes: "Retail technology transformation programme.",
      },
      {
        slug: "summit-logistics",
        name: "Summit Logistics",
        branding: "navy",
        contact_name: "Priya Naidoo",
        contact_email: "priya.naidoo@summit.example",
        contact_phone: "+27 11 638 9111",
        billing_email: "finance@summit.example",
        notes: "Supply-chain & platform modernisation.",
      },
      {
        slug: "summit-air",
        name: "Summit Air",
        branding: "amber",
        contact_name: "Johan Pretorius",
        contact_email: "johan.pretorius@summit.example",
        contact_phone: "+27 11 912 3000",
        billing_email: "finance@summit.example",
        notes: "Aviation & crew-systems engineering.",
      },
    ],
  },
];

// ── The user cast ────────────────────────────────────────────────────────────
//
// Every required acceptance login is here: operator (+ impersonate), Org A
// Owner, Org A brand-limited Recruiter, Org B Owner. The shared-email pair
// demonstrates the (org_id, email) constraint (one active + one inactive row).

export const OPERATOR_EMAIL = "operator@talentstream.example";
export const SHARED_EMAIL = "shared@demo.example";

export const DEMO_USERS: DemoUser[] = [
  {
    email: "owner@northwind.example",
    firstName: "Nomsa",
    lastName: "Khumalo",
    orgSlug: "northwind-group",
    orgRole: "owner",
    isOperator: false,
    isActive: true,
    memberships: [],
    note: "Org A Owner — acceptance demo login (sees all Org A brands, zero Org B data).",
  },
  {
    email: "admin@northwind.example",
    firstName: "Sipho",
    lastName: "Dlamini",
    orgSlug: "northwind-group",
    orgRole: "org_admin",
    isOperator: false,
    isActive: true,
    memberships: [],
    note: "Org A Org-Admin — org-wide admin with no brand membership.",
  },
  {
    email: "recruiter@northwind.example",
    firstName: "Rebecca",
    lastName: "Naidoo",
    orgSlug: "northwind-group",
    orgRole: null,
    isOperator: false,
    isActive: true,
    memberships: [{ brandSlug: "northwind-bank", role: "recruiter" }],
    note: "Org A Recruiter — acceptance demo login (limited to one brand).",
  },
  {
    email: "viewer@northwind.example",
    firstName: "Daniel",
    lastName: "Botha",
    orgSlug: "northwind-group",
    orgRole: null,
    isOperator: false,
    isActive: true,
    memberships: [{ brandSlug: "northwind-insure", role: "viewer" }],
    note: "Org A brand-scoped viewer.",
  },
  {
    email: "owner@summit.example",
    firstName: "Kagiso",
    lastName: "Pillay",
    orgSlug: "summit-holdings",
    orgRole: "owner",
    isOperator: false,
    isActive: true,
    memberships: [],
    note: "Org B Owner — acceptance demo login.",
  },
  {
    email: "recruiter@summit.example",
    firstName: "Annika",
    lastName: "Pretorius",
    orgSlug: "summit-holdings",
    orgRole: null,
    isOperator: false,
    isActive: true,
    memberships: [{ brandSlug: "summit-retail", role: "recruiter" }],
    note: "Org B brand-scoped recruiter.",
  },
  {
    email: SHARED_EMAIL,
    firstName: "Sam",
    lastName: "Shared",
    orgSlug: "northwind-group",
    orgRole: null,
    isOperator: false,
    isActive: true, // loginable row of the shared-email pair (Decision E)
    memberships: [{ brandSlug: "northwind-bank", role: "recruiter" }],
    note: "Shared-email demo — Org A row, is_active:true (the loginable one).",
  },
  {
    email: SHARED_EMAIL,
    firstName: "Sam",
    lastName: "Shared",
    orgSlug: "summit-holdings",
    orgRole: null,
    isOperator: false,
    isActive: false, // inactive so login (matches.length !== 1) never trips — Decision E
    memberships: [{ brandSlug: "summit-logistics", role: "viewer" }],
    note: "Shared-email demo — Org B row, is_active:false (proves the (org_id,email) constraint).",
  },
  {
    email: OPERATOR_EMAIL,
    firstName: "Olivia",
    lastName: "Operator",
    orgSlug: null,
    orgRole: null,
    isOperator: true,
    isActive: true,
    memberships: [],
    note: "Operator — acceptance demo login (operator console + impersonate).",
  },
];

// ── Pure membership-grant builder (unit-tested, no I/O) ───────────────────────

/** A user enriched with its persisted id (after insert) — the input shape the
 *  builder needs. */
export interface CastUserWithId {
  id: string;
  email: string;
  orgRole: OrgRole | null;
  isOperator: boolean;
  memberships: DemoMembership[];
}

export interface MembershipRow {
  user_id: string;
  client_id: string;
  brand_role: BrandRole;
}

/**
 * Translate the cast into membership rows, enforcing the slice's grant rules so
 * a mis-specified cast fails LOUDLY rather than silently locking a user out or
 * over-granting:
 *   • org-role users (owner/org_admin) and operators → MUST have zero memberships
 *   • brand-scoped users (org_role null, non-operator) → MUST have ≥1 membership,
 *     and every referenced brand slug must resolve in `brandIdBySlug`.
 */
export function buildMembershipRows(
  users: CastUserWithId[],
  brandIdBySlug: Map<string, string>
): MembershipRow[] {
  const rows: MembershipRow[] = [];
  for (const u of users) {
    const isOrgRole = u.orgRole !== null;
    if (isOrgRole || u.isOperator) {
      if (u.memberships.length > 0) {
        throw new Error(
          `Over-grant: ${u.email} has org_role/operator authority but ${u.memberships.length} membership(s); org-role users reach every brand without a membership.`
        );
      }
      continue;
    }
    // Plain brand-scoped user.
    if (u.memberships.length === 0) {
      throw new Error(
        `Lockout: ${u.email} has no org_role and no membership — it could never access any brand.`
      );
    }
    for (const m of u.memberships) {
      const clientId = brandIdBySlug.get(m.brandSlug);
      if (!clientId) {
        throw new Error(
          `Unknown brand slug "${m.brandSlug}" referenced by ${u.email}.`
        );
      }
      rows.push({ user_id: u.id, client_id: clientId, brand_role: m.role });
    }
  }
  return rows;
}
