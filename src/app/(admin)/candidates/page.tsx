import { db } from "@/db";
import { campaigns, candidates, clients } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getBrandMemberships, orgScope, requireTenant } from "@/lib/tenant";
import { effectiveOrgRole } from "@/lib/api";
import { RejectionQueue } from "@/components/admin/rejection-queue";

// Org-wide human-in-the-loop rejection review queue. Lists every candidate the
// AI recommended for rejection (status `pending_rejection`) — none of whom is
// rejected until a person accepts here. org_id is the hard isolation boundary;
// plain brand members are further narrowed to their own brands.
export default async function RejectionReviewPage() {
  const ctx = await requireTenant();
  const orgLevel = effectiveOrgRole(ctx) !== null;

  // Org-level roles (owner / org_admin / acting operator) see every brand; a
  // plain member sees only brands they belong to and can action only with
  // recruiter+.
  let brandFilter: string[] | null = null;
  let canManage = orgLevel;
  if (!orgLevel) {
    const memberships = await getBrandMemberships(ctx.userId);
    brandFilter = memberships.map((m) => m.clientId);
    canManage = memberships.some(
      (m) => m.brandRole === "recruiter" || m.brandRole === "brand_admin"
    );
  }
  // Honour an active-brand selection (S8 read narrowing).
  if (ctx.activeBrandId) {
    brandFilter = brandFilter
      ? brandFilter.filter((id) => id === ctx.activeBrandId)
      : [ctx.activeBrandId];
  }

  const rows =
    brandFilter && brandFilter.length === 0
      ? []
      : await db
          .select({
            id: candidates.id,
            name: candidates.name,
            email: candidates.email,
            score: candidates.ai_score,
            recommendedAt: candidates.rejection_recommended_at,
            brandName: clients.name,
            roleTitle: campaigns.role_title,
          })
          .from(candidates)
          .innerJoin(campaigns, eq(candidates.campaign_id, campaigns.id))
          .innerJoin(clients, eq(campaigns.client_id, clients.id))
          .where(
            and(
              orgScope(candidates, ctx),
              eq(candidates.status, "pending_rejection"),
              brandFilter
                ? inArray(campaigns.client_id, brandFilter)
                : undefined
            )
          )
          .orderBy(asc(candidates.rejection_recommended_at));

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-serif text-2xl italic text-charcoal">
          Rejection review
        </h1>
        <p className="mt-2 text-sm text-txt-secondary">
          Candidates the AI recommended rejecting. Nobody is rejected until you
          accept it.
        </p>
      </div>
      <RejectionQueue
        rows={rows.map((r) => ({
          ...r,
          recommendedAt: r.recommendedAt
            ? r.recommendedAt.toISOString()
            : null,
        }))}
        canManage={canManage}
      />
    </div>
  );
}
