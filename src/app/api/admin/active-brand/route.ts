import { clients } from "@/db/schema";
import { error, getApiTenant, success } from "@/lib/api";
import { ACTIVE_BRAND_COOKIE, ACTIVE_BRAND_MAX_AGE } from "@/lib/auth";
import { canAccessBrand, resolveOwnedResource } from "@/lib/tenant";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_BASE = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// The BrandSwitcher posts the chosen brand here. The cookie grants NOTHING (it
// only narrows reads within the caller's already-enforced access), so it is
// unsigned — but the SELECTION is validated server-side: a brand outside the
// caller's org or one they can't access is rejected (acceptance: "server
// rejects an activeBrandId the user isn't a member of").
export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  const body = await request.json().catch(() => null);
  const brandId = body?.brandId;

  // null / "all" → clear the cookie (the "All brands" selection — owner/admin/
  // acting-operator span every brand; a plain member just drops narrowing).
  if (brandId == null || brandId === "all") {
    const res = success({ brandId: null });
    res.cookies.set(ACTIVE_BRAND_COOKIE, "", { ...COOKIE_BASE, maxAge: 0 });
    return res;
  }

  if (typeof brandId !== "string") {
    return error("brandId must be a brand id, null, or \"all\"");
  }

  // Two-gate validation: the brand must be in the caller's org (resolveOwned →
  // cross-org/non-existent 403) AND the caller must be able to access it
  // (canAccessBrand → same-org non-member brand 403). Mirrors the seam's
  // per-request re-check, but as an explicit 403 on the write path.
  const brand = await resolveOwnedResource(clients, brandId, ctx);
  if (!brand) return error("Forbidden", 403);
  if (!(await canAccessBrand(ctx, brand.id))) return error("Forbidden", 403);

  const res: NextResponse = success({ brandId: brand.id });
  res.cookies.set(ACTIVE_BRAND_COOKIE, brand.id, {
    ...COOKIE_BASE,
    maxAge: ACTIVE_BRAND_MAX_AGE,
  });
  return res;
}
