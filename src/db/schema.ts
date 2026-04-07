import { relations } from "drizzle-orm";
import {
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

// ── Clients ──────────────────────────────────────────────────────────

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    tier: text("tier").notNull().default("standard"),
    contact_name: text("contact_name"),
  contact_email: text("contact_email"),
  contact_phone: text("contact_phone"),
  billing_email: text("billing_email"),
  branding_logo_url: text("branding_logo_url"),
  brand_primary_color: text("brand_primary_color"),
  brand_secondary_color: text("brand_secondary_color"),
  brand_accent_color: text("brand_accent_color"),
  brand_text_color: text("brand_text_color").default("#11123c"),
  logo_background: text("logo_background").default("light"),
  logo_position: text("logo_position").default("top-left"),
  notes: text("notes"),
    is_active: boolean("is_active").default(true),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("clients_slug_idx").on(table.slug)]
);

// ── Campaigns ────────────────────────────────────────────────────────

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    client_id: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    slug: text("slug").notNull(),
    role_title: text("role_title").notNull(),
    role_description: text("role_description"),
    department: text("department"),
    location: text("location"),
    employment_type: text("employment_type"),
    status: text("status").notNull().default("draft"),
    html_template: text("html_template"),
    gating_config: jsonb("gating_config").notNull(),
    scoring_rubric: jsonb("scoring_rubric").notNull(),
    campaign_start: timestamp("campaign_start"),
    campaign_end: timestamp("campaign_end"),
    salary_range_min: integer("salary_range_min"),
    salary_range_max: integer("salary_range_max"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("campaigns_client_id_slug_unique").on(table.client_id, table.slug),
    index("campaigns_client_id_idx").on(table.client_id),
    index("campaigns_status_idx").on(table.status),
  ]
);

// ── Candidates ───────────────────────────────────────────────────────

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    whatsapp_opted_in: boolean("whatsapp_opted_in").default(false),
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
  ]
);

// ── Scoring Logs ─────────────────────────────────────────────────────

export const scoringLogs = pgTable(
  "scoring_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    model_version: text("model_version").notNull(),
    full_prompt: text("full_prompt").notNull(),
    full_response: text("full_response").notNull(),
    score: real("score"),
    processing_time_ms: integer("processing_time_ms"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("scoring_logs_candidate_id_idx").on(table.candidate_id),
  ]
);

// ── Users ────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    client_id: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    first_name: text("first_name").notNull(),
    last_name: text("last_name").notNull(),
    email: text("email").notNull(),
    password_hash: text("password_hash").notNull(),
    security_group: text("security_group").notNull(),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_client_id_idx").on(table.client_id),
  ]
);

// ── Password reset tokens ────────────────────────────────────────────

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
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

// ── Messages ─────────────────────────────────────────────────────────

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidate_id: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id),
    channel: text("channel").notNull(),
    direction: text("direction").notNull(),
    content: text("content").notNull(),
    template_id: text("template_id"),
    status: text("status"),
    external_id: text("external_id"),
    created_at: timestamp("created_at").defaultNow().notNull(),
    updated_at: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("messages_candidate_id_idx").on(table.candidate_id)]
);

// ── Events (visitor tracking) ───────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaign_id: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id),
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
  ]
);

// ── Relations ────────────────────────────────────────────────────────

export const clientsRelations = relations(clients, ({ many }) => ({
  campaigns: many(campaigns),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  client: one(clients, {
    fields: [users.client_id],
    references: [clients.id],
  }),
  passwordResetTokens: many(passwordResetTokens),
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
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [candidates.campaign_id],
    references: [campaigns.id],
  }),
  scoringLogs: many(scoringLogs),
  messages: many(messages),
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
    created_at: timestamp("created_at").defaultNow().notNull(),
    completed_at: timestamp("completed_at"),
  },
  (table) => [
    index("jobs_poll_idx").on(table.status, table.deliver_at),
    uniqueIndex("jobs_dedup_idx").on(table.deduplication_id),
  ]
);
