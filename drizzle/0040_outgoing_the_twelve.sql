CREATE TABLE "candidate_action_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"candidate_id" uuid,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"reason_sent_to_candidate" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "rejection_recommended_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "rejection_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_action_audit" ADD CONSTRAINT "candidate_action_audit_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_action_audit" ADD CONSTRAINT "candidate_action_audit_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_action_audit" ADD CONSTRAINT "candidate_action_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "candidate_action_audit_candidate_idx" ON "candidate_action_audit" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "candidate_action_audit_org_created_idx" ON "candidate_action_audit" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "candidate_action_audit_action_idx" ON "candidate_action_audit" USING btree ("action");