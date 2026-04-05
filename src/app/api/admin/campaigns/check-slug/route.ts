import { requireApiAuth, success, error } from "@/lib/api";
import { validateSlug, findAvailableCampaignSlug } from "@/lib/slug";
import { db } from "@/db";
import { campaigns } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  const clientId = request.nextUrl.searchParams.get("client_id");
  const slug = request.nextUrl.searchParams.get("slug");

  if (!clientId) return error("client_id parameter is required");
  if (!slug) return error("slug parameter is required");

  const validation = validateSlug(slug);
  if (!validation.valid) return success({ available: false, error: validation.error });

  const existing = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.client_id, clientId), eq(campaigns.slug, slug)),
    columns: { id: true },
  });

  if (existing) {
    const suggestion = await findAvailableCampaignSlug(clientId, slug);
    return success({ available: false, suggestion });
  }

  return success({ available: true });
}
