-- ============================================================
-- migration_active_players.sql
-- Adds live player-presence tracking for the dashboard.
-- Run once in the Supabase SQL editor.
-- ============================================================

-- ── game_active_players ─────────────────────────────────────────────
-- The game project writes one row per connected player/device.
-- It must refresh heartbeat_at every 30–60 s to stay "live".
-- The dashboard treats rows with heartbeat_at > NOW() - 2 min as active.
CREATE TABLE IF NOT EXISTS game_active_players (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Session grouping
  session_id   TEXT        NOT NULL,

  -- What game is being played (game fills this on join)
  list_id      TEXT,
  list_title   TEXT,

  -- Player identity
  player_name  TEXT        NOT NULL DEFAULT 'Player',
  team_name    TEXT,
  team_index   INTEGER,                          -- 0 = gold, 1 = blue, …
  avatar_url   TEXT,

  -- In-game state
  score        INTEGER     NOT NULL DEFAULT 0,
  role         TEXT        NOT NULL DEFAULT 'player'  -- 'host' | 'player'
    CHECK (role IN ('host', 'player')),

  -- Liveness: game must UPDATE this every ~30 s
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gap_session_id   ON game_active_players(session_id);
CREATE INDEX IF NOT EXISTS idx_gap_heartbeat    ON game_active_players(heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS idx_gap_list_id      ON game_active_players(list_id);

ALTER TABLE game_active_players ENABLE ROW LEVEL SECURITY;

-- Anon key (game client): full access so it can INSERT, UPDATE, DELETE its own rows
CREATE POLICY "allow_all" ON game_active_players FOR ALL TO anon USING (true) WITH CHECK (true);

-- ── get_active_players() ────────────────────────────────────────────
-- Returns all players whose heartbeat is within the last 2 minutes,
-- plus the session duration in minutes derived from the earliest join.
-- Called by the dashboard via rpc('get_active_players').
CREATE OR REPLACE FUNCTION get_active_players()
RETURNS TABLE (
  id           UUID,
  session_id   TEXT,
  list_id      TEXT,
  list_title   TEXT,
  player_name  TEXT,
  team_name    TEXT,
  team_index   INTEGER,
  avatar_url   TEXT,
  score        INTEGER,
  role         TEXT,
  heartbeat_at TIMESTAMPTZ,
  joined_at    TIMESTAMPTZ,
  session_started_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id,
    p.session_id,
    p.list_id,
    p.list_title,
    p.player_name,
    p.team_name,
    p.team_index,
    p.avatar_url,
    p.score,
    p.role,
    p.heartbeat_at,
    p.joined_at,
    MIN(p2.joined_at) OVER (PARTITION BY p.session_id) AS session_started_at
  FROM game_active_players p
  JOIN game_active_players p2 ON p2.session_id = p.session_id
  WHERE p.heartbeat_at > NOW() - INTERVAL '2 minutes'
  ORDER BY p.session_id, p.role DESC, p.score DESC;
$$;

-- ── cleanup_stale_players() ─────────────────────────────────────────
-- Removes rows older than 10 minutes (safety net for disconnected clients).
-- Optional: schedule this via pg_cron or call it from a Supabase Edge Function.
CREATE OR REPLACE FUNCTION cleanup_stale_players()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM game_active_players
  WHERE heartbeat_at < NOW() - INTERVAL '10 minutes';
$$;
