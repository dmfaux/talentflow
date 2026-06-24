import { relations, sql } from "drizzle-orm";
import type { ThemeSnapshot } from "@/lib/theme";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ── Organizations (tenant level above clients=brands) ───────────────

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    tier: text("tier").notNull().default("standard"), // moved up from clients (copy)
    billing_email: text("billing_email"), // moved up from clients (copy) — operator-owned
    // Tenant-editable org contact (S9), distinct from the operator-owned
    // billing_email. Both nullable/backfill-free; written via the tenant
    // PATCH /api/admin/organization (manage_org_settings = org_admin+).
    contact_name: text("contact_name"),
    contact_email: text("contact_email"),
    status: text("status").notNull().default("active"), // active | suspended | deleted
    suspended_at: timestamp("suspended_at"),
    deleted_at: timestamp("deleted_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_idx").on(table.slug)]
);

// ── Clients (= brands) ──────────────────────────────────────────────

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // DB-level NOT NULL is enforced by migration 0026. S5 flipped the model to
    // .notNull() once every brand writer stamps org_id explicitly; S13 dropped
    // the sole-org trigger backstop now that coverage is complete.
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    tier: text("tier").notNull().default("standard"),
    contact_name: text("contact_name"),
  contact_email: text("contact_email"),
  contact_phone: text("contact_phone"),
  billing_email: text("billing_email"),
  // Per-brand outbound-email identity (S10). Both nullable/backfill-free.
  // Deliverability-safe by design: from_name personalises the DISPLAY name
  // only — the verified envelope-from (EMAIL_FROM) is always retained, since
  // brands have no SPF/DKIM/domain verification. reply_to_email routes
  // candidate replies. A brand with neither set keeps today's global default.
  from_name: text("from_name"),
  reply_to_email: text("reply_to_email"),
  branding_logo_url: text("branding_logo_url"),
  brand_primary_color: text("brand_primary_color"),
  brand_secondary_color: text("brand_secondary_color"),
  brand_accent_color: text("brand_accent_color"),
  brand_text_color: text("brand_text_color").default("#11123c"),
  logo_background: text("logo_background").default("light"),
  logo_position: text("logo_position").default("top-left"),
  // Per-brand default campaign theme (Campaign Themes CT1). Nullable: a brand
  // with no default inherits the gallery/default look. onDelete "set null" so a
  // deleted theme degrades the brand to inheritance rather than orphaning it.
  // The `: AnyPgColumn` annotation breaks the clients⟷themes circular-FK type
  // inference cycle (themes.client_id → clients, clients.default_theme_id → themes).
  default_theme_id: uuid("default_theme_id").references(
    (): AnyPgColumn => themes.id,
    { onDelete: "set null" }
  ),
  notes: text("notes"),
    is_active: boolean("is_active").default(true),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("clients_slug_idx").on(table.slug),
    index("clients_org_id_idx").on(table.org_id),
  ]
);

// ── Themes (Campaign Themes CT1) ────────────────────────────────────
//
// The baked look applied to a campaign's emails (CT1) and landing page (CT4).
// A GALLERY theme (scope "gallery") has null org_id/client_id and is pickable by
// every tenant; a CUSTOM theme (scope "custom") is org/brand-scoped and authored
// by an operator (CT2). `palette` holds the EmailTheme palette keys; logo_url is
// null on a gallery theme so it adopts the rendering brand's branding_logo_url
// at resolve time. landing_html (CT4) and preview_image_url (CT2/CT3) are created
// here but only consumed downstream. The resolver in src/lib/theme.ts is the sole
// read point; CT1 ships with these columns dormant (no brand/campaign points at a
// theme yet), so every campaign falls through to today's look.

export const themes = pgTable(
  "themes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }), // null = gallery
    client_id: uuid("client_id").references((): AnyPgColumn => clients.id, {
      onDelete: "cascade",
    }), // null for gallery (annotation breaks the circular-FK type cycle)
    name: text("name").notNull(),
    scope: text("scope").notNull().default("gallery"), // "gallery" | "custom"
    is_active: boolean("is_active").notNull().default(true),
    palette: jsonb("palette").notNull(), // EmailTheme.palette keys — the DERIVED 11 tokens
    // The 3 author-chosen SEED colours (primary/accent/bg) that derive `palette`
    // via derivePalette (theme-colors). Nullable: legacy rows authored before
    // seed-based editing carry only `palette`; the builder back-fills seeds from
    // palette.primary/accent/bg when one of these is null.
    seed_primary: text("seed_primary"),
    seed_accent: text("seed_accent"),
    seed_bg: text("seed_bg"),
    // Per-token operator OVERRIDES of the derived palette. A PARTIAL map of only
    // the tokens the operator pinned by hand (e.g. a neutral-grey ink ramp instead
    // of the primary-tinted derivation); the rest keep tracking the seeds. The
    // stored `palette` above is the fully resolved map — derivePalette(seeds) with
    // these merged over it — so renderers read one column and never re-derive.
    // Null/`{}` = pure derivation. Legacy direct-palette rows carry null.
    palette_overrides: jsonb("palette_overrides"),
    font_display: text("font_display").notNull(), // resolved CSS stack (webfont + email-safe fallbacks)
    font_sans: text("font_sans").notNull(), // resolved CSS stack
    // The curated font-registry keys the operator picked (theme-fonts). Drive the
    // builder dropdowns and the per-font @import URLs at resolve time. Nullable for
    // legacy rows (the resolver falls back to the stored stacks + default imports).
    font_display_key: text("font_display_key"),
    font_body_key: text("font_body_key"),
    logo_url: text("logo_url"), // null → adopt rendering brand's branding_logo_url
    logo_background: text("logo_background").notNull().default("light"),
    logo_position: text("logo_position").notNull().default("top-left"),
    show_powered_by: boolean("show_powered_by").notNull().default(true),
    landing_html: text("landing_html"), // bespoke landing page (custom/Premium themes only)
    // The bespoke email "shell": one MSO-safe HTML document whose chrome matches
    // the bespoke landing, carrying a BODY_MARKER where each transactional email's
    // body is injected at send time. Custom-scope themes only (write-side forces
    // null for gallery), so the resolver renders it unconditionally without a tier
    // re-check; rides into theme_snapshot.email at freeze.
    email_shell: text("email_shell"),
    preview_image_url: text("preview_image_url"), // operator-uploaded preview thumbnail
    created_by: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("themes_org_id_idx").on(table.org_id),
    index("themes_client_id_idx").on(table.client_id),
  ]
);

export const themesRelations = relations(themes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [themes.org_id],
    references: [organizations.id],
  }),
  // The brand a CUSTOM theme belongs to (themes.client_id). Distinct relation
  // from clients.defaultTheme (clients.default_theme_id → themes) — there are two
  // FK links between clients and themes, so each logical relation declares both
  // ends with a matching relationName to disambiguate.
  client: one(clients, {
    fields: [themes.client_id],
    references: [clients.id],
    relationName: "brandCustomThemes",
  }),
  // Reverse of clients.defaultTheme — a theme may be the default for many brands.
  defaultForBrands: many(clients, { relationName: "brandDefaultTheme" }),
  creator: one(users, {
    fields: [themes.created_by],
    references: [users.id],
  }),
}));

// ── Memberships (per-brand role for a user) ─────────────────────────

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    client_id: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    brand_role: text("brand_role").notNull(), // brand_admin | recruiter | viewer
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("memberships_user_client_unique").on(table.user_id, table.client_id),
    index("memberships_user_id_idx").on(table.user_id),
    index("memberships_client_id_idx").on(table.client_id),
  ]
);

// ── Campaigns ────────────────────────────────────────────────────────

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    client_id: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    slug: text("slug").notNull(),
    role_title: text("role_title").notNull(),
    role_description: text("role_description"),
    department: text("department"),
    location: text("location"),
    employment_type: text("employment_type"),
    status: text("status").notNull().default("draft"),
    gating_config: jsonb("gating_config").notNull(),
    scoring_rubric: jsonb("scoring_rubric").notNull(),
    campaign_start: timestamp("campaign_start"),
    campaign_end: timestamp("campaign_end"),
    salary_range_min: integer("salary_range_min"),
    salary_range_max: integer("salary_range_max"),
    chat_lifecycle: text("chat_lifecycle").notNull().default("dormant"),
    ghost_ttl_days: integer("ghost_ttl_days").notNull().default(10),
    // Campaign Themes CT1. theme_id is a campaign-level override of the brand
    // default (set in CT3); onDelete "set null" degrades to inheritance.
    // theme_snapshot freezes the resolved look at activation (RD-1) so editing a
    // theme never changes a live campaign — null while draft.
    theme_id: uuid("theme_id").references(() => themes.id, {
      onDelete: "set null",
    }),
    theme_snapshot: jsonb("theme_snapshot").$type<ThemeSnapshot>(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("campaigns_client_id_slug_unique").on(table.client_id, table.slug),
    index("campaigns_client_id_idx").on(table.client_id),
    index("campaigns_status_idx").on(table.status),
    index("campaigns_org_id_idx").on(table.org_id),
    index("campaigns_org_status_idx").on(table.org_id, table.status),
    index("campaigns_org_created_idx").on(table.org_id, table.created_at),
  ]
);

// ── Candidates ───────────────────────────────────────────────────────

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    whatsapp_opted_in: boolean("whatsapp_opted_in").default(false),
    chat_token_hash: text("chat_token_hash"),
    gating_answers: jsonb("gating_answers"),
    gating_passed: boolean("gating_passed"),
    cv_url: text("cv_url"),
    cv_text: text("cv_text"),
    ai_score: real("ai_score"),
    ai_dimensions: jsonb("ai_dimensions"),
    ai_rationale: text("ai_rationale"),
    ai_confidence: text("ai_confidence"),
    ai_flags: jsonb("ai_flags"),
    status: text("status").notNull().default("new"),
    rejection_reason: text("rejection_reason"),
    /** Set when an admin triggers rejection of an actively-chatting candidate.
     *  The rejection email is queued with a delay; if the candidate completes
     *  the chat and triggers a re-score before the job fires, this is cleared
     *  and the queued email self-checks and no-ops. */
    pending_rejection_at: timestamp("pending_rejection_at"),
    /** Set when the chat-nudge job has fired for a ghosting candidate, so the
     *  nudge isn't sent twice. */
    nudge_sent_at: timestamp("nudge_sent_at"),
    follow_up_notes: text("follow_up_notes"),
    shortlist_notes: text("shortlist_notes"),
    source: text("source"),
    popia_consent_at: timestamp("popia_consent_at"),
    data_purge_at: timestamp("data_purge_at"),
    purged_at: timestamp("purged_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("candidates_campaign_id_idx").on(table.campaign_id),
    index("candidates_status_idx").on(table.status),
    index("candidates_email_idx").on(table.email),
    index("candidates_org_id_idx").on(table.org_id),
    index("candidates_org_status_idx").on(table.org_id, table.status),
    index("candidates_org_created_idx").on(table.org_id, table.created_at),
  ]
);

// ── Scoring Logs ─────────────────────────────────────────────────────

export const scoringLogs = pgTable(
  "scoring_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    provider: text("provider"),
    model_version: text("model_version").notNull(),
    full_prompt: text("full_prompt").notNull(),
    full_response: text("full_response").notNull(),
    score: real("score"),
    processing_time_ms: integer("processing_time_ms"),
    fallback_chain: jsonb("fallback_chain"),
    scoring_type: text("scoring_type").notNull().default("initial"),
    dimensions: jsonb("dimensions"),
    confidence: text("confidence"),
    rationale: text("rationale"),
    flags: jsonb("flags"),
    recommendation: text("recommendation"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("scoring_logs_candidate_id_idx").on(table.candidate_id),
    index("scoring_logs_org_id_idx").on(table.org_id),
    index("scoring_logs_org_created_idx").on(table.org_id, table.created_at),
  ]
);

// ── Users ────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }), // NULLABLE: operators have no org (DB + model nullable)
    org_role: text("org_role"), // owner | org_admin | null
    is_operator: boolean("is_operator").notNull().default(false),
    first_name: text("first_name").notNull(),
    last_name: text("last_name").notNull(),
    email: text("email").notNull(),
    password_hash: text("password_hash").notNull(),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // Global email unique (users_email_idx) is dropped in 0026. Email is now
    // unique per-org for tenant users via (org_id, email); NULLs are distinct
    // in a multi-column unique, so that does NOT constrain operators (org_id
    // NULL) — the partial unique on email WHERE is_operator does.
    uniqueIndex("users_org_email_idx").on(table.org_id, table.email),
    uniqueIndex("users_operator_email_idx")
      .on(table.email)
      .where(sql`${table.is_operator}`),
    index("users_org_id_idx").on(table.org_id),
  ]
);

// ── Password reset tokens ────────────────────────────────────────────

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token_hash: text("token_hash").notNull(),
    expires_at: timestamp("expires_at").notNull(),
    used_at: timestamp("used_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_idx").on(table.token_hash),
    index("password_reset_tokens_user_id_idx").on(table.user_id),
  ]
);

// ── Invitations (S8) ─────────────────────────────────────────────────
//
// The colleague-actioned onboarding token. Mirrors the hardened sha256 /
// single-use / TTL pattern of password_reset_tokens, with accepted_at standing
// in for used_at. A BRAND invite carries client_id + brand_role; an ORG-LEVEL
// invite (Owner/Org-Admin spanning every brand) carries org_role and leaves
// client_id null — the path S9 reuses to seat the first Owner of an empty org.
// Written only by the invite route, which stamps org_id explicitly from
// ctx.effectiveOrgId (no org_id-stamping trigger dependency).

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(), // stored lowercased/trimmed (match users + login)
    // Nullable for an ORG-LEVEL invite. A brand invite carries client_id +
    // brand_role; an org invite carries org_role.
    client_id: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    org_role: text("org_role"), // owner | org_admin | null
    brand_role: text("brand_role"), // brand_admin | recruiter | viewer | null
    token_hash: text("token_hash").notNull(), // sha256(raw), mirrors password_reset_tokens
    expires_at: timestamp("expires_at").notNull(),
    accepted_at: timestamp("accepted_at"), // null = pending (the single-use flag)
    invited_by: uuid("invited_by").references(() => users.id, {
      onDelete: "set null", // keep the invite row legible after the inviter leaves
    }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_idx").on(table.token_hash),
    // unique(org_id, email) WHILE PENDING — one live invite per email per org.
    // Partial so a re-invite after accept/expiry-cleanup is allowed (accepted
    // rows have a non-null accepted_at and drop out of the index).
    uniqueIndex("invitations_org_email_pending_idx")
      .on(table.org_id, table.email)
      .where(sql`${table.accepted_at} IS NULL`),
    index("invitations_org_id_idx").on(table.org_id),
    index("invitations_expires_at_idx").on(table.expires_at),
  ]
);

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.org_id],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [invitations.client_id],
    references: [clients.id],
  }),
  inviter: one(users, {
    fields: [invitations.invited_by],
    references: [users.id],
  }),
}));

// ── Messages ─────────────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    channel: text("channel").notNull(),
    direction: text("direction").notNull(),
    content: text("content").notNull(),
    template_id: text("template_id"),
    status: text("status"),
    external_id: text("external_id"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("messages_candidate_id_idx").on(table.candidate_id),
    index("messages_org_id_idx").on(table.org_id),
    index("messages_org_created_idx").on(table.org_id, table.created_at),
  ]
);

// ── Conversations (chat) ────────────────────────────────────────────

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    status: text("status").notNull().default("active"),
    lifecycle: text("lifecycle").notNull().default("dormant"),
    topics: jsonb("topics"),
    topics_covered_count: integer("topics_covered_count").notNull().default(0),
    last_activity_at: timestamp("last_activity_at").defaultNow().notNull(),
    dormant_after_minutes: integer("dormant_after_minutes").notNull().default(30),
    closed_reason: text("closed_reason"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("conversations_candidate_id_idx").on(table.candidate_id),
    index("conversations_status_idx").on(table.status),
    index("conversations_org_id_idx").on(table.org_id),
    index("conversations_org_status_idx").on(table.org_id, table.status),
  ]
);

// ── Chat Messages ───────────────────────────────────────────────────

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversation_id: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    role: text("role").notNull(),
    content: text("content").notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_conversation_id_idx").on(table.conversation_id),
    index("chat_messages_created_at_idx").on(table.created_at),
    index("chat_messages_org_id_idx").on(table.org_id),
  ]
);

// ── Chat Tokens (magic link) ───────────────────────────────────────

export const chatTokens = pgTable(
  "chat_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    token_hash: text("token_hash").notNull(),
    expires_at: timestamp("expires_at").notNull(),
    used_at: timestamp("used_at"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("chat_tokens_hash_idx").on(table.token_hash),
    index("chat_tokens_candidate_id_idx").on(table.candidate_id),
    index("chat_tokens_org_id_idx").on(table.org_id),
  ]
);

// ── Events (visitor tracking) ───────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, {
        onDelete: "cascade",
      }), // DB + model NOT NULL (S5 flip); every writer stamps org_id (S13 dropped the trigger backstop)
    event_type: text("event_type").notNull(),
    session_id: text("session_id").notNull(),
    visitor_id: text("visitor_id"),
    device_type: text("device_type"),
    browser: text("browser"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("events_campaign_id_idx").on(table.campaign_id),
    index("events_event_type_idx").on(table.event_type),
    index("events_created_at_idx").on(table.created_at),
    index("events_session_id_idx").on(table.session_id),
    index("events_visitor_id_idx").on(table.visitor_id),
    index("events_org_id_idx").on(table.org_id),
    index("events_org_created_idx").on(table.org_id, table.created_at),
  ]
);

// ── Relations ────────────────────────────────────────────────────────

export const organizationsRelations = relations(organizations, ({ many }) => ({
  clients: many(clients),
  users: many(users),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.user_id],
    references: [users.id],
  }),
  client: one(clients, {
    fields: [memberships.client_id],
    references: [clients.id],
  }),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [clients.org_id],
    references: [organizations.id],
  }),
  campaigns: many(campaigns),
  memberships: many(memberships),
  // The brand's default theme (CT1; clients.default_theme_id → themes). Distinct
  // relationName from the themes.client edge (themes.client_id → clients), which
  // is the reverse-direction "custom theme owned by brand" link.
  defaultTheme: one(themes, {
    fields: [clients.default_theme_id],
    references: [themes.id],
    relationName: "brandDefaultTheme",
  }),
  // Reverse of themes.client — a brand owns many custom themes.
  customThemes: many(themes, { relationName: "brandCustomThemes" }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.org_id],
    references: [organizations.id],
  }),
  passwordResetTokens: many(passwordResetTokens),
  memberships: many(memberships),
}));

export const passwordResetTokensRelations = relations(
  passwordResetTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordResetTokens.user_id],
      references: [users.id],
    }),
  })
);

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  client: one(clients, {
    fields: [campaigns.client_id],
    references: [clients.id],
  }),
  candidates: many(candidates),
  events: many(events),
  // Campaign-level theme override (CT1; set in CT3).
  theme: one(themes, {
    fields: [campaigns.theme_id],
    references: [themes.id],
  }),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [candidates.campaign_id],
    references: [campaigns.id],
  }),
  scoringLogs: many(scoringLogs),
  messages: many(messages),
  conversations: many(conversations),
  chatTokens: many(chatTokens),
}));

export const scoringLogsRelations = relations(scoringLogs, ({ one }) => ({
  candidate: one(candidates, {
    fields: [scoringLogs.candidate_id],
    references: [candidates.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  candidate: one(candidates, {
    fields: [messages.candidate_id],
    references: [candidates.id],
  }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [events.campaign_id],
    references: [campaigns.id],
  }),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    candidate: one(candidates, {
      fields: [conversations.candidate_id],
      references: [candidates.id],
    }),
    chatMessages: many(chatMessages),
  })
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [chatMessages.conversation_id],
    references: [conversations.id],
  }),
}));

export const chatTokensRelations = relations(chatTokens, ({ one }) => ({
  candidate: one(candidates, {
    fields: [chatTokens.candidate_id],
    references: [candidates.id],
  }),
}));

// ── Jobs (queue) ────────────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    deliver_at: timestamp("deliver_at").defaultNow().notNull(),
    attempts: integer("attempts").notNull().default(0),
    max_attempts: integer("max_attempts").notNull().default(3),
    last_error: text("last_error"),
    locked_until: timestamp("locked_until"),
    deduplication_id: text("deduplication_id"),
    // Nullable in DB + model: jobs.org_id is populated by S10 (not 0026).
    // Global jobs and the raw-SQL backstop legitimately leave this NULL.
    org_id: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    created_at: timestamp("created_at").defaultNow().notNull(),
    completed_at: timestamp("completed_at"),
  },
  (table) => [
    index("jobs_poll_idx").on(table.status, table.deliver_at),
    index("jobs_org_id_idx").on(table.org_id),
    // Dedup only applies while a job is in flight — once a job completes or
    // dies, its deduplication_id becomes reusable so the same logical work
    // can legitimately be enqueued again later.
    uniqueIndex("jobs_dedup_idx")
      .on(table.deduplication_id)
      .where(
        sql`${table.deduplication_id} IS NOT NULL AND ${table.status} IN ('pending', 'processing')`
      ),
  ]
);

// ── Usage events (S10 — per-org cost/volume metering) ───────────────
//
// The cost-visibility ledger. Billing is deferred, but AI spend must be
// attributable per org before launch. Rows are written best-effort from the
// production insert paths (recordUsageEvent) — there is NO trigger, so S14 can
// seed realistic metered data through the same path.
//
// FK lifecycle (Resolved Decision C): org_id CASCADE — cost is incurred at the
// org level and dies with the org (and stays outside the POPIA candidate-purge
// path); brand/campaign/candidate are SET NULL so an S11 candidate purge nulls
// the reference without erasing the org's spend ledger. Token columns are
// nullable (ai_tokens-only; "unknown" ≠ "zero" — never coerce to 0).
export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    org_id: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Forward-looking name (S14 renames Clients→Brands); references clients.id.
    brand_id: uuid("brand_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(), // ai_tokens | campaign_created | candidate_created | chat_message | email_sent
    provider: text("provider"), // ai_tokens only (e.g. 'anthropic')
    model: text("model"), // ai_tokens only (modelId from the SDK result)
    input_tokens: integer("input_tokens"), // ai_tokens only; SDK usage.inputTokens (undefined→null)
    output_tokens: integer("output_tokens"), // ai_tokens only; SDK usage.outputTokens
    campaign_id: uuid("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    candidate_id: uuid("candidate_id").references(() => candidates.id, {
      onDelete: "set null",
    }),
    quantity: integer("quantity").notNull().default(1),
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_events_org_created_idx").on(table.org_id, table.created_at),
    index("usage_events_org_kind_idx").on(table.org_id, table.kind),
  ]
);

// ── Operator audit (S7) ─────────────────────────────────────────────
//
// The tenant-LESS audit trail for operator (act-as) actions. Deliberately has
// NO org_id: it is operator-keyed and read only behind requireOperator — never
// org-scoped or tenant-readable (a tenant-side audit_log is a separate, future
// org-scoped table; see S7 Resolved Decision 7). Both FKs are onDelete
// "set null" and metadata snapshots the org slug/name so the row outlives an
// S11 org purge / future operator removal (Resolved Decision 3). `action` is
// open free-text validated against an in-code allow-list, so S9 (provision_org)
// and S11 (suspend|restore|soft_delete|purge) extend it without a migration.

export const operatorAudit = pgTable(
  "operator_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operator_user_id: uuid("operator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }), // audit outlives the actor
    action: text("action").notNull(), // impersonate | impersonate_exit | set_tier | set_billing_email
    // (S9 adds provision_org; S11 adds suspend|restore|soft_delete|purge)
    target_org_id: uuid("target_org_id").references(() => organizations.id, {
      onDelete: "set null", // keep the audit row after an org is purged (S11)
    }),
    metadata: jsonb("metadata"), // {from,to} for tier/billing; org slug/name/status snapshot for durability
    ip: text("ip"),
    started_at: timestamp("started_at").defaultNow().notNull(),
    ended_at: timestamp("ended_at"), // set on impersonate exit; null for point-in-time actions
    created_at: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("operator_audit_operator_idx").on(table.operator_user_id),
    index("operator_audit_target_org_idx").on(table.target_org_id),
    index("operator_audit_action_idx").on(table.action),
  ]
);

export const operatorAuditRelations = relations(operatorAudit, ({ one }) => ({
  operator: one(users, {
    fields: [operatorAudit.operator_user_id],
    references: [users.id],
  }),
  targetOrg: one(organizations, {
    fields: [operatorAudit.target_org_id],
    references: [organizations.id],
  }),
}));
