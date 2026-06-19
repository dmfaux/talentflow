CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"client_id" uuid,
	"name" text NOT NULL,
	"scope" text DEFAULT 'gallery' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"palette" jsonb NOT NULL,
	"font_display" text NOT NULL,
	"font_sans" text NOT NULL,
	"logo_url" text,
	"logo_background" text DEFAULT 'light' NOT NULL,
	"logo_position" text DEFAULT 'top-left' NOT NULL,
	"show_powered_by" boolean DEFAULT true NOT NULL,
	"landing_html" text,
	"preview_image_url" text,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "theme_id" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "theme_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "default_theme_id" uuid;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "themes_org_id_idx" ON "themes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "themes_client_id_idx" ON "themes" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_default_theme_id_themes_id_fk" FOREIGN KEY ("default_theme_id") REFERENCES "public"."themes"("id") ON DELETE set null ON UPDATE no action;