import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env
import { BlobServiceClient } from "@azure/storage-blob";

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

if (!connectionString) {
  console.error("AZURE_STORAGE_CONNECTION_STRING is not set");
  process.exit(1);
}
if (!containerName) {
  console.error("AZURE_STORAGE_CONTAINER_NAME is not set");
  process.exit(1);
}

async function main() {
  const client = BlobServiceClient.fromConnectionString(connectionString!);
  const container = client.getContainerClient(containerName!);

  const { succeeded } = await container.createIfNotExists({ access: "blob" });
  if (succeeded) {
    console.log(`Created container "${containerName}" with public blob access`);
  } else {
    // Ensure an existing container also has public blob access (local dev)
    await container.setAccessPolicy("blob");
    console.log(
      `Container "${containerName}" already exists — ensured public blob access`
    );
  }

  // CORS so the browser can read logos into a canvas (extractDominantColors)
  await client.setProperties({
    cors: [
      {
        allowedOrigins: "*",
        allowedMethods: "GET,HEAD,OPTIONS",
        allowedHeaders: "*",
        exposedHeaders: "*",
        maxAgeInSeconds: 3600,
      },
    ],
  });
  console.log("Configured CORS (GET/HEAD/OPTIONS from any origin)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
