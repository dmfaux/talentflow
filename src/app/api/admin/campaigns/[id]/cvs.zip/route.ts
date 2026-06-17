import { db } from "@/db";
import { campaigns, candidates } from "@/db/schema";
import { error, getApiTenant } from "@/lib/api";
import { downloadBlob, isStorageConfigured } from "@/lib/azure-storage";
import { orgScope } from "@/lib/tenant";
import { buildCvManifest } from "@/lib/cv-files";
import { and, asc, desc, eq } from "drizzle-orm";
import JSZip from "jszip";

const DOWNLOAD_CONCURRENCY = 4;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  try {
    const { id } = await params;

    // Org-scope the campaign: a cross-tenant id → 404 (existence hidden).
    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, id), orgScope(campaigns, ctx)),
      with: { client: true },
    });

    if (!campaign) return error("Campaign not found", 404);
    if (!isStorageConfigured()) {
      return error("CV storage is not configured", 503);
    }

    const shortlisted = await db
      .select({
        id: candidates.id,
        name: candidates.name,
        cv_url: candidates.cv_url,
      })
      .from(candidates)
      // orgScope is belt-and-suspenders on top of the org-scoped campaign: the
      // bundle can only ever contain in-org CVs even if the campaign join were
      // tampered with.
      .where(
        and(
          eq(candidates.campaign_id, id),
          eq(candidates.status, "shortlisted"),
          orgScope(candidates, ctx)
        )
      )
      // Tie-break on id so the order is stable and matches the report page.
      .orderBy(desc(candidates.ai_score), asc(candidates.id));

    const entries = buildCvManifest(shortlisted)
      .filter((entry) => entry.filename !== null)
      .map((entry) => ({
        candidateId: entry.candidate.id,
        cvUrl: entry.candidate.cv_url!,
        filename: entry.filename!,
      }));

    if (entries.length === 0) {
      return error("No CVs on file for shortlisted candidates", 404);
    }

    // Download with bounded concurrency. One bad blob must not abort the
    // whole archive — collect failures and surface them in the zip instead.
    const buffers: (Buffer | null)[] = new Array(entries.length).fill(null);
    let cursor = 0;
    await Promise.all(
      Array.from(
        { length: Math.min(DOWNLOAD_CONCURRENCY, entries.length) },
        async () => {
          while (cursor < entries.length) {
            const index = cursor++;
            try {
              const blob = await downloadBlob(entries[index].cvUrl);
              buffers[index] = blob?.buffer ?? null;
            } catch (err) {
              console.error(
                `GET cvs.zip: CV download failed for candidate ${entries[index].candidateId}:`,
                err
              );
            }
          }
        }
      )
    );

    const zip = new JSZip();
    const missing: string[] = [];
    entries.forEach((entry, index) => {
      const buffer = buffers[index];
      if (buffer) zip.file(entry.filename, buffer);
      else missing.push(entry.filename);
    });

    if (missing.length === entries.length) {
      return error("None of the CVs could be retrieved from storage", 502);
    }
    if (missing.length > 0) {
      zip.file(
        "MISSING_FILES.txt",
        `The following CVs could not be retrieved from storage and are not included in this archive:\n\n${missing.join("\n")}\n`
      );
    }

    const archive = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const clientSlug = campaign.client?.slug ?? "client";
    const campaignSlug = campaign.slug;
    const filename = `${clientSlug}-${campaignSlug}-shortlist-cvs.zip`;

    return new Response(new Uint8Array(archive), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(archive.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("GET /api/admin/campaigns/[id]/cvs.zip error:", err);
    return error("Internal server error", 500);
  }
}
