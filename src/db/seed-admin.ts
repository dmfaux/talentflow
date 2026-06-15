import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config(); // fallback to .env
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { clients, users, organizations, memberships } from "./schema";

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

function requirePassword(name: string): string {
  const v = requireEnv(name);
  if (v.length < 8) {
    console.error(`${name} must be at least 8 characters`);
    process.exit(1);
  }
  return v;
}

async function main() {
  // Owner (tenant admin) credentials.
  const email = requireEnv("SEED_ADMIN_EMAIL").trim().toLowerCase();
  const password = requirePassword("SEED_ADMIN_PASSWORD");
  const firstName = requireEnv("SEED_ADMIN_FIRST_NAME").trim();
  const lastName = requireEnv("SEED_ADMIN_LAST_NAME").trim();
  const clientSlug = requireEnv("SEED_ADMIN_CLIENT_SLUG").trim().toLowerCase();
  // Optional, defaults to "demo-org" so a DB that already ran 0026's backfill
  // reuses that org instead of spawning a second one.
  const orgSlug = (process.env.SEED_ADMIN_ORG_SLUG?.trim().toLowerCase()) || "demo-org";

  // Operator (tenant-less, cross-tenant) credentials — distinct from the owner.
  const operatorEmail = requireEnv("SEED_OPERATOR_EMAIL").trim().toLowerCase();
  const operatorPassword = requirePassword("SEED_OPERATOR_PASSWORD");
  const operatorFirstName = requireEnv("SEED_OPERATOR_FIRST_NAME").trim();
  const operatorLastName = requireEnv("SEED_OPERATOR_LAST_NAME").trim();

  const client = postgres(connectionString!, { max: 1 });
  const db = drizzle(client, {
    schema: { clients, users, organizations, memberships },
  });

  try {
    // 1. Organization — find-or-create by slug. On a fresh DB there are zero
    //    orgs, so the clients trigger can't help the brand insert below; create
    //    the org first and pass org_id explicitly.
    let org = await db.query.organizations.findFirst({
      where: eq(organizations.slug, orgSlug),
      columns: { id: true },
    });
    if (!org) {
      console.log(`Organization "${orgSlug}" not found — creating it.`);
      const [inserted] = await db
        .insert(organizations)
        .values({ slug: orgSlug, name: orgSlug })
        .returning({ id: organizations.id });
      org = inserted;
    }

    // 2. Client (brand) — find-or-create by slug, with org_id set explicitly.
    let brand = await db.query.clients.findFirst({
      where: eq(clients.slug, clientSlug),
      columns: { id: true },
    });
    if (!brand) {
      console.log(`Client "${clientSlug}" not found — creating it.`);
      const [inserted] = await db
        .insert(clients)
        .values({ slug: clientSlug, name: clientSlug, org_id: org.id })
        .returning({ id: clients.id });
      brand = inserted;
    }

    // 3. Owner user — find-or-create. security_group: 'admin' is transitional
    //    (dropped in S13); org_role: 'owner' is the real authz.
    let owner = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });
    if (!owner) {
      const passwordHash = await bcrypt.hash(password, 12);
      const [inserted] = await db
        .insert(users)
        .values({
          client_id: brand.id,
          org_id: org.id,
          org_role: "owner",
          is_operator: false,
          first_name: firstName,
          last_name: lastName,
          email,
          password_hash: passwordHash,
          security_group: "admin",
        })
        .returning({ id: users.id });
      owner = inserted;
      console.log(`Owner user created: ${email} (org: ${orgSlug}, brand: ${clientSlug})`);
    } else {
      console.log(`Owner user ${email} already exists. Skipping creation.`);
    }

    // 4. Membership — brand_admin for the owner on the brand.
    await db
      .insert(memberships)
      .values({
        user_id: owner.id,
        client_id: brand.id,
        brand_role: "brand_admin",
      })
      .onConflictDoNothing({
        target: [memberships.user_id, memberships.client_id],
      });

    // 5. Operator user — tenant-less (org_id NULL, org_role NULL, is_operator
    //    true). client_id is a NOT-NULL placeholder until S13 and carries no
    //    authz meaning for operators. is_operator MUST be set in this insert so
    //    the set_org_id_from_client_user trigger's guard fires and leaves
    //    org_id NULL (don't derive it from the placeholder brand's org).
    const existingOperator = await db.query.users.findFirst({
      where: eq(users.email, operatorEmail),
      columns: { id: true },
    });
    if (!existingOperator) {
      const operatorHash = await bcrypt.hash(operatorPassword, 12);
      const [inserted] = await db
        .insert(users)
        .values({
          client_id: brand.id, // vestigial placeholder (NOT NULL until S13)
          org_id: null,
          org_role: null,
          is_operator: true,
          first_name: operatorFirstName,
          last_name: operatorLastName,
          email: operatorEmail,
          password_hash: operatorHash,
          security_group: "admin",
        })
        .returning({ id: users.id, org_id: users.org_id });
      if (inserted.org_id !== null) {
        throw new Error(
          `Operator ${operatorEmail} was created with a non-NULL org_id (${inserted.org_id}); the trigger guard did not fire.`
        );
      }
      console.log(`Operator user created: ${operatorEmail} (tenant-less)`);
    } else {
      console.log(`Operator user ${operatorEmail} already exists. Skipping creation.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
