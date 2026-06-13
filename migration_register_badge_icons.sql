-- Register existing badge-icons from storage into the question_media table
-- so they appear in the media library under "Game UI" assets.
-- Safe to run multiple times — skips files already registered.

INSERT INTO public.question_media (
  question_id,
  media_url,
  media_type,
  file_path,
  file_name,
  mime_type,
  file_size,
  media_purpose,
  sort_order
)
SELECT
  NULL,
  'https://qtzdubdhbdvkvesltmkd.supabase.co/storage/v1/object/public/question-media/' || o.name,
  'image',
  o.name,
  split_part(o.name, '/', 2),
  COALESCE(o.metadata->>'mimetype', 'image/jpeg'),
  COALESCE((o.metadata->>'size')::bigint, 0),
  'game_ui',
  0
FROM storage.objects o
WHERE o.bucket_id = 'question-media'
  AND o.name LIKE 'badge-icons/%'
  AND NOT EXISTS (
    SELECT 1 FROM public.question_media qm
    WHERE qm.file_path = o.name
  );

-- Verify: show what was registered
SELECT file_name, media_url, created_at
FROM public.question_media
WHERE media_purpose = 'game_ui'
  AND file_path LIKE 'badge-icons/%'
ORDER BY created_at DESC;
