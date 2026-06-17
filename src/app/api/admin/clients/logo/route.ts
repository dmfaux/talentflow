import { clients } from "@/db/schema";
import { uploadClientLogo } from "@/lib/azure-storage";
import { authorizeApiOrg, error, getApiTenant, success } from "@/lib/api";
import { resolveOwnedResource } from "@/lib/tenant";
import { NextRequest } from "next/server";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".svg"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitiseFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-");
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await getApiTenant();
  if (response) return response;

  // Only org_admin / owner may upload a brand logo.
  const denied = authorizeApiOrg(ctx, "manage_brand");
  if (denied) return denied;

  try {
    const formData = await request.formData();
    const clientId = formData.get("client_id") as string | null;
    const file = formData.get("logo") as File | null;

    if (!clientId || !UUID_REGEX.test(clientId)) {
      return error("Valid client_id (UUID) is required");
    }
    if (!file || !(file instanceof File) || file.size === 0) {
      return error("Logo file is required");
    }
    if (file.size > MAX_SIZE) {
      return error("Logo must be under 2MB");
    }

    const dotIdx = file.name.lastIndexOf(".");
    const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return error("Only PNG, JPG, and SVG files are accepted");
    }

    // Resolve the brand WITHIN the actor's org BEFORE touching storage — a
    // cross-org/non-existent id → 404. (Org-prefixed blob path is S6.)
    const brand = await resolveOwnedResource(clients, clientId, ctx);
    if (!brand) return error("Client not found", 404);

    const safeName = sanitiseFilename(file.name) || `logo${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    // org-prefixed public logo path: logos/{orgId}/{clientId}/… — org_id from
    // the in-org resolved brand. Returns a directly-usable public URL.
    const url = await uploadClientLogo(brand.org_id, clientId, buffer, safeName);

    if (!url) {
      return error("Storage is not configured", 503);
    }

    return success({ url }, 201);
  } catch (err) {
    console.error("POST /api/admin/clients/logo error:", err);
    return error("Internal server error", 500);
  }
}
