import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { templates } from "@/db/schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const seedTemplates = [
  {
    key: "editorial",
    name: "Editorial",
    description:
      "Typography-forward design with generous whitespace. Suited to senior professional roles — finance, legal, consulting.",
    thumbnail_url: "/templates/editorial.svg",
    owner_client_id: null,
    source: "builtin",
    is_active: true,
  },
  {
    key: "corporate",
    name: "Corporate",
    description:
      "Structured, formal layout with clear hierarchy and a strong hero. Suited to banking, insurance, and large enterprise.",
    thumbnail_url: "/templates/corporate.svg",
    owner_client_id: null,
    source: "builtin",
    is_active: true,
  },
  {
    key: "modern",
    name: "Modern",
    description:
      "Split-screen hero with geometric accents and a floating form card. Suited to tech companies, scale-ups, and product roles.",
    thumbnail_url: "/templates/modern.svg",
    owner_client_id: null,
    source: "builtin",
    is_active: true,
  },
];

async function main() {
  const client = postgres(connectionString!, { max: 1 });
  const db = drizzle(client, { schema: { templates } });

  try {
    const inserted = await db
      .insert(templates)
      .values(seedTemplates)
      .onConflictDoNothing({ target: templates.key })
      .returning({ id: templates.id });

    console.log(`Inserted ${inserted.length} template row(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
