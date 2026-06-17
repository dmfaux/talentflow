import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, isNotNull } from "drizzle-orm";
import { BlobServiceClient } from "@azure/storage-blob";
import * as schema from "../src/db/schema";
import { migratedCvPath, toBlobKey } from "../src/lib/blob-paths";

// One-off migration (S6): move every CV blob from the legacy
//   cvs/{clientSlug}/{campaignSlug}/{candidateId}/{filename}
// scheme to the org-prefixed
//   cvs/{orgId}/{brandSlug}/{candidateId}/{filename}
// scheme, and rewrite candidates.cv_url to the relative blob PATH.
//
// Acceptance: after this runs, every non-null cv_url resolves to an existing
// blob. Unresolvable rows (orphans, foreign-host placeholders) are NULLED and
// logged — never left dangling. Idempotent and safe to re-run (already-migrated
// rows are skipped; partial runs reconcile the column when the dest exists).
//
//   tsx scripts/backfill-blob-paths.ts            # live
//   tsx scripts/backfill-blob-paths.ts --dry-run  # report only

const DRY_RUN = process.argv.includes("--dry-run");

const databaseUrl = process.env.DATABASE_URL;
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
if (!connectionString || !containerName) {
  console.error(
    "AZURE_STORAGE_CONNECTION_STRING / AZURE_STORAGE_CONTAINER_NAME are not set"
  );
  process.exit(1);
}

const sqlClient = postgres(databaseUrl);
const db = drizzle(sqlClient, { schema });
const service = BlobServiceClient.fromConnectionString(connectionString);
const container = service.getContainerClient(containerName);

async function setCv(id: string, cvUrl: string | null) {
  await db
    .update(schema.candidates)
    .set({ cv_url: cvUrl, updated_at: new Date() })
    .where(eq(schema.candidates.id, id));
}

async function main() {
  console.log(
    DRY_RUN ? "DRY RUN — reporting only, no writes\n" : "LIVE RUN\n"
  );

  const rows = await db
    .select({
      id: schema.candidates.id,
      orgId: schema.candidates.org_id,
      cvUrl: schema.candidates.cv_url,
      clientSlug: schema.clients.slug,
    })
    .from(schema.candidates)
    .innerJoin(
      schema.campaigns,
      eq(schema.candidates.campaign_id, schema.campaigns.id)
    )
    .innerJoin(schema.clients, eq(schema.campaigns.client_id, schema.clients.id))
    .where(isNotNull(schema.candidates.cv_url));

  let moved = 0;
  let skipped = 0;
  let nulledForeign = 0;
  let nulledMissing = 0;

  for (const row of rows) {
    const raw = row.cvUrl as string;
    const oldKey = toBlobKey(raw, container.url);

    // Foreign-host value (e.g. the old example.blob.* seed placeholder) — it
    // never pointed at a real blob and cannot be moved.
    if (oldKey === null) {
      console.warn(`[null:foreign] candidate ${row.id} — ${raw}`);
      if (!DRY_RUN) await setCv(row.id, null);
      nulledForeign++;
      continue;
    }

    const newKey = migratedCvPath(oldKey, row.orgId, row.clientSlug, row.id);

    // Already org-prefixed — nothing to migrate. Covers post-S6 writes, a prior
    // run, AND the seeded shared `cvs/{orgId}/_sample/…` blob. The legacy scheme
    // always begins with the client SLUG, never the org UUID, so this never
    // skips a row that still needs moving.
    if (oldKey.startsWith(`cvs/${row.orgId}/`)) {
      skipped++;
      continue;
    }

    const src = container.getBlockBlobClient(oldKey);
    const dest = container.getBlockBlobClient(newKey);
    const [srcExists, destExists] = await Promise.all([
      src.exists(),
      dest.exists(),
    ]);

    // A prior partial run already copied the blob — just reconcile the column.
    if (destExists && !srcExists) {
      console.log(`[reconcile] candidate ${row.id} — dest present → cv_url`);
      if (!DRY_RUN) await setCv(row.id, newKey);
      skipped++;
      continue;
    }

    // Neither source nor destination exists — orphaned row; null + log.
    if (!srcExists && !destExists) {
      console.warn(`[null:missing] candidate ${row.id} — no blob at ${oldKey}`);
      if (!DRY_RUN) await setCv(row.id, null);
      nulledMissing++;
      continue;
    }

    console.log(`[move] candidate ${row.id} — ${oldKey} → ${newKey}`);
    if (!DRY_RUN) {
      if (!destExists) {
        const poller = await dest.beginCopyFromURL(src.url);
        await poller.pollUntilDone();
      }
      await src.deleteIfExists();
      await setCv(row.id, newKey);
    }
    moved++;
  }

  console.log(
    `\nDone. moved=${moved} skipped=${skipped} ` +
      `nulled(foreign)=${nulledForeign} nulled(missing)=${nulledMissing} ` +
      `total=${rows.length}`
  );
  if (DRY_RUN) console.log("(dry run — no changes written)");
}

main()
  .then(() => sqlClient.end())
  .catch(async (err) => {
    console.error(err);
    await sqlClient.end();
    process.exit(1);
  });
