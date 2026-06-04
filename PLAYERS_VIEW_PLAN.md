# Game Players View — Plan

A new dashboard view listing **game players** (registered users **and guests**) with
per-player stats: username, email, avatar, games played, time spent, most-played
categories, and more.

> **Exclude admins only.** The list must EXCLUDE dashboard team members (rows in
> `public.user_roles`). It **includes both** registered game accounts (`public.profiles`)
> **and guests** (`public.guest_devices`).

Plan only — no implementation yet.

---

## 1. Goal & scope
- A `players.html` page (new sidebar entry) showing one card/row per player.
- Two player types in one list, distinguished by a `type` field: **registered** + **guest**.
- Per-player fields (request + sensible extras):
  - **username** (`profiles.username`; guests have none → shown as "Guest")
  - **email** (`auth.users.email`; guests have none)
  - **selected avatar** (`profiles.avatar_index`; guests have none → placeholder)
  - **games played**, **time spent** (`Xh Ym`), **most selected categories**
  - **extras:** total points, wins + win rate, level/XP, online vs local split,
    joined date, last active.
- Search (username/email), sort, pagination, and a type filter (all / registered / guests).

---

## 2. Who counts (exclude admins only)

**Registered players** — real game accounts, minus the dashboard team:
```
profiles p LEFT JOIN user_roles r ON r.user_id = p.id
WHERE r.user_id IS NULL          -- exclude dashboard users/admins only
```
(Note: guests are NOT in `profiles`, so they're not double-counted here.)

**Guests** — anonymous devices that entered guest mode:
```
SELECT id, first_seen_at FROM guest_devices
```

> ⚠️ Side note (separate from this view): the game and dashboard both define a
> `public.handle_new_user()` trigger on `auth.users` with the **same name** in the shared
> DB, so the last-applied one wins. The admin exclusion above keeps this view correct
> regardless, but the trigger collision should be reconciled so game signups reliably get
> a `profiles` row and dashboard signups a `user_roles` row.

---

## 3. Data sources (grounded in the current schema)

### 3.1 Registered players
| Field | Source |
|------|--------|
| username, avatar_index, level, xp, created_at, last_login_at | `public.profiles` |
| email | `auth.users.email` (service-role / definer only — RLS hides it) |
| games_played, total_points, wins | `public.user_stats` |
| time spent | `sum(public.game_history.duration_seconds)` per `user_id` |
| most-played categories | `public.game_history.categories` (jsonb array of names) |
| last active | `max(public.game_history.played_at)` + `profiles.last_login_at` |
| online/local split | `public.game_history.game_mode` |

Most-played categories per registered player:
```sql
SELECT cat, count(*) n
FROM public.game_history gh, LATERAL jsonb_array_elements_text(gh.categories) cat
WHERE gh.user_id = p.id GROUP BY cat ORDER BY n DESC LIMIT 3
```

### 3.2 Guests — what exists today vs what's needed
**Today the only persistent guest record is `public.guest_devices`** (`id` = anonymous
device id, `first_seen_at`). Guests have **no** username, email, avatar, or gameplay
history — guests don't write `game_history` (its `user_id` references `auth.users`).
Live guest play is only visible transiently in `game_active_players.is_guest`.

So, with no schema change, guest rows can show **only**: a short guest id, **joined**
(`first_seen_at`), and `type = guest` — everything else is "—".

**To give guests real stats (games / time / categories), we must start recording guest
game finishes keyed by the guest device id.** The app already keeps a stable
`guest_device_id` in AsyncStorage (from `guestService`). Proposed (game/backend repo):
- Add nullable `guest_device_id uuid` to `public.game_history` and make `user_id`
  nullable (or add a parallel `guest_game_history` table).
- When a **guest** finishes a local game, save a history row with `guest_device_id`
  (no `user_id`). The client's local-game save currently skips guests — extend it.
- Then aggregate guest stats by `guest_device_id` exactly like registered users by
  `user_id`.
This is a **phase-2** add; the list ships first with minimal guest rows, then guest
stats fill in once recording is live (going forward — historical guest games can't be
recovered).

---

## 4. Backend exposure (shared Supabase)

Browser + anon key + admin JWT, so RLS hides other users' data and all of `auth.users`.
Use a privileged, admin-gated aggregate that returns **registered + guests unioned**.

### A. SECURITY DEFINER RPC (recommended)
Aggregates in Postgres, reads `auth.users` for email, gated to admins (same pattern as
`get_dashboard_overview()`).

```sql
-- supabase/migrations/<date>_game_players.sql  (shared backend repo)
CREATE OR REPLACE FUNCTION public.get_game_players(
  p_search text DEFAULT NULL,
  p_type   text DEFAULT 'all',          -- all | registered | guest
  p_limit  int  DEFAULT 50,
  p_offset int  DEFAULT 0,
  p_sort   text DEFAULT 'last_active'
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $$
DECLARE v_role text; v_result json;
BEGIN
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('super_admin','admin','editor','viewer') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

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
    -- (phase 2: LEFT JOIN guest game_history on guest_device_id for real stats)
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
                   CASE WHEN p_sort='games'  THEN games_played END DESC NULLS LAST,
                   CASE WHEN p_sort='time'   THEN play_seconds END DESC NULLS LAST,
                   CASE WHEN p_sort='points' THEN total_points END DESC NULLS LAST,
                   CASE WHEN p_sort='joined' THEN joined_at END DESC NULLS LAST,
                   last_played DESC NULLS LAST, joined_at DESC NULLS LAST
                 LIMIT greatest(p_limit,1) OFFSET greatest(p_offset,0)) row)
  ) INTO v_result;
  RETURN v_result;
END; $$;

REVOKE ALL ON FUNCTION public.get_game_players(text,text,int,int,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_players(text,text,int,int,int) TO authenticated, service_role;
```
- Returns `{ total, players: [...] }` with a `type` field per row.
- Indexes: `game_history(user_id, played_at)` (exists), plus `user_roles(user_id)`,
  `user_stats(user_id)`. `guest_devices` is small.

### B. Edge function (alternative)
Mirror `admin-users` (verify JWT → check `user_roles` → service role) and aggregate in
Deno. Prefer the RPC so Postgres does the aggregation.

### Performance / scale
Fine for thousands of rows. If `game_history` grows large, move the per-player
aggregation into a **materialized view** (scheduled refresh) and have the RPC read it.
Always paginate.

---

## 5. Dashboard UI (`players.html`)
- **Sidebar:** add `{ id:'players', label:'Game Players', icon:'gamepad-2', href:'./players.html' }`
  to `services/sidebar.js` `_NAV` (role-gated like the rest).
- Reuse `users.html` table/card chrome. Per row: avatar (or guest placeholder) +
  **username/"Guest"** + **email** + a **type badge (Registered / Guest)** +
  games · time (`Xh Ym`) · points/level · win rate + **category chips** + last active / joined.
- Controls: search (username/email), sort dropdown, **type filter** (all / registered / guests),
  pagination.
- States: loading skeletons, empty, error+retry. Data via `window._sb.rpc('get_game_players', {...})`.
- Guest rows render with "—" where data is absent until phase-2 guest recording lands.

---

## 6. Open decisions
1. **Guest gameplay recording (phase 2)** — implement the `guest_device_id` history so
   guests get real games/time/categories? Or ship guests as minimal (id + joined) for now?
2. **Avatar images in the dashboard** — copy the game's avatar set into the dashboard
   `assets/` (parity) or use an indexed placeholder. Guests always use a generic placeholder.
3. **Email privacy** — show emails to all dashboard roles, or only `super_admin`/`admin`?
4. **"Games played" source** for registered — `user_stats.games_played` (recommended) vs
   `count(game_history)` (note local writes 1 row for host; online 1 row per player).

---

## 7. Rollout
1. **Backend (shared `So2alGawab` repo):** `supabase/migrations/<date>_game_players.sql`
   (RPC + indexes + grants); run on Frankfurt.
2. **(Phase 2, optional)** add `guest_device_id` to `game_history` + the app's guest
   local-game save, then extend the RPC's `guests` CTE to aggregate real guest stats.
3. **Dashboard:** `players.html` + sidebar entry + `getGamePlayers()` call + UI
   (search/sort/type-filter/pagination/states); copy avatar assets if chosen.
4. **QA:** verify the list **includes guests** and **excludes `user_roles`** members;
   cross-check a known player's games/time/categories vs raw SQL; verify type filter,
   search, sort, pagination, email gating, and loading/empty/error + RTL/responsive.

## 8. Verification queries
```sql
SELECT public.get_game_players(NULL, 'all', 20, 0, 'last_active');

-- registered (admins excluded)
SELECT count(*) FROM profiles p LEFT JOIN user_roles r ON r.user_id=p.id WHERE r.user_id IS NULL;
-- guests
SELECT count(*) FROM guest_devices;
```

### Files this plan implies
- **Shared backend (`So2alGawab` repo):** `supabase/migrations/<date>_game_players.sql`
  (RPC + indexes + grants); phase-2 `guest_device_id` on `game_history` + app save.
- **Dashboard repo:** `players.html`, a nav entry in `services/sidebar.js`, a
  `getGamePlayers()` data call, optional avatar assets.
