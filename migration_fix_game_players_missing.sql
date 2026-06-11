-- Fix: registered CTE now starts from auth.users so players without a profiles
-- row (OAuth sign-ups whose trigger misfired, pre-trigger registrations, etc.)
-- are no longer silently excluded.  Also surfaces last_active_at from profiles
-- for a more accurate "last active" timestamp.

DROP FUNCTION IF EXISTS public.get_game_players(text, text, int, int, text, text);

CREATE OR REPLACE FUNCTION public.get_game_players(
  p_search   text DEFAULT NULL,
  p_type     text DEFAULT 'all',
  p_limit    int  DEFAULT 50,
  p_offset   int  DEFAULT 0,
  p_sort     text DEFAULT 'last_active',
  p_sort_dir text DEFAULT 'desc'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v_role text; v_result json;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('super_admin','admin','editor','viewer') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  p_sort_dir := lower(coalesce(p_sort_dir, 'desc'));
  IF p_sort_dir NOT IN ('asc','desc') THEN p_sort_dir := 'desc'; END IF;

  WITH registered AS (
    -- Base on auth.users so every registered account is visible, even those
    -- whose profiles row was never created (OAuth trigger failures, legacy accounts).
    SELECT
      'registered'::text            AS type,
      u.id,
      p.username,
      u.email,
      p.avatar_index,
      p.level,
      p.xp,
      coalesce(s.games_played,  0)  AS games_played,
      coalesce(s.total_points,  0)  AS total_points,
      coalesce(s.wins,          0)  AS wins,
      coalesce(h.play_seconds,  0)  AS play_seconds,
      -- last_active: prefer the app-open stamp; fall back to last game played
      coalesce(p.last_active_at, h.last_played) AS last_active,
      h.last_played,
      coalesce(p.created_at, u.created_at)      AS joined_at,
      coalesce(h.top_categories, '[]'::json)    AS top_categories
    FROM auth.users u
    LEFT JOIN profiles       p ON p.id        = u.id
    LEFT JOIN user_roles     r ON r.user_id   = u.id
    LEFT JOIN user_stats     s ON s.user_id   = u.id
    LEFT JOIN LATERAL (
      SELECT
        sum(gh.duration_seconds) AS play_seconds,
        max(gh.played_at)        AS last_played,
        (SELECT json_agg(t)
         FROM (
           SELECT cat AS category, count(*) AS count
           FROM   game_history g2,
                  lateral jsonb_array_elements_text(g2.categories) cat
           WHERE  g2.user_id = u.id
           GROUP  BY cat
           ORDER  BY count(*) DESC
           LIMIT  3
         ) t
        ) AS top_categories
      FROM game_history gh
      WHERE gh.user_id = u.id
    ) h ON true
    -- Exclude dashboard admins/editors; exclude anonymous Supabase accounts (no email)
    WHERE r.user_id  IS NULL
      AND u.email    IS NOT NULL
  ),
  guests AS (
    SELECT
      'guest'::text             AS type,
      g.id,
      NULL::text                AS username,
      NULL::text                AS email,
      NULL::int                 AS avatar_index,
      NULL::int                 AS level,
      NULL::int                 AS xp,
      0                         AS games_played,
      0                         AS total_points,
      0                         AS wins,
      0                         AS play_seconds,
      NULL::timestamptz         AS last_active,
      NULL::timestamptz         AS last_played,
      g.first_seen_at           AS joined_at,
      '[]'::json                AS top_categories
    FROM guest_devices g
  ),
  unioned AS (SELECT * FROM registered UNION ALL SELECT * FROM guests)
  SELECT json_build_object(
    'total', (
      SELECT count(*)
      FROM   unioned
      WHERE  (p_type = 'all' OR type = p_type)
        AND  (p_search IS NULL
              OR username ILIKE '%' || p_search || '%'
              OR email    ILIKE '%' || p_search || '%')
    ),
    'players', (
      SELECT coalesce(json_agg(row), '[]'::json)
      FROM (
        SELECT *
        FROM   unioned
        WHERE  (p_type = 'all' OR type = p_type)
          AND  (p_search IS NULL
                OR username ILIKE '%' || p_search || '%'
                OR email    ILIKE '%' || p_search || '%')
        ORDER BY
          CASE WHEN p_sort = 'games'       AND p_sort_dir = 'asc'  THEN games_played END ASC  NULLS LAST,
          CASE WHEN p_sort = 'games'       AND p_sort_dir = 'desc' THEN games_played END DESC NULLS LAST,
          CASE WHEN p_sort = 'time'        AND p_sort_dir = 'asc'  THEN play_seconds END ASC  NULLS LAST,
          CASE WHEN p_sort = 'time'        AND p_sort_dir = 'desc' THEN play_seconds END DESC NULLS LAST,
          CASE WHEN p_sort = 'points'      AND p_sort_dir = 'asc'  THEN total_points END ASC  NULLS LAST,
          CASE WHEN p_sort = 'points'      AND p_sort_dir = 'desc' THEN total_points END DESC NULLS LAST,
          CASE WHEN p_sort = 'joined'      AND p_sort_dir = 'asc'  THEN joined_at   END ASC  NULLS LAST,
          CASE WHEN p_sort = 'joined'      AND p_sort_dir = 'desc' THEN joined_at   END DESC NULLS LAST,
          CASE WHEN p_sort = 'type'        AND p_sort_dir = 'asc'  THEN type        END ASC  NULLS LAST,
          CASE WHEN p_sort = 'type'        AND p_sort_dir = 'desc' THEN type        END DESC NULLS LAST,
          CASE WHEN p_sort = 'last_active' AND p_sort_dir = 'asc'  THEN last_active END ASC  NULLS LAST,
          CASE WHEN p_sort = 'last_active' AND p_sort_dir = 'desc' THEN last_active END DESC NULLS LAST,
          last_active DESC NULLS LAST,
          joined_at   DESC NULLS LAST
        LIMIT  greatest(p_limit,  1)
        OFFSET greatest(p_offset, 0)
      ) row
    )
  ) INTO v_result;
  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.get_game_players(text, text, int, int, text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_game_players(text, text, int, int, text, text)
  TO authenticated, service_role;
