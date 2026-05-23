-- Migration v2: Media purpose grouping + category image support
-- Run in Supabase SQL Editor

-- 1. Add media_purpose to question_media
--    Values: 'question' (default) | 'game_ui'
ALTER TABLE question_media
  ADD COLUMN IF NOT EXISTS media_purpose TEXT NOT NULL DEFAULT 'question';

ALTER TABLE question_media
  DROP CONSTRAINT IF EXISTS question_media_purpose_check;

ALTER TABLE question_media
  ADD CONSTRAINT question_media_purpose_check
  CHECK (media_purpose IN ('question', 'game_ui'));

-- 2. Add image_url to categories (for "Set as Category Image" feature)
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 3. Index to speed up purpose-filtered queries
CREATE INDEX IF NOT EXISTS idx_question_media_purpose
  ON question_media(media_purpose);
