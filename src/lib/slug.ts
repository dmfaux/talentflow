import { db } from "@/db";
import { campaigns, clients } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const RESERVED_SLUGS = [
  "www", "api", "app", "admin", "mail", "ftp",
  "staging", "dev", "test", "status", "cdn", "assets",
];

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateSlug(slug: string): { valid: boolean; error?: string } {
  if (!slug || slug.length < 2) {
    return { valid: false, error: "Slug must be at least 2 characters" };
  }
  if (slug.length > 63) {
    return { valid: false, error: "Slug must be 63 characters or fewer" };
  }
  if (!SLUG_REGEX.test(slug)) {
    return { valid: false, error: "Slug must be lowercase alphanumeric with hyphens only" };
  }
  if (RESERVED_SLUGS.includes(slug)) {
    return { valid: false, error: `"${slug}" is reserved and cannot be used` };
  }
  return { valid: true };
}

export async function findAvailableCampaignSlug(
  clientId: string,
  baseSlug: string
): Promise<string> {
  // Find all existing slugs for this client that match the base pattern
  const existing = await db
    .select({ slug: campaigns.slug })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.client_id, clientId),
        sql`${campaigns.slug} ~ ${`^${baseSlug}(-[0-9]+)?$`}`
      )
    );

  if (existing.length === 0) return baseSlug;

  const slugs = new Set(existing.map((r) => r.slug));
  if (!slugs.has(baseSlug)) return baseSlug;

  let suffix = 2;
  while (slugs.has(`${baseSlug}-${suffix}`)) suffix++;
  return `${baseSlug}-${suffix}`;
}
