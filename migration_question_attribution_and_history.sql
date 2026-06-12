-- Question attribution + change log
-- Run in Supabase SQL Editor

-- ── 1. Attribution columns on questions ─────────────────────────────
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Change log table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.question_change_log (
  id          BIGSERIAL PRIMARY KEY,
  question_id UUID        NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  changed_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action      TEXT        NOT NULL,  -- 'created' | 'updated' | 'moved' | 'deleted'
  changes     JSONB                  -- field-level diff: { field: { from, to } }
);

CREATE INDEX IF NOT EXISTS idx_qcl_question_id ON public.question_change_log(question_id);
CREATE INDEX IF NOT EXISTS idx_qcl_changed_at  ON public.question_change_log(changed_at DESC);

ALTER TABLE public.question_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dashboard users can read change log"
  ON public.question_change_log FOR SELECT TO authenticated USING (true);

-- ── 3. RPC: write a change log entry ────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_question_change(
  p_question_id UUID,
  p_action      TEXT,
  p_changes     JSONB DEFAULT NULL
)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO question_change_log(question_id, changed_by, changed_at, action, changes)
  VALUES (p_question_id, auth.uid(), now(), p_action, p_changes);
$$;

GRANT EXECUTE ON FUNCTION public.log_question_change(UUID, TEXT, JSONB) TO authenticated;

-- ── 4. RPC: read change log for a question ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_question_history(p_question_id UUID)
RETURNS TABLE (
  id          BIGINT,
  changed_by  UUID,
  changed_at  TIMESTAMPTZ,
  action      TEXT,
  changes     JSONB,
  user_name   TEXT,
  user_email  TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    cl.id, cl.changed_by, cl.changed_at, cl.action, cl.changes,
    ur.full_name AS user_name,
    ur.email     AS user_email
  FROM  question_change_log cl
  LEFT  JOIN user_roles ur ON ur.user_id = cl.changed_by
  WHERE cl.question_id = p_question_id
  ORDER BY cl.changed_at DESC
  LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.get_question_history(UUID) TO authenticated;

-- ── 5. Unified activity-feed RPC ────────────────────────────────────
-- Returns a merged, time-ordered stream of list edits, media uploads,
-- and question changes — with the question text resolved via JOIN.
-- SECURITY DEFINER so any dashboard role can read across all users.
CREATE OR REPLACE FUNCTION public.get_activity_feed(p_limit INT DEFAULT 200)
RETURNS TABLE (
  ts       TIMESTAMPTZ,
  user_id  UUID,
  action   TEXT,
  type     TEXT,
  target   TEXT,
  detail   JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM (
    SELECT created_at AS ts, created_by AS user_id, 'created'::TEXT AS action, 'list'::TEXT AS type, title AS target, NULL::JSONB AS detail
      FROM lists WHERE created_by IS NOT NULL
    UNION ALL
    SELECT updated_at, updated_by, 'updated', 'list'::TEXT, title, NULL::JSONB
      FROM lists WHERE updated_by IS NOT NULL AND updated_at IS DISTINCT FROM created_at
    UNION ALL
    SELECT created_at, uploaded_by, 'uploaded', 'media'::TEXT,
      coalesce(file_name, media_type || ' file'), NULL::JSONB
      FROM question_media WHERE uploaded_by IS NOT NULL
    UNION ALL
    SELECT cl.changed_at, cl.changed_by, cl.action, 'question'::TEXT,
      coalesce(nullif(trim(q.question), ''), 'Question #' || left(cl.question_id::TEXT, 8)),
      cl.changes
      FROM question_change_log cl
      LEFT JOIN questions q ON q.id = cl.question_id
  ) feed
  ORDER BY feed.ts DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_activity_feed(INT) TO authenticated;
