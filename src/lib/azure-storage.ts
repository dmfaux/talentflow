import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} from "@azure/storage-blob";

const CONTENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function isConfigured(): boolean {
  return !!(
    process.env.AZURE_STORAGE_CONNECTION_STRING &&
    process.env.AZURE_STORAGE_CONTAINER_NAME
  );
}

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

function getContainerClient(): ContainerClient {
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  if (!containerName)
    throw new Error("AZURE_STORAGE_CONTAINER_NAME is not set");
  return getServiceClient().getContainerClient(containerName);
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

export async function uploadCV(
  clientSlug: string,
  campaignSlug: string,
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
  const blobPath = `cvs/${clientSlug}/${campaignSlug}/${candidateId}/${filename}`;
  const blockBlob = container.getBlockBlobClient(blobPath);

  await blockBlob.uploadData(file, {
    blobHTTPHeaders: {
      blobContentType: CONTENT_TYPES[ext] ?? "application/octet-stream",
    },
  });

  return blockBlob.url;
}

export async function downloadBlob(
  blobUrl: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isConfigured()) {
    console.warn("Azure Storage not configured — cannot download blob");
    return null;
  }

  const container = getContainerClient();
  const containerUrl = container.url.replace(/\/$/, "");
  const blobPath = blobUrl.replace(containerUrl + "/", "");
  const blockBlob = container.getBlockBlobClient(blobPath);

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

export async function deleteCV(blobUrl: string): Promise<void> {
  if (!isConfigured()) return;

  const container = getContainerClient();
  const containerUrl = container.url.replace(/\/$/, "");
  const blobPath = blobUrl.replace(containerUrl + "/", "");
  const blockBlob = container.getBlockBlobClient(blobPath);
  await blockBlob.deleteIfExists();
}

export function generateSasUrl(
  blobUrl: string,
  expiresInHours: number
): string | null {
  if (!isConfigured()) return null;

  const client = getServiceClient();
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME!;
  const container = client.getContainerClient(containerName);
  const containerUrl = container.url.replace(/\/$/, "");
  const blobPath = blobUrl.replace(containerUrl + "/", "");

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
      blobName: blobPath,
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn,
    },
    credential
  );

  return `${blobUrl}?${sas.toString()}`;
}
