import { db } from "@/db";
import { organizations } from "@/db/schema";
import { error, requireApiOperator, success } from "@/lib/api";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { NextRequest } from "next/server";

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
