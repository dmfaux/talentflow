import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { inArray, sql } from "drizzle-orm";
import * as schema from "../src/db/schema";

// One-off, idempotent maintenance: mark any candidate still parked in an
// AI-drawing status (`gating_passed` / `scoring`) as already `scored`, so the
// jobs processor's recovery loop won't re-enqueue and re-score it on startup —
// which would spend real AI credits recomputing seed data.
//
// Use this INSTEAD of reseeding to fix a database that was seeded before
// seed.ts stopped emitting those statuses. Missing AI fields are backfilled
// with neutral values so each candidate stays coherent in the dashboard and in
// the spend projections. Safe to re-run (a second run matches zero rows).
//
//   tsx scripts/mark-seed-candidates-processed.ts            # live
//   tsx scripts/mark-seed-candidates-processed.ts --dry-run  # report only

const DRY_RUN = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

// Statuses the jobs recovery loop will re-process (see
// src/app/api/jobs/process/route.ts). Everything else is already terminal.
const INFLIGHT_STATUSES = ["gating_passed", "scoring"];

const NEUTRAL_DIMENSIONS = {
  skills_match: 6.5,
  experience_depth: 6.5,
  career_progression: 6.5,
  tenure_patterns: 6.5,
};

const client = postgres(databaseUrl);
const db = drizzle(client, { schema });

async function main() {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.candidates)
    .where(inArray(schema.candidates.status, INFLIGHT_STATUSES));

  if (!count) {
    console.log("No candidates in gating_passed/scoring — nothing to do.");
    return;
  }

  if (DRY_RUN) {
    console.log(
      `[dry-run] Would mark ${count} candidate(s) as scored. No changes written.`,
    );
    return;
  }

  const updated = await db
    .update(schema.candidates)
    .set({
      status: "scored",
      ai_score: sql`coalesce(${schema.candidates.ai_score}, 6.5)`,
      ai_confidence: sql`coalesce(${schema.candidates.ai_confidence}, 'medium')`,
      ai_rationale: sql`coalesce(${schema.candidates.ai_rationale}, 'Marked processed — no live scoring run on seed data.')`,
      ai_dimensions: sql`coalesce(${schema.candidates.ai_dimensions}, ${JSON.stringify(NEUTRAL_DIMENSIONS)}::jsonb)`,
      ai_flags: sql`coalesce(${schema.candidates.ai_flags}, '[]'::jsonb)`,
      updated_at: new Date(),
    })
    .where(inArray(schema.candidates.status, INFLIGHT_STATUSES))
    .returning({ id: schema.candidates.id });

  console.log(`Marked ${updated.length} candidate(s) as scored.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
