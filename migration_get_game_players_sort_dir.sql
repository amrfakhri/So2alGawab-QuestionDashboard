-- Add ascending/descending support to get_game_players
-- Run in Supabase SQL editor

DROP FUNCTION IF EXISTS public.get_game_players(text, text, int, int, text);

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

  -- normalise direction
  p_sort_dir := lower(coalesce(p_sort_dir, 'desc'));
  IF p_sort_dir NOT IN ('asc','desc') THEN p_sort_dir := 'desc'; END IF;

  WITH registered AS (
    SELECT 'registered'::text AS type, p.id, p.username, u.email, p.avatar_index,
           p.level, p.xp,
           coalesce(s.games_played,0) AS games_played,
           coalesce(s.total_points,0) AS total_points,
           coalesce(s.wins,0)         AS wins,
           coalesce(h.play_seconds,0) AS play_seconds,
           h.last_played, p.created_at AS joined_at,
           coalesce(h.top_categories,'[]'::json) AS top_categories
    FROM profiles p
    LEFT JOIN user_roles r ON r.user_id = p.id
    LEFT JOIN user_stats s ON s.user_id = p.id
    LEFT JOIN auth.users u ON u.id = p.id
    LEFT JOIN LATERAL (
      SELECT sum(gh.duration_seconds) play_seconds, max(gh.played_at) last_played,
             (SELECT json_agg(t) FROM (
                SELECT cat category, count(*) count
                FROM game_history g2, lateral jsonb_array_elements_text(g2.categories) cat
                WHERE g2.user_id = p.id GROUP BY cat ORDER BY count(*) DESC LIMIT 3) t) top_categories
      FROM game_history gh WHERE gh.user_id = p.id
    ) h ON true
    WHERE r.user_id IS NULL
  ),
  guests AS (
    SELECT 'guest'::text AS type, g.id, NULL::text username, NULL::text email,
           NULL::int avatar_index, NULL::int level, NULL::int xp,
           0 games_played, 0 total_points, 0 wins, 0 play_seconds,
           NULL::timestamptz last_played, g.first_seen_at AS joined_at, '[]'::json top_categories
    FROM guest_devices g
  ),
  unioned AS (SELECT * FROM registered UNION ALL SELECT * FROM guests)
  SELECT json_build_object(
    'total',   (SELECT count(*) FROM unioned
                WHERE (p_type='all' OR type=p_type)
                  AND (p_search IS NULL OR username ILIKE '%'||p_search||'%' OR email ILIKE '%'||p_search||'%')),
    'players', (SELECT coalesce(json_agg(row),'[]'::json) FROM (
                 SELECT * FROM unioned
                 WHERE (p_type='all' OR type=p_type)
                   AND (p_search IS NULL OR username ILIKE '%'||p_search||'%' OR email ILIKE '%'||p_search||'%')
                 ORDER BY
                   CASE WHEN p_sort='games'       AND p_sort_dir='asc'  THEN games_played END ASC  NULLS LAST,
                   CASE WHEN p_sort='games'       AND p_sort_dir='desc' THEN games_played END DESC NULLS LAST,
                   CASE WHEN p_sort='time'        AND p_sort_dir='asc'  THEN play_seconds END ASC  NULLS LAST,
                   CASE WHEN p_sort='time'        AND p_sort_dir='desc' THEN play_seconds END DESC NULLS LAST,
                   CASE WHEN p_sort='points'      AND p_sort_dir='asc'  THEN total_points END ASC  NULLS LAST,
                   CASE WHEN p_sort='points'      AND p_sort_dir='desc' THEN total_points END DESC NULLS LAST,
                   CASE WHEN p_sort='joined'      AND p_sort_dir='asc'  THEN joined_at   END ASC  NULLS LAST,
                   CASE WHEN p_sort='joined'      AND p_sort_dir='desc' THEN joined_at   END DESC NULLS LAST,
                   CASE WHEN p_sort='type'        AND p_sort_dir='asc'  THEN type        END ASC  NULLS LAST,
                   CASE WHEN p_sort='type'        AND p_sort_dir='desc' THEN type        END DESC NULLS LAST,
                   CASE WHEN p_sort='last_active' AND p_sort_dir='asc'  THEN last_played END ASC  NULLS LAST,
                   CASE WHEN p_sort='last_active' AND p_sort_dir='desc' THEN last_played END DESC NULLS LAST,
                   last_played DESC NULLS LAST,
                   joined_at   DESC NULLS LAST
                 LIMIT greatest(p_limit,1) OFFSET greatest(p_offset,0)) row)
  ) INTO v_result;
  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.get_game_players(text,text,int,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_players(text,text,int,int,text,text) TO authenticated, service_role;
