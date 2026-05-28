-- ============================================================
-- migration_question_plays.sql
-- Adds play-tracking for the "Most played categories" dashboard section.
-- Run this once in the Supabase SQL editor.
-- ============================================================

-- ── question_plays ──────────────────────────────────────────────────
-- Written by the game project every time a question is revealed/played.
-- Fields the game must supply:
--   question_id  — the GamesQuestion/game_questions.id that was played
--   category_id  — the category the question belongs to
--   list_id      — the question list being played
--   session_id   — unique game-session identifier (your choice of format)
--   correct      — true if the team answered correctly (nullable = unknown)
CREATE TABLE IF NOT EXISTS question_plays (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id  TEXT        NOT NULL,
  category_id  TEXT        NOT NULL,
  list_id      TEXT        NOT NULL,
  session_id   TEXT,
  correct      BOOLEAN,
  played_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qplays_category_id ON question_plays(category_id);
CREATE INDEX IF NOT EXISTS idx_qplays_list_id     ON question_plays(list_id);
CREATE INDEX IF NOT EXISTS idx_qplays_played_at   ON question_plays(played_at DESC);
CREATE INDEX IF NOT EXISTS idx_qplays_session_id  ON question_plays(session_id);

ALTER TABLE question_plays ENABLE ROW LEVEL SECURITY;

-- Allow the game (anon key) to INSERT plays and the dashboard to SELECT them
CREATE POLICY "allow_insert" ON question_plays FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "allow_select" ON question_plays FOR SELECT TO anon USING (true);

-- ── get_top_played_categories(p_limit) ──────────────────────────────
-- Returns the p_limit most-played category IDs with their play counts,
-- ordered by play count descending. Called by the dashboard via rpc().
CREATE OR REPLACE FUNCTION get_top_played_categories(p_limit int DEFAULT 6)
RETURNS TABLE (
  category_id TEXT,
  play_count  BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT   category_id,
           COUNT(*) AS play_count
  FROM     question_plays
  GROUP BY category_id
  ORDER BY play_count DESC
  LIMIT    p_limit;
$$;
