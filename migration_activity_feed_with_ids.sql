-- Activity feed v2: adds item_id + list_id so the UI can build deep-links
-- Run in Supabase SQL Editor

-- Drop old signature first (return type changed, so CREATE OR REPLACE won't work)
DROP FUNCTION IF EXISTS public.get_activity_feed(INT);

CREATE OR REPLACE FUNCTION public.get_activity_feed(p_limit INT DEFAULT 200)
RETURNS TABLE (
  ts       TIMESTAMPTZ,
  user_id  UUID,
  action   TEXT,
  type     TEXT,
  target   TEXT,
  detail   JSONB,
  item_id  TEXT,   -- navigable ID: list UUID, question UUID, or media row id
  list_id  UUID    -- parent list UUID (for question events; NULL for lists/media)
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT
      created_at AS ts, created_by AS user_id,
      'created'::TEXT AS action, 'list'::TEXT AS type,
      title AS target, NULL::JSONB AS detail,
      id::TEXT AS item_id, NULL::UUID AS list_id
    FROM lists WHERE created_by IS NOT NULL

    UNION ALL

    SELECT
      updated_at, updated_by,
      'updated', 'list'::TEXT,
      title, NULL::JSONB,
      id::TEXT, NULL::UUID
    FROM lists WHERE updated_by IS NOT NULL AND updated_at IS DISTINCT FROM created_at

    UNION ALL

    SELECT
      created_at, uploaded_by,
      'uploaded', 'media'::TEXT,
      coalesce(file_name, media_type || ' file'), NULL::JSONB,
      id::TEXT, NULL::UUID
    FROM question_media WHERE uploaded_by IS NOT NULL

    UNION ALL

    SELECT
      cl.changed_at, cl.changed_by,
      cl.action, 'question'::TEXT,
      coalesce(nullif(trim(q.question), ''), 'Question #' || left(cl.question_id::TEXT, 8)),
      cl.changes,
      cl.question_id::TEXT, q.list_id
    FROM question_change_log cl
    LEFT JOIN questions q ON q.id = cl.question_id
  ) feed
  ORDER BY feed.ts DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_activity_feed(INT) TO authenticated;
