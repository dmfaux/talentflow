import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";
import {
  blobKeyFromStored,
  cvBlobPath,
  logoBlobPath,
} from "./blob-paths";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export function isStorageConfigured(): boolean {
  return !!(
    process.env.AZURE_STORAGE_CONNECTION_STRING &&
    process.env.AZURE_STORAGE_CONTAINER_NAME
  );
}

const isConfigured = isStorageConfigured;

let blobServiceClient: BlobServiceClient | null = null;

function getServiceClient(): BlobServiceClient {
  if (!blobServiceClient) {
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString)
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
    blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
  }
  return blobServiceClient;
}

/** The private CV/PII container (SAS-only reads). */
function getContainerClient(): ContainerClient {
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  if (!containerName)
    throw new Error("AZURE_STORAGE_CONTAINER_NAME is not set");
  return getServiceClient().getContainerClient(containerName);
}

export function getLogoContainerName(): string | undefined {
  return process.env.AZURE_STORAGE_LOGO_CONTAINER_NAME;
}

/** The public logos container (non-PII branding assets; S6 Resolved Decision 1).
 *  Separate from the CV container so flipping CVs to private never breaks the
 *  directly-embedded `branding_logo_url` on careers/chat/admin pages. */
function getLogoContainerClient(): ContainerClient {
  const containerName = getLogoContainerName();
  if (!containerName)
    throw new Error("AZURE_STORAGE_LOGO_CONTAINER_NAME is not set");
  return getServiceClient().getContainerClient(containerName);
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export async function uploadCV(
  orgId: string,
  brandSlug: string,
  candidateId: string,
  file: Buffer,
  filename: string
): Promise<string | null> {
  if (!isConfigured()) {
    console.warn("Azure Storage not configured — CV discarded for", candidateId);
    return null;
  }

  const container = getContainerClient();
  const ext = getExtension(filename);
  const blobPath = cvBlobPath(orgId, brandSlug, candidateId, filename);
  const blockBlob = container.getBlockBlobClient(blobPath);

  await blockBlob.uploadData(file, {
    blobHTTPHeaders: {
      blobContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    },
  });

  // Return the relative blob PATH (key), never the raw blob URL. The CV
  // container is private, so the only readable URL is a short-lived SAS minted
  // by generateSasUrl. A bare path flows unchanged through downloadBlob /
  // deleteCV / generateSasUrl (their prefix-strip is a no-op on a path).
  return blobPath;
}

export async function uploadClientLogo(
  orgId: string,
  clientId: string,
  file: Buffer,
  filename: string
): Promise<string | null> {
  if (!isConfigured() || !getLogoContainerName()) {
    console.warn(
      "Azure logo storage not configured — logo discarded for",
      clientId
    );
    return null;
  }

  const container = getLogoContainerClient();
  const ext = getExtension(filename);
  const blobPath = logoBlobPath(orgId, clientId, filename);
  const blockBlob = container.getBlockBlobClient(blobPath);

  await blockBlob.uploadData(file, {
    blobHTTPHeaders: {
      blobContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
      blobCacheControl: "public, max-age=3600",
    },
  });

  // Logos live in the PUBLIC logos container, so a direct URL is fine and keeps
  // branding_logo_url a directly-usable <img> src (Resolved Decision 1). The
  // "stop returning raw blockBlob.url" rule applies to CVs only.
  return blockBlob.url;
}

export async function downloadBlob(
  blobPath: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isConfigured()) {
    console.warn("Azure Storage not configured — cannot download blob");
    return null;
  }

  const container = getContainerClient();
  const key = blobKeyFromStored(blobPath, container.url);
  const blockBlob = container.getBlockBlobClient(key);

  const response = await blockBlob.download(0);
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody!) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return {
    buffer: Buffer.concat(chunks),
    contentType: response.contentType ?? "application/octet-stream",
  };
}

export async function deleteCV(blobPath: string): Promise<void> {
  if (!isConfigured()) return;

  const container = getContainerClient();
  const key = blobKeyFromStored(blobPath, container.url);
  const blockBlob = container.getBlockBlobClient(key);
  await blockBlob.deleteIfExists();
}

/** Org-wide prefix delete for the S11 hard purge. Both blob schemes put orgId
 *  at path depth 1 (cvs/{orgId}/…, logos/{orgId}/…), so the prefix is a clean
 *  tenant boundary. The SDK's async iterator handles listing pagination. Keys
 *  off the path scheme, not the stored value, so it wipes CVs (relative paths)
 *  and logos (public URLs) alike. Unconfigured (local dev) → safe no-op; the
 *  DB cascade remains the source of truth for "zero rows". Idempotent via
 *  deleteIfExists, mirroring deleteCV. */
export async function deleteOrgBlobsByPrefix(
  orgId: string,
  kind: "cv" | "logo"
): Promise<void> {
  if (!isConfigured()) return;
  if (kind === "logo" && !getLogoContainerName()) return; // logo container optional

  const container = kind === "cv" ? getContainerClient() : getLogoContainerClient();
  const prefix = `${kind === "cv" ? "cvs" : "logos"}/${orgId}/`;

  for await (const blob of container.listBlobsFlat({ prefix })) {
    await container.getBlockBlobClient(blob.name).deleteIfExists();
  }
}

export function generateSasUrl(
  blobPath: string,
  expiresInHours: number
): string | null {
  if (!isConfigured()) return null;

  const client = getServiceClient();
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME!;
  const container = client.getContainerClient(containerName);
  const key = blobKeyFromStored(blobPath, container.url);

  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;
  const accountName = connectionString.match(/AccountName=([^;]+)/)?.[1];
  const accountKey = connectionString.match(/AccountKey=([^;]+)/)?.[1];

  if (!accountName || !accountKey) {
    throw new Error("Cannot extract credentials from connection string");
  }

  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const startsOn = new Date();
  const expiresOn = new Date(
    startsOn.getTime() + expiresInHours * 60 * 60 * 1000
  );

  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: key,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    credential
  );

  // Build the absolute blob URL from the key (the stored value is a bare path
  // now), then append the SAS — this short-lived URL is the ONLY readable CV URL.
  const blobUrl = container.getBlockBlobClient(key).url;
  return `${blobUrl}?${sas.toString()}`;
}
