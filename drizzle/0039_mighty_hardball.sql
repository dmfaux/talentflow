CREATE TABLE "invoice_counters" (
	"id" integer PRIMARY KEY NOT NULL,
	"next_seq" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_type" text NOT NULL,
	"model_tier" text,
	"description" text NOT NULL,
	"quantity_credits" real,
	"unit_rate_zar" real,
	"amount_zar" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_no" text NOT NULL,
	"period" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"currency" text DEFAULT 'ZAR' NOT NULL,
	"subtotal_ex_vat" real NOT NULL,
	"vat_amount" real NOT NULL,
	"total_incl_vat" real NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp,
	"due_at" timestamp,
	"paid_at" timestamp,
	"eft_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_period_key" UNIQUE("org_id","period")
);
--> statement-breakpoint
CREATE TABLE "spend_alert_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"alert_on_threshold" boolean DEFAULT false NOT NULL,
	"threshold_pct" integer,
	"alert_on_summary" boolean DEFAULT false NOT NULL,
	"summary_cadence" text,
	"alert_on_hardcap" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"unsubscribe_token" text NOT NULL,
	"last_alerted_period" text,
	"last_summary_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "spend_alert_subscriptions_user_org_key" UNIQUE("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "usage_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"period" text NOT NULL,
	"model_tier" text NOT NULL,
	"credits" real NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"frozen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "usage_rollups_org_period_tier_key" UNIQUE("org_id","period","model_tier")
);
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_alert_subscriptions" ADD CONSTRAINT "spend_alert_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_alert_subscriptions" ADD CONSTRAINT "spend_alert_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_rollups" ADD CONSTRAINT "usage_rollups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_idx" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_invoice_no_idx" ON "invoices" USING btree ("invoice_no");--> statement-breakpoint
CREATE INDEX "invoices_org_status_idx" ON "invoices" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_alert_subscriptions_token_idx" ON "spend_alert_subscriptions" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "spend_alert_subscriptions_org_idx" ON "spend_alert_subscriptions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "usage_rollups_org_period_idx" ON "usage_rollups" USING btree ("org_id","period");