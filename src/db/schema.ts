import { relations, sql } from "drizzle-orm";
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
    // DB-level NOT NULL is enforced by migration 0026 (+ sole-org trigger).
    // S5 flips the model to .notNull() now that every brand writer stamps it;
    // the trigger remains the runtime backstop until S13.
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
  (table) => [
    uniqueIndex("clients_slug_idx").on(table.slug),
    index("clients_org_id_idx").on(table.org_id),
  ]
);

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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
    slug: text("slug").notNull(),
    role_title: text("role_title").notNull(),
    role_description: text("role_description"),
    department: text("department"),
    location: text("location"),
    employment_type: text("employment_type"),
    status: text("status").notNull().default("draft"),
    html_template: text("html_template"),
    design_brief: text("design_brief"),
    gating_config: jsonb("gating_config").notNull(),
    scoring_rubric: jsonb("scoring_rubric").notNull(),
    campaign_start: timestamp("campaign_start"),
    campaign_end: timestamp("campaign_end"),
    salary_range_min: integer("salary_range_min"),
    salary_range_max: integer("salary_range_max"),
    chat_lifecycle: text("chat_lifecycle").notNull().default("dormant"),
    ghost_ttl_days: integer("ghost_ttl_days").notNull().default(10),
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
    // NULLABLE (S8): an org-level invitee (Owner/Org-Admin spanning all brands)
    // is created with no brand to point at — the S9 empty-org bootstrap. This is
    // a scoped pull-forward of S13's full DROP COLUMN; the sole-org trigger
    // (set_org_id_from_client_user) never dereferences client_id on the accept
    // path because org_id is always set explicitly. operators also carry it null.
    client_id: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    org_id: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }), // NULLABLE: operators have no org (DB + model nullable)
    org_role: text("org_role"), // owner | org_admin | null
    is_operator: boolean("is_operator").notNull().default(false),
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
    // Global email unique (users_email_idx) is dropped in 0026. Email is now
    // unique per-org for tenant users via (org_id, email); NULLs are distinct
    // in a multi-column unique, so that does NOT constrain operators (org_id
    // NULL) — the partial unique on email WHERE is_operator does.
    uniqueIndex("users_org_email_idx").on(table.org_id, table.email),
    uniqueIndex("users_operator_email_idx")
      .on(table.email)
      .where(sql`${table.is_operator}`),
    index("users_client_id_idx").on(table.client_id),
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
      }), // DB + model NOT NULL (S5 flip); trigger backstop stays until S13
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
  users: many(users),
  memberships: many(memberships),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [users.org_id],
    references: [organizations.id],
  }),
  client: one(clients, {
    fields: [users.client_id],
    references: [clients.id],
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
