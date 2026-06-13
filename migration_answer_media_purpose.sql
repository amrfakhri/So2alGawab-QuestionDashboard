-- Add 'answer' as a valid media_purpose for question_media.
-- This allows attaching separate media to the correct answer that is shown
-- and autoplayed when the answer is revealed (distinct from question media).

ALTER TABLE question_media
  DROP CONSTRAINT IF EXISTS question_media_purpose_check;

ALTER TABLE question_media
  ADD CONSTRAINT question_media_purpose_check
  CHECK (media_purpose IN ('question', 'answer', 'game_ui'));
