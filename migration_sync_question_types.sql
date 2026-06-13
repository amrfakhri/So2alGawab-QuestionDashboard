-- Sync questionTypeView in question_metadata.hints based on question_media content.
-- Priority: video > audio > image > regular
-- MultiChoice questions are intentionally skipped.
-- Safe to run multiple times.

UPDATE public.question_metadata
SET hints = jsonb_set(
  COALESCE(hints, '{}'),
  '{questionTypeView}',
  CASE
    WHEN EXISTS (
      SELECT 1 FROM public.question_media qm
      WHERE qm.question_id = question_metadata.question_id
        AND qm.media_type = 'video'
    ) THEN '"Video_Question"'::jsonb

    WHEN EXISTS (
      SELECT 1 FROM public.question_media qm
      WHERE qm.question_id = question_metadata.question_id
        AND qm.media_type = 'audio'
    ) THEN '"Audio_Question"'::jsonb

    WHEN EXISTS (
      SELECT 1 FROM public.question_media qm
      WHERE qm.question_id = question_metadata.question_id
        AND qm.media_type = 'image'
    ) THEN '"Image_Question"'::jsonb

    ELSE '"Regular_Question"'::jsonb
  END
)
WHERE COALESCE(hints->>'questionTypeView', 'Regular_Question') <> 'MultiChoice_Question';

-- Verify: count of questions per type after the update
SELECT
  hints->>'questionTypeView' AS question_type,
  COUNT(*) AS questions
FROM public.question_metadata
GROUP BY hints->>'questionTypeView'
ORDER BY questions DESC;
