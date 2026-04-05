-- Backfill a log entry for every template that has no log yet, so
-- the history view isn't empty on existing templates. Uses the
-- template's own published_at (or created_at fallback) as the
-- changed_at, and a NULL changed_by (we don't know who).
INSERT INTO "template_status_log" (template_id, from_status, to_status, changed_by, changed_at)
SELECT
  t.id,
  NULL,
  t.status,
  NULL,
  COALESCE(t.published_at, t.created_at)
FROM "templates" t
WHERE NOT EXISTS (
  SELECT 1 FROM "template_status_log" l WHERE l.template_id = t.id
);
