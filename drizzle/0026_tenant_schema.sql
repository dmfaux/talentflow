CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_client_unique" UNIQUE("user_id","client_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"billing_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "campaigns" DROP CONSTRAINT "campaigns_client_id_clients_id_fk";
--> statement-breakpoint
ALTER TABLE "candidates" DROP CONSTRAINT "candidates_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "chat_tokens" DROP CONSTRAINT "chat_tokens_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_campaign_id_campaigns_id_fk";
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "password_reset_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "scoring_logs" DROP CONSTRAINT "scoring_logs_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_client_id_clients_id_fk";
--> statement-breakpoint
DROP INDEX "users_email_idx";--> statement-breakpoint
DROP INDEX "jobs_dedup_idx";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_tokens" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_role" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_operator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────
-- S1 backfill + assertion + SET NOT NULL (hand-written; drizzle-kit cannot
-- emit data backfills, RAISE EXCEPTION, or triggers — cf. 0010/0025). The
-- whole migration runs in ONE transaction (drizzle pg dialect), so a failed
-- assertion below rolls the entire migration back. org_id columns were added
-- nullable above; backfill, assert, then SET NOT NULL. jobs.org_id (→ S10)
-- and users.org_id (operators) stay nullable. All guarded for re-runnability.
-- ─────────────────────────────────────────────────────────────────────
-- 1. One demo org wrapping all existing clients-as-brands. tier/billing_email
--    take the organizations column defaults (Decision 2).
INSERT INTO "organizations" ("name", "slug", "tier", "billing_email", "status")
SELECT 'Demo Organization', 'demo-org', 'standard', NULL, 'active'
WHERE NOT EXISTS (SELECT 1 FROM "organizations" WHERE "slug" = 'demo-org');--> statement-breakpoint
UPDATE "clients" SET "org_id" = (SELECT "id" FROM "organizations" WHERE "slug" = 'demo-org')
WHERE "org_id" IS NULL;--> statement-breakpoint
-- 2. Cascade org_id down every leaf via up-joins (each guarded by IS NULL).
UPDATE "campaigns" c      SET "org_id" = cl."org_id" FROM "clients" cl       WHERE c."client_id" = cl."id"       AND c."org_id" IS NULL;--> statement-breakpoint
UPDATE "candidates" ca    SET "org_id" = c."org_id"  FROM "campaigns" c       WHERE ca."campaign_id" = c."id"     AND ca."org_id" IS NULL;--> statement-breakpoint
UPDATE "scoring_logs" s   SET "org_id" = ca."org_id" FROM "candidates" ca     WHERE s."candidate_id" = ca."id"    AND s."org_id" IS NULL;--> statement-breakpoint
UPDATE "messages" m       SET "org_id" = ca."org_id" FROM "candidates" ca     WHERE m."candidate_id" = ca."id"    AND m."org_id" IS NULL;--> statement-breakpoint
UPDATE "conversations" cv SET "org_id" = ca."org_id" FROM "candidates" ca     WHERE cv."candidate_id" = ca."id"   AND cv."org_id" IS NULL;--> statement-breakpoint
UPDATE "chat_tokens" t    SET "org_id" = ca."org_id" FROM "candidates" ca     WHERE t."candidate_id" = ca."id"    AND t."org_id" IS NULL;--> statement-breakpoint
UPDATE "chat_messages" cm SET "org_id" = cv."org_id" FROM "conversations" cv  WHERE cm."conversation_id" = cv."id" AND cm."org_id" IS NULL;--> statement-breakpoint
UPDATE "events" e         SET "org_id" = c."org_id"  FROM "campaigns" c       WHERE e."campaign_id" = c."id"      AND e."org_id" IS NULL;--> statement-breakpoint
-- jobs.org_id: best-effort from payload candidateId; global jobs stay NULL (nullable, → S10).
UPDATE "jobs" j SET "org_id" = ca."org_id" FROM "candidates" ca
WHERE (j."payload"->>'candidateId') IS NOT NULL
  AND (j."payload"->>'candidateId')::uuid = ca."id"
  AND j."org_id" IS NULL;--> statement-breakpoint
-- 3. One brand_admin membership per existing user.
INSERT INTO "memberships" ("user_id", "client_id", "brand_role")
SELECT u."id", u."client_id", 'brand_admin' FROM "users" u
ON CONFLICT ("user_id", "client_id") DO NOTHING;--> statement-breakpoint
-- 4. Users: org_id from their client; existing admins → org_role 'owner'.
--    Decision 1: NO operator promotion here — is_operator stays its default
--    (false) for every existing user. Operator creation is S2's seed-admin job.
UPDATE "users" u SET "org_id" = cl."org_id" FROM "clients" cl
WHERE u."client_id" = cl."id" AND u."org_id" IS NULL;--> statement-breakpoint
UPDATE "users" SET "org_role" = 'owner' WHERE "security_group" = 'admin' AND "org_role" IS NULL;--> statement-breakpoint
-- 5. Pre-check: all brands collapse into one demo org, so (org_id, email) must
--    be unique. Surface a clear error before the unique index turns a dup into
--    an opaque constraint violation.
DO $$
DECLARE dup text;
BEGIN
  SELECT string_agg(email, ', ') INTO dup FROM (
    SELECT "email" FROM "users" WHERE "org_id" IS NOT NULL
    GROUP BY "org_id", "email" HAVING count(*) > 1
  ) d;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'tenant backfill: duplicate (org_id, email) for tenant users: %. Resolve before applying 0026.', dup;
  END IF;
END $$;--> statement-breakpoint
-- 6. Verification assertion — abort if any leaf still has a NULL org_id.
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT 1 FROM "clients"       WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "campaigns"     WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "candidates"    WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "scoring_logs"  WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "messages"      WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "conversations" WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "chat_messages" WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "chat_tokens"   WHERE "org_id" IS NULL
    UNION ALL SELECT 1 FROM "events"        WHERE "org_id" IS NULL
  ) s;
  IF bad > 0 THEN
    RAISE EXCEPTION 'org_id backfill incomplete: % leaf row(s) still NULL', bad;
  END IF;
END $$;--> statement-breakpoint
-- 7. Now safe to enforce NOT NULL on clients + the 8 leaves (NOT jobs, NOT users.org_id).
ALTER TABLE "clients"       ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns"     ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates"    ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_logs"  ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "messages"      ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_tokens"   ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events"        ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_client_id_idx" ON "memberships" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tokens" ADD CONSTRAINT "chat_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_tokens" ADD CONSTRAINT "chat_tokens_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD CONSTRAINT "scoring_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD CONSTRAINT "scoring_logs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_org_id_idx" ON "campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "campaigns_org_status_idx" ON "campaigns" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_org_created_idx" ON "campaigns" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "candidates_org_id_idx" ON "candidates" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "candidates_org_status_idx" ON "candidates" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "candidates_org_created_idx" ON "candidates" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_org_id_idx" ON "chat_messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "chat_tokens_org_id_idx" ON "chat_tokens" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "clients_org_id_idx" ON "clients" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conversations_org_id_idx" ON "conversations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "conversations_org_status_idx" ON "conversations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "events_org_id_idx" ON "events" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "events_org_created_idx" ON "events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_org_id_idx" ON "jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "messages_org_id_idx" ON "messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "messages_org_created_idx" ON "messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "scoring_logs_org_id_idx" ON "scoring_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "scoring_logs_org_created_idx" ON "scoring_logs" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_org_email_idx" ON "users" USING btree ("org_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_operator_email_idx" ON "users" USING btree ("email") WHERE "users"."is_operator";--> statement-breakpoint
CREATE INDEX "users_org_id_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_idx" ON "jobs" USING btree ("deduplication_id") WHERE "jobs"."deduplication_id" IS NOT NULL AND "jobs"."status" IN ('pending', 'processing');--> statement-breakpoint
-- ─────────────────────────────────────────────────────────────────────
-- Transitional BEFORE INSERT triggers (Decision 4). They fill org_id ONLY
-- when the writer left it NULL, so once S5 sets org_id explicitly the IS NULL
-- guard makes them no-ops. Load-bearing for existing runtime writers AND for
-- db:seed re-seeds (neither sets org_id). Removed in S13. CREATE OR REPLACE +
-- DROP TRIGGER IF EXISTS keep this re-runnable.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_org_id_from_client() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_org_id_from_campaign() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM campaigns WHERE id = NEW.campaign_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_org_id_from_candidate() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM candidates WHERE id = NEW.candidate_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_org_id_from_conversation() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT org_id INTO NEW.org_id FROM conversations WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- clients has no parent: fill from the SOLE org while only the demo org exists.
-- If 0 or >1 orgs exist, leave NULL so NOT NULL rejects the insert LOUDLY (by
-- then S5/S9 set org_id explicitly). A column DEFAULT was rejected (Decision 4):
-- it would outlive the single-org window and silently misattribute new brands.
CREATE OR REPLACE FUNCTION set_org_id_default_org() RETURNS trigger AS $$
DECLARE org_count int;
BEGIN
  IF NEW.org_id IS NULL THEN
    SELECT count(*) INTO org_count FROM organizations;
    IF org_count = 1 THEN SELECT id INTO NEW.org_id FROM organizations; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
-- users: derive org_id from the user's client, but NEVER for operators
-- (is_operator=true is inserted with an explicit NULL org_id — don't clobber).
CREATE OR REPLACE FUNCTION set_org_id_from_client_user() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.is_operator IS NOT TRUE THEN
    SELECT org_id INTO NEW.org_id FROM clients WHERE id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_campaigns_org_id ON campaigns;--> statement-breakpoint
CREATE TRIGGER trg_campaigns_org_id BEFORE INSERT ON campaigns FOR EACH ROW EXECUTE FUNCTION set_org_id_from_client();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_candidates_org_id ON candidates;--> statement-breakpoint
CREATE TRIGGER trg_candidates_org_id BEFORE INSERT ON candidates FOR EACH ROW EXECUTE FUNCTION set_org_id_from_campaign();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_events_org_id ON events;--> statement-breakpoint
CREATE TRIGGER trg_events_org_id BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION set_org_id_from_campaign();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_scoring_logs_org_id ON scoring_logs;--> statement-breakpoint
CREATE TRIGGER trg_scoring_logs_org_id BEFORE INSERT ON scoring_logs FOR EACH ROW EXECUTE FUNCTION set_org_id_from_candidate();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_messages_org_id ON messages;--> statement-breakpoint
CREATE TRIGGER trg_messages_org_id BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION set_org_id_from_candidate();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_conversations_org_id ON conversations;--> statement-breakpoint
CREATE TRIGGER trg_conversations_org_id BEFORE INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION set_org_id_from_candidate();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chat_tokens_org_id ON chat_tokens;--> statement-breakpoint
CREATE TRIGGER trg_chat_tokens_org_id BEFORE INSERT ON chat_tokens FOR EACH ROW EXECUTE FUNCTION set_org_id_from_candidate();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chat_messages_org_id ON chat_messages;--> statement-breakpoint
CREATE TRIGGER trg_chat_messages_org_id BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION set_org_id_from_conversation();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_clients_org_id ON clients;--> statement-breakpoint
CREATE TRIGGER trg_clients_org_id BEFORE INSERT ON clients FOR EACH ROW EXECUTE FUNCTION set_org_id_default_org();--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_users_org_id ON users;--> statement-breakpoint
CREATE TRIGGER trg_users_org_id BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION set_org_id_from_client_user();