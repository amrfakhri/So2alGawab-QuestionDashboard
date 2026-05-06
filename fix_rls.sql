-- ============================================================
-- Fix: grant anon key write access for the dashboard
-- Run this once in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- lists
CREATE POLICY "anon_insert_lists"  ON lists FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_lists"  ON lists FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_lists"  ON lists FOR DELETE TO anon USING (true);

-- categories
CREATE POLICY "anon_insert_categories" ON categories FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_categories" ON categories FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_categories" ON categories FOR DELETE TO anon USING (true);

-- questions
CREATE POLICY "anon_insert_questions" ON questions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_questions" ON questions FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_questions" ON questions FOR DELETE TO anon USING (true);

-- game_settings
CREATE POLICY "anon_insert_game_settings" ON game_settings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_game_settings" ON game_settings FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_game_settings" ON game_settings FOR DELETE TO anon USING (true);

-- question_media
CREATE POLICY "anon_insert_question_media" ON question_media FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_question_media" ON question_media FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_question_media" ON question_media FOR DELETE TO anon USING (true);

-- question_metadata
CREATE POLICY "anon_insert_question_metadata" ON question_metadata FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_question_metadata" ON question_metadata FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_delete_question_metadata" ON question_metadata FOR DELETE TO anon USING (true);
