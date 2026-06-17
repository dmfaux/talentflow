import { db } from "@/db";
import { clients } from "@/db/schema";
import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { validateSlug } from "@/lib/slug";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

// Cap brand-slug probes per org to blunt cross-tenant slug enumeration. The
// global unique index on clients.slug is the real namespace guarantee; this
// just makes the existence oracle expensive to harvest (S8 Review correction).
const SLUG_CHECK_LIMIT = 10;
const SLUG_CHECK_WINDOW_MS = 60 * 1000;

export async function GET(request: NextRequest) {
  // De-oracle: only an org_admin+ (someone who could actually create a brand)
  // may probe — was signature-only requireApiAuth, letting any logged-in user
  // enumerate every tenant's brand slugs.
  const { ctx, response } = await getApiTenant();
  if (response) return response;
  const denied = authorizeApiOrg(ctx, "manage_brand");
  if (denied) return denied;

  if (
    !rateLimit(
      `clients:check-slug:${ctx.effectiveOrgId}`,
      SLUG_CHECK_LIMIT,
      SLUG_CHECK_WINDOW_MS
    )
  ) {
    return error("Too many requests. Please slow down.", 429);
  }

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) return error("slug parameter is required");

  // Reserved/invalid and taken are reported indistinguishably as unavailable —
  // the response carries no org/owner detail, so it confirms no cross-org
  // identity, only "you can't have this name".
  const validation = validateSlug(slug);
  if (!validation.valid) {
    return success({ available: false, error: validation.error });
  }

  const existing = await db.query.clients.findFirst({
    where: eq(clients.slug, slug),
    columns: { id: true },
  });

  return success({ available: !existing });
}
