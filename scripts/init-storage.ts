import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env
import { BlobServiceClient } from "@azure/storage-blob";

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const logoContainerName = process.env.AZURE_STORAGE_LOGO_CONTAINER_NAME;

if (!connectionString) {
  console.error("AZURE_STORAGE_CONNECTION_STRING is not set");
  process.exit(1);
}
if (!containerName) {
  console.error("AZURE_STORAGE_CONTAINER_NAME is not set");
  process.exit(1);
}
if (!logoContainerName) {
  console.error("AZURE_STORAGE_LOGO_CONTAINER_NAME is not set");
  process.exit(1);
}

/** Browser-readable origins for the account-level CORS rule. NEVER "*": the CV
 *  container is private (PII), and even the public logos container should only
 *  be canvas-readable (extractDominantColors) from our own app origins. */
function allowedOrigins(): string {
  const origins = new Set<string>();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (appUrl) origins.add(appUrl);
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN;
  if (domain) {
    origins.add(`https://${domain}`);
    // Per-brand careers subdomains ({clientSlug}.{domain}). Azure Blob CORS
    // accepts a single leading "*." subdomain wildcard.
    origins.add(`https://*.${domain}`);
  }
  // Local dev origin so the canvas reader works against `next dev`.
  origins.add("http://localhost:3000");
  return [...origins].join(",");
}

async function main() {
  const client = BlobServiceClient.fromConnectionString(connectionString!);

  // ── CV / PII container — PRIVATE (SAS-only reads) ──────────────────
  const container = client.getContainerClient(containerName!);
  const { succeeded } = await container.createIfNotExists(); // no access → private
  if (succeeded) {
    console.log(`Created PRIVATE container "${containerName}" (SAS-only reads)`);
  } else {
    // Force an existing container back to private (no public access) in case it
    // was provisioned public-blob before S6.
    await container.setAccessPolicy(undefined);
    console.log(
      `Container "${containerName}" already exists — ensured PRIVATE (no public access)`
    );
  }

  // ── Logos container — PUBLIC blob (non-PII branding assets) ─────────
  const logoContainer = client.getContainerClient(logoContainerName!);
  const logoResult = await logoContainer.createIfNotExists({ access: "blob" });
  if (logoResult.succeeded) {
    console.log(
      `Created PUBLIC logos container "${logoContainerName}" (public blob read)`
    );
  } else {
    await logoContainer.setAccessPolicy("blob");
    console.log(
      `Logos container "${logoContainerName}" already exists — ensured public blob access`
    );
  }

  // Account-level CORS (governs both containers; browser cross-origin reads
  // only — it does NOT grant access, so the private CV container still requires
  // a SAS). Restricted to the app origins, never "*".
  const origins = allowedOrigins();
  await client.setProperties({
    cors: [
      {
        allowedOrigins: origins,
        allowedMethods: "GET,HEAD,OPTIONS",
        allowedHeaders: "*",
        exposedHeaders: "*",
        maxAgeInSeconds: 3600,
      },
    ],
  });
  console.log(`Configured CORS (GET/HEAD/OPTIONS) for origins: ${origins}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
