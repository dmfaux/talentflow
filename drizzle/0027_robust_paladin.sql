-- S7: operator_audit — the tenant-less audit trail for operator act-as actions.
-- One new table, no backfill (clean on a fresh DB, idempotent on the seeded DB).
-- NOTE: drizzle-kit also emitted redundant `ALTER COLUMN org_id SET NOT NULL`
-- statements for the leaf tables because the 0026 snapshot predates S5's
-- model-level .notNull() flip (0026_tenant_schema.sql already applies those
-- constraints at lines 133-141). They were stripped here so this migration is
-- scoped to S7; the 0027 snapshot records the correct end-state, so the drift
-- is resolved without re-running no-op ALTERs against the seeded DB.
CREATE TABLE "operator_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_org_id" uuid,
	"metadata" jsonb,
	"ip" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_audit" ADD CONSTRAINT "operator_audit_operator_user_id_users_id_fk" FOREIGN KEY ("operator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit" ADD CONSTRAINT "operator_audit_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operator_audit_operator_idx" ON "operator_audit" USING btree ("operator_user_id");--> statement-breakpoint
CREATE INDEX "operator_audit_target_org_idx" ON "operator_audit" USING btree ("target_org_id");--> statement-breakpoint
CREATE INDEX "operator_audit_action_idx" ON "operator_audit" USING btree ("action");
