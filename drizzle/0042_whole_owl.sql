ALTER TABLE "candidates" ADD COLUMN "gating_source" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "consent_attested_by" uuid;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "consent_attested_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "consent_basis" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "consent_basis_note" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "invite_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_consent_attested_by_users_id_fk" FOREIGN KEY ("consent_attested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;