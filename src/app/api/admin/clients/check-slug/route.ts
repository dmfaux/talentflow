import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireApiAuth, success, error } from "@/lib/api";
import { validateSlug } from "@/lib/slug";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const authError = await requireApiAuth();
  if (authError) return authError;

  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) return error("slug parameter is required");

  const validation = validateSlug(slug);
  if (!validation.valid) return success({ available: false, error: validation.error });

  const existing = await db.query.clients.findFirst({
    where: eq(clients.slug, slug),
    columns: { id: true },
  });

  return success({ available: !existing });
}
