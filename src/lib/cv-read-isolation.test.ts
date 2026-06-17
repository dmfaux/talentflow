import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ── Static CV-blob read-isolation check (S6) ─────────────────────────
//
// Any admin route that reads a CV blob — mints a read SAS (generateSasUrl) or
// downloads server-side (downloadBlob) — must resolve its resource ORG-SCOPED
// first, so a cross-tenant id 404s BEFORE any blob access and no SAS is ever
// minted for another org's CV. Enforced structurally so a future refactor can't
// silently regress the ordering back onto the payload-discarding requireApiAuth.

const ADMIN_API_DIR = join(process.cwd(), "src/app/api/admin");
const CV_BLOB_PRIMITIVES = ["generateSasUrl", "downloadBlob"];
const SCOPE_GUARDS = ["resolveOwnedResource", "orgScope"];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("CV-blob read routes are org-scoped before blob access", () => {
  const files = routeFiles(ADMIN_API_DIR).filter((f) =>
    CV_BLOB_PRIMITIVES.some((p) => readFileSync(f, "utf8").includes(p))
  );

  it("discovers the CV-blob read routes", () => {
    // candidates/[id]/cv (SAS) and campaigns/[id]/cvs.zip (downloadBlob).
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const rel = file.slice(Math.max(0, file.indexOf("src/")));

    it(`${rel} org-scopes via getApiTenant + a scope guard, not requireApiAuth`, () => {
      expect(src, `${rel} must call getApiTenant`).toContain("getApiTenant");
      expect(
        SCOPE_GUARDS.some((g) => src.includes(g)),
        `${rel} must org-scope the resource via ${SCOPE_GUARDS.join("/")}`
      ).toBe(true);
      expect(
        src.includes("requireApiAuth"),
        `${rel} reads a CV blob and must not use the payload-discarding requireApiAuth`
      ).toBe(false);
    });
  }
});
