import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import {
  clientIp,
  error,
  requireApiOperator,
  success,
} from "@/lib/api";
import {
  createInvitationRow,
  InvitationConflictError,
  sendInviteEmail,
} from "@/lib/invitations";
import { recordOperatorAudit } from "@/lib/operator-audit";
import { validateSlug } from "@/lib/slug";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";

const TIERS = ["standard", "premium", "enterprise"] as const;
type Tier = (typeof TIERS)[number];
const isTier = (v: unknown): v is Tier =>
  typeof v === "string" && (TIERS as readonly string[]).includes(v);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Generic: org-slug collisions never confirm cross-org existence (align with
// S8's slug-oracle posture). org-slug and brand-slug are distinct namespaces.
const SLUG_UNAVAILABLE = "That name or slug is unavailable";

const isUniqueViolation = (e: unknown): boolean =>
  !!e && typeof e === "object" && "code" in e && e.code === "23505";

// GET /api/operator/organizations — list/search every org.
//
// This is the ONE surface that legitimately spans all orgs (the operator
// directory), so there is deliberately NO orgScope here; it is gated by
// requireApiOperator instead. Non-operators 403 (tenant owner included).
export async function GET(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;
  void ctx;

  try {
    const { searchParams } = request.nextUrl;
    const q = searchParams.get("q")?.trim();
    const status = searchParams.get("status");
    const tier = searchParams.get("tier");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 200);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const conditions: SQL[] = [];
    if (q) {
      const like = `%${q}%`;
      conditions.push(
        or(ilike(organizations.name, like), ilike(organizations.slug, like))!
      );
    }
    if (status) conditions.push(eq(organizations.status, status));
    if (tier) conditions.push(eq(organizations.tier, tier));

    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(organizations)
        .where(where)
        .orderBy(desc(organizations.created_at))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(organizations)
        .where(where),
    ]);

    return success({
      organizations: rows,
      total: countResult[0].total,
      limit,
      offset,
    });
  } catch (err) {
    console.error("GET /api/operator/organizations error:", err);
    return error("Internal server error", 500);
  }
}

// POST /api/operator/organizations — provision an org + its first Owner (S9).
//
// The onboarding bootstrap (decision 5): an operator creates an empty, isolated
// org and an org-level Owner INVITE (client_id null, org_role owner). The org +
// invite commit atomically (no orphan tenant); the email is best-effort
// post-commit (resendable via .../[id]/resend-invite). Audited as provision_org.
export async function POST(request: NextRequest) {
  const { ctx, response } = await requireApiOperator();
  if (response) return response;

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const slug =
      typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
    const ownerEmail =
      typeof body.ownerEmail === "string"
        ? body.ownerEmail.trim().toLowerCase()
        : "";

    if (!name) return error("Organization name is required");
    const slugCheck = validateSlug(slug);
    if (!slugCheck.valid) return error(slugCheck.error!);
    if (!isTier(body.tier)) {
      return error("tier must be 'standard', 'premium', or 'enterprise'");
    }
    if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
      return error("A valid owner email is required");
    }

    // Org-slug collision → generic (don't confirm cross-org existence). The
    // unique index is the real backstop (the race is caught below).
    const slugTaken = await db.query.organizations.findFirst({
      where: eq(organizations.slug, slug),
      columns: { id: true },
    });
    if (slugTaken) return error(SLUG_UNAVAILABLE);

    // Operator display name for the invite email (or "TalentStream").
    const operator = await db.query.users.findFirst({
      where: eq(users.id, ctx.userId),
      columns: { first_name: true, last_name: true },
    });
    const operatorName = operator
      ? `${operator.first_name} ${operator.last_name}`.trim()
      : "";

    // Org + invite in one unit: an invite-row failure (incl. the global-email
    // guard) rolls back the org so there is never an orphan tenant.
    let org, invitation, rawToken;
    try {
      ({ org, invitation, rawToken } = await db.transaction(async (tx) => {
        const [createdOrg] = await tx
          .insert(organizations)
          .values({ name, slug, tier: body.tier, status: "active" })
          .returning();
        const created = await createInvitationRow(
          {
            orgId: createdOrg.id,
            email: ownerEmail,
            clientId: null,
            orgRole: "owner",
            brandRole: null,
            invitedBy: ctx.userId,
          },
          tx
        );
        return {
          org: createdOrg,
          invitation: created.invitation,
          rawToken: created.rawToken,
        };
      }));
    } catch (e) {
      // Global-email guard: the owner email already belongs to a tenant user.
      if (e instanceof InvitationConflictError) {
        return error("This email is already in use", 409);
      }
      // Slug race past the pre-check → same generic message, not a 500.
      if (isUniqueViolation(e)) return error(SLUG_UNAVAILABLE);
      throw e;
    }

    // Best-effort invite email — a send failure does NOT fail provisioning
    // (the invite row exists and is resendable). Mirrors password-reset.
    const acceptUrl = `${request.nextUrl.origin}/accept-invite?token=${rawToken}`;
    await sendInviteEmail(ownerEmail, org.name, operatorName, acceptUrl);

    // Audit (point-in-time, like set_tier).
    await recordOperatorAudit({
      operatorUserId: ctx.userId,
      action: "provision_org",
      targetOrgId: org.id,
      metadata: {
        slug: org.slug,
        name: org.name,
        tier: org.tier,
        owner_email: ownerEmail,
      },
      ip: clientIp(request),
      endedAt: new Date(),
    });

    return success(
      {
        organization: org,
        invite: { email: ownerEmail, expires_at: invitation.expires_at },
      },
      201
    );
  } catch (err) {
    console.error("POST /api/operator/organizations error:", err);
    return error("Internal server error", 500);
  }
}
