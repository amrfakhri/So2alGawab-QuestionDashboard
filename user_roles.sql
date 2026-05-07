-- ============================================================
-- So2alGawab — Auth & RBAC Migration
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ============================================================
-- 1. USER ROLES TABLE
--    Includes email so the admin panel can show names without
--    needing access to the private auth.users table.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'pending'
               CHECK (role IN ('super_admin', 'admin', 'editor', 'viewer', 'pending')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add email column if table already existed without it
ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS email TEXT;

-- Widen role constraint to include 'pending' if it already existed
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('super_admin', 'admin', 'editor', 'viewer', 'pending'));

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Each user can read their own role (non-recursive)
DROP POLICY IF EXISTS "read_own_role" ON public.user_roles;
CREATE POLICY "read_own_role" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 2. SECURITY DEFINER HELPER — avoids recursive RLS checks
--    Returns the calling user's role from user_roles table.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- 3. AUTO-ASSIGN ROLE ON NEW USER SIGNUP
--    First user ever → super_admin.  All others → pending.
--    super_admin approves users from the database panel.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count INT;
BEGIN
  SELECT COUNT(*) INTO existing_count FROM public.user_roles;
  INSERT INTO public.user_roles (user_id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN existing_count = 0 THEN 'super_admin' ELSE 'pending' END
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 4. SUPER ADMIN POLICIES ON user_roles
--    super_admin can read and update all user roles.
-- ============================================================
DROP POLICY IF EXISTS "super_admin_read_all_roles" ON public.user_roles;
CREATE POLICY "super_admin_read_all_roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'super_admin');

DROP POLICY IF EXISTS "super_admin_update_roles" ON public.user_roles;
CREATE POLICY "super_admin_update_roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

-- ============================================================
-- 5. UPDATE RLS ON DATA TABLES
--    Drop old anon write policies → require authentication.
-- ============================================================

-- ---- lists ----
DROP POLICY IF EXISTS "anon_insert_lists"  ON public.lists;
DROP POLICY IF EXISTS "anon_update_lists"  ON public.lists;
DROP POLICY IF EXISTS "anon_delete_lists"  ON public.lists;
DROP POLICY IF EXISTS "allow_all"          ON public.lists;

DROP POLICY IF EXISTS "auth_read_lists"     ON public.lists;
DROP POLICY IF EXISTS "editor_insert_lists" ON public.lists;
DROP POLICY IF EXISTS "editor_update_lists" ON public.lists;
DROP POLICY IF EXISTS "editor_delete_lists" ON public.lists;

CREATE POLICY "auth_read_lists" ON public.lists
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "editor_insert_lists" ON public.lists
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_update_lists" ON public.lists
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_delete_lists" ON public.lists
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

-- ---- categories ----
DROP POLICY IF EXISTS "anon_insert_categories"  ON public.categories;
DROP POLICY IF EXISTS "anon_update_categories"  ON public.categories;
DROP POLICY IF EXISTS "anon_delete_categories"  ON public.categories;
DROP POLICY IF EXISTS "allow_all"               ON public.categories;

DROP POLICY IF EXISTS "auth_read_categories"     ON public.categories;
DROP POLICY IF EXISTS "editor_insert_categories" ON public.categories;
DROP POLICY IF EXISTS "editor_update_categories" ON public.categories;
DROP POLICY IF EXISTS "editor_delete_categories" ON public.categories;

CREATE POLICY "auth_read_categories" ON public.categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "editor_insert_categories" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_update_categories" ON public.categories
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_delete_categories" ON public.categories
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

-- ---- questions ----
DROP POLICY IF EXISTS "anon_insert_questions"  ON public.questions;
DROP POLICY IF EXISTS "anon_update_questions"  ON public.questions;
DROP POLICY IF EXISTS "anon_delete_questions"  ON public.questions;
DROP POLICY IF EXISTS "allow_all"              ON public.questions;

DROP POLICY IF EXISTS "auth_read_questions"     ON public.questions;
DROP POLICY IF EXISTS "editor_insert_questions" ON public.questions;
DROP POLICY IF EXISTS "editor_update_questions" ON public.questions;
DROP POLICY IF EXISTS "editor_delete_questions" ON public.questions;

CREATE POLICY "auth_read_questions" ON public.questions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "editor_insert_questions" ON public.questions
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_update_questions" ON public.questions
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_delete_questions" ON public.questions
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

-- ---- game_settings ----
DROP POLICY IF EXISTS "anon_insert_game_settings"  ON public.game_settings;
DROP POLICY IF EXISTS "anon_update_game_settings"  ON public.game_settings;
DROP POLICY IF EXISTS "anon_delete_game_settings"  ON public.game_settings;
DROP POLICY IF EXISTS "allow_all"                  ON public.game_settings;

DROP POLICY IF EXISTS "auth_read_game_settings"     ON public.game_settings;
DROP POLICY IF EXISTS "editor_insert_game_settings" ON public.game_settings;
DROP POLICY IF EXISTS "editor_update_game_settings" ON public.game_settings;
DROP POLICY IF EXISTS "editor_delete_game_settings" ON public.game_settings;

CREATE POLICY "auth_read_game_settings" ON public.game_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "editor_insert_game_settings" ON public.game_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_update_game_settings" ON public.game_settings
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_delete_game_settings" ON public.game_settings
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

-- ---- question_media ----
DROP POLICY IF EXISTS "anon_insert_question_media"  ON public.question_media;
DROP POLICY IF EXISTS "anon_update_question_media"  ON public.question_media;
DROP POLICY IF EXISTS "anon_delete_question_media"  ON public.question_media;
DROP POLICY IF EXISTS "allow_all"                   ON public.question_media;

DROP POLICY IF EXISTS "auth_read_question_media"     ON public.question_media;
DROP POLICY IF EXISTS "editor_insert_question_media" ON public.question_media;
DROP POLICY IF EXISTS "editor_update_question_media" ON public.question_media;
DROP POLICY IF EXISTS "editor_delete_question_media" ON public.question_media;

CREATE POLICY "auth_read_question_media" ON public.question_media
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "editor_insert_question_media" ON public.question_media
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_update_question_media" ON public.question_media
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_delete_question_media" ON public.question_media
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

-- ---- question_metadata ----
DROP POLICY IF EXISTS "anon_insert_question_metadata"  ON public.question_metadata;
DROP POLICY IF EXISTS "anon_update_question_metadata"  ON public.question_metadata;
DROP POLICY IF EXISTS "anon_delete_question_metadata"  ON public.question_metadata;
DROP POLICY IF EXISTS "allow_all"                      ON public.question_metadata;

DROP POLICY IF EXISTS "auth_read_question_metadata"     ON public.question_metadata;
DROP POLICY IF EXISTS "editor_insert_question_metadata" ON public.question_metadata;
DROP POLICY IF EXISTS "editor_update_question_metadata" ON public.question_metadata;
DROP POLICY IF EXISTS "editor_delete_question_metadata" ON public.question_metadata;

CREATE POLICY "auth_read_question_metadata" ON public.question_metadata
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "editor_insert_question_metadata" ON public.question_metadata
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_update_question_metadata" ON public.question_metadata
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

CREATE POLICY "editor_delete_question_metadata" ON public.question_metadata
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('super_admin', 'admin', 'editor'));

-- ============================================================
-- DONE.
-- Roles (descending privilege): super_admin > admin > editor > viewer > pending
--
-- After running:
--   1. First user to sign up → super_admin automatically.
--   2. All subsequent sign-ups → pending (no access until approved).
--   3. super_admin approves users from the Database panel → Users tab.
--   4. Or promote directly via SQL:
--        UPDATE public.user_roles SET role = 'editor'
--        WHERE user_id = '<uuid>';
-- ============================================================
