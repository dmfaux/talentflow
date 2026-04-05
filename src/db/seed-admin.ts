import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { clients, users } from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = requireEnv("SEED_ADMIN_EMAIL").trim().toLowerCase();
  const password = requireEnv("SEED_ADMIN_PASSWORD");
  const firstName = requireEnv("SEED_ADMIN_FIRST_NAME").trim();
  const lastName = requireEnv("SEED_ADMIN_LAST_NAME").trim();
  const clientSlug = requireEnv("SEED_ADMIN_CLIENT_SLUG").trim().toLowerCase();

  if (password.length < 8) {
    console.error("SEED_ADMIN_PASSWORD must be at least 8 characters");
    process.exit(1);
  }

  const client = postgres(connectionString!, { max: 1 });
  const db = drizzle(client, { schema: { clients, users } });

  try {
    const existingUser = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });
    if (existingUser) {
      console.log(`User ${email} already exists. Skipping.`);
      return;
    }

    let clientRow = await db.query.clients.findFirst({
      where: eq(clients.slug, clientSlug),
      columns: { id: true },
    });

    if (!clientRow) {
      console.log(`Client "${clientSlug}" not found — creating it.`);
      const [inserted] = await db
        .insert(clients)
        .values({ slug: clientSlug, name: clientSlug })
        .returning({ id: clients.id });
      clientRow = inserted;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await db.insert(users).values({
      client_id: clientRow.id,
      first_name: firstName,
      last_name: lastName,
      email,
      password_hash: passwordHash,
      security_group: "admin",
    });

    console.log(`Admin user created: ${email} (client: ${clientSlug})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
