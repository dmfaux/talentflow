-- ─────────────────────────────────────────────────────────────────────
-- S13 schema cleanup. The S1/0026 transitional BEFORE INSERT triggers are now
-- pure no-ops (every writer stamps org_id explicitly — S5/S10), so drop them
-- and their functions. Order matters: triggers reference the functions, so drop
-- triggers first, then functions, then the legacy users columns. drizzle-kit
-- doesn't track triggers/functions — this block is hand-added, mirroring the
-- hand-augmented 0026 (the rest of the file is drizzle-generated).
-- ─────────────────────────────────────────────────────────────────────
-- (1) Drop the 10 transitional BEFORE INSERT triggers (S1).
DROP TRIGGER IF EXISTS trg_campaigns_org_id ON campaigns;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_candidates_org_id ON candidates;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_events_org_id ON events;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_scoring_logs_org_id ON scoring_logs;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_messages_org_id ON messages;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_conversations_org_id ON conversations;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chat_tokens_org_id ON chat_tokens;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_chat_messages_org_id ON chat_messages;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_clients_org_id ON clients;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_users_org_id ON users;--> statement-breakpoint
-- (2) Drop the 6 trigger functions (now unreferenced).
DROP FUNCTION IF EXISTS set_org_id_from_client();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_campaign();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_candidate();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_conversation();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_default_org();--> statement-breakpoint
DROP FUNCTION IF EXISTS set_org_id_from_client_user();--> statement-breakpoint
-- (3) Drop the legacy users columns + index + FK (drizzle-kit generated these).
ALTER TABLE "users" DROP CONSTRAINT "users_client_id_clients_id_fk";--> statement-breakpoint
DROP INDEX "users_client_id_idx";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "client_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "security_group";
