-- ============================================================
-- Lammah — Stop game players from leaking into the dashboard
--          Users screen.
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- CONTEXT
-- The game app and this dashboard share ONE Supabase project, so they
-- share auth.users. The old `on_auth_user_created` trigger created a
-- public.user_roles row for EVERY new auth user — including game players
-- who sign up with Google — defaulting them to 'pending'. The dashboard
-- Users screen then listed them as staff awaiting approval.
--
-- Dashboard staff are created explicitly via the admin-users `createUser`
-- (invite) action, which writes its own user_roles row with `pending_role`
-- set. So the trigger is not needed for staff and is removed here.
--
-- Discriminator:
--   staff  = role <> 'pending'  OR  pending_role IS NOT NULL
--   player = role  = 'pending'  AND pending_role IS NULL   (trigger leftover)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Remove the global signup trigger + its function.
--    (Staff rows now come only from the invite flow.)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ------------------------------------------------------------
-- 2. SAFETY CHECK — inspect before deleting.
--    Review these rows first. Anything that is a real staff member
--    that somehow lacks a pending_role should be fixed (set a role /
--    pending_role) BEFORE running step 3, or it will be removed.
-- ------------------------------------------------------------
-- SELECT user_id, email, full_name, role, pending_role, created_at
-- FROM public.user_roles
-- WHERE role = 'pending' AND pending_role IS NULL
-- ORDER BY created_at;

-- Edge case worth confirming: if the FIRST account ever created on this
-- project was a game player, the old trigger may have made them super_admin.
-- Verify the super_admin set is correct:
-- SELECT user_id, email, full_name, role FROM public.user_roles WHERE role = 'super_admin';

-- ------------------------------------------------------------
-- 3. Clean up the player rows the trigger already inserted.
--    Uncomment to run after reviewing step 2.
-- ------------------------------------------------------------
-- DELETE FROM public.user_roles
-- WHERE role = 'pending' AND pending_role IS NULL;

-- ============================================================
-- DONE.
-- After this:
--   • New game signups no longer create user_roles rows.
--   • New dashboard staff are added only via the invite flow.
--   • Promote the first/seed super_admin manually if needed:
--       UPDATE public.user_roles SET role = 'super_admin', pending_role = NULL
--       WHERE user_id = '<uuid>';
--     (or INSERT a row if it doesn't exist yet)
-- ============================================================
