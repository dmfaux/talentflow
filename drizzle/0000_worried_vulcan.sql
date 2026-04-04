CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"role_title" text NOT NULL,
	"role_description" text,
	"department" text,
	"location" text,
	"employment_type" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"html_template" text,
	"gating_config" jsonb NOT NULL,
	"scoring_rubric" jsonb NOT NULL,
	"campaign_start" timestamp,
	"campaign_end" timestamp,
	"salary_range_min" integer,
	"salary_range_max" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"whatsapp_opted_in" boolean DEFAULT false,
	"gating_answers" jsonb,
	"gating_passed" boolean,
	"cv_url" text,
	"cv_text" text,
	"ai_score" real,
	"ai_dimensions" jsonb,
	"ai_rationale" text,
	"ai_confidence" text,
	"ai_flags" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"follow_up_notes" text,
	"shortlist_notes" text,
	"source" text,
	"popia_consent_at" timestamp,
	"data_purge_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"billing_email" text,
	"branding_logo_url" text,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"content" text NOT NULL,
	"template_id" text,
	"status" text,
	"external_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scoring_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"model_version" text NOT NULL,
	"full_prompt" text NOT NULL,
	"full_response" text NOT NULL,
	"score" real,
	"processing_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_logs" ADD CONSTRAINT "scoring_logs_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_client_id_idx" ON "campaigns" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candidates_campaign_id_idx" ON "candidates" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "candidates_status_idx" ON "candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "candidates_email_idx" ON "candidates" USING btree ("email");--> statement-breakpoint
CREATE INDEX "messages_candidate_id_idx" ON "messages" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "scoring_logs_candidate_id_idx" ON "scoring_logs" USING btree ("candidate_id");