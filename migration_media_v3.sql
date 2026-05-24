-- Migration v3: Many-to-many question ↔ media links
-- Run in Supabase SQL Editor

-- 1. Junction table
CREATE TABLE IF NOT EXISTS question_media_links (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_id    UUID NOT NULL REFERENCES question_media(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id)      ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(media_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_qml_media_id    ON question_media_links(media_id);
CREATE INDEX IF NOT EXISTS idx_qml_question_id ON question_media_links(question_id);

ALTER TABLE question_media_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON question_media_links FOR ALL TO anon USING (true) WITH CHECK (true);

-- 2. Migrate existing single-link data (question_media.question_id → junction table)
INSERT INTO question_media_links (media_id, question_id)
SELECT id, question_id
FROM   question_media
WHERE  question_id IS NOT NULL
ON CONFLICT DO NOTHING;
