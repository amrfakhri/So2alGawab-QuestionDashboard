-- ============================================================
-- So2alGawab — Activity Attribution & Last-Seen Tracking
-- Run once in: Supabase Dashboard → SQL Editor → New query
--
-- Adds:
--   1. created_by / updated_by on lists, uploaded_by on question_media
--      → so the dashboard activity feed can show WHO did each action.
--   2. last_seen_at on user_roles + touch_last_seen() RPC
--      → so "Last Login" reflects the last time a user actually used
--        the dashboard (auth.users.last_sign_in_at only updates on a
--        fresh password sign-in, never on a persisted/refreshed session).
--   3. get_user_directory() RPC so any authenticated user can resolve
--      user_id → name/email for the activity feed (RLS otherwise hides
--      other users' rows from non-super-admins).
-- ============================================================

-- ── 1. Attribution columns ──────────────────────────────────
ALTER TABLE public.lists          ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lists          ADD COLUMN IF NOT EXISTS updated_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.question_media ADD COLUMN IF NOT EXISTS uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Last-seen tracking on user_roles ─────────────────────
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Stamp the calling user's last_seen_at. SECURITY DEFINER so a normal
-- (non-super-admin) user can update their own row without a broad
-- UPDATE policy on user_roles.
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.user_roles SET last_seen_at = now() WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

-- ── 3. User directory for activity-feed name resolution ─────
-- Returns minimal public profile info for every user. Readable by any
-- authenticated user (SECURITY DEFINER bypasses user_roles RLS) so the
-- overview activity feed can show names regardless of the viewer's role.
CREATE OR REPLACE FUNCTION public.get_user_directory()
RETURNS TABLE (user_id UUID, full_name TEXT, email TEXT, role TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, full_name, email, role, created_at FROM public.user_roles;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_directory() TO authenticated;

-- ============================================================
-- DONE. Existing rows keep NULL attribution (shown as "System");
-- new edits/uploads are attributed going forward.
-- ============================================================
