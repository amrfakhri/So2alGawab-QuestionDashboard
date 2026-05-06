-- So2alGawab — Supabase Database Schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor)
-- Project: https://zsgmageagwaiqxotzmkr.supabase.co

-- Enable UUID extension for media/notes primary keys
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- question_lists
-- Top-level container for a game session's questions
-- ============================================================
CREATE TABLE IF NOT EXISTS question_lists (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- categories
-- Question categories belonging to a list
-- ============================================================
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  list_id     TEXT NOT NULL REFERENCES question_lists(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_list_id ON categories(list_id);

-- ============================================================
-- game_questions
-- The inner question object (maps to GamesQuestion in the JSON schema)
-- ============================================================
CREATE TABLE IF NOT EXISTS game_questions (
  id                   TEXT PRIMARY KEY,
  category_id          TEXT NOT NULL DEFAULT '',
  question             TEXT NOT NULL DEFAULT '',
  question_type_view   TEXT NOT NULL DEFAULT 'Regular_Question',
  correct_answer       TEXT NOT NULL DEFAULT '',
  correct_answer_media TEXT NOT NULL DEFAULT '',
  layout_template      INTEGER NOT NULL DEFAULT 2,
  class                TEXT NOT NULL DEFAULT 'CLASS_200',
  status               TEXT NOT NULL DEFAULT 'ACTIVE',
  fix_question         BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_question   BOOLEAN NOT NULL DEFAULT FALSE,
  label                TEXT NOT NULL DEFAULT '',
  hint_question        JSONB NOT NULL DEFAULT '{}',
  deleted_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- questions
-- The outer wrapper object (maps to the array items in data[])
-- question_id is a FK to game_questions.id
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
  id                         INTEGER NOT NULL DEFAULT 0,
  question_id                TEXT PRIMARY KEY REFERENCES game_questions(id) ON DELETE CASCADE,
  list_id                    TEXT NOT NULL REFERENCES question_lists(id) ON DELETE CASCADE,
  category_id                TEXT NOT NULL DEFAULT '',
  class                      TEXT NOT NULL DEFAULT 'CLASS_200',
  button_click               TEXT NOT NULL DEFAULT 'TeamOne',
  right_answer_given_by_team TEXT,
  points                     INTEGER NOT NULL DEFAULT 200,
  team_index                 INTEGER NOT NULL DEFAULT 1,
  user_id                    TEXT NOT NULL DEFAULT '',
  sort_order                 INTEGER NOT NULL DEFAULT 0,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_questions_list_id     ON questions(list_id);
CREATE INDEX IF NOT EXISTS idx_questions_category_id ON questions(category_id);
CREATE INDEX IF NOT EXISTS idx_questions_sort_order  ON questions(list_id, sort_order);

-- ============================================================
-- question_media
-- image[], video[], audio[] arrays stored as individual rows
-- ============================================================
CREATE TABLE IF NOT EXISTS question_media (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_question_id TEXT NOT NULL REFERENCES game_questions(id) ON DELETE CASCADE,
  media_type       TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'audio')),
  url              TEXT NOT NULL DEFAULT '',
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_question_media_gq_id ON question_media(game_question_id);

-- ============================================================
-- question_notes
-- note[] array stored as individual rows
-- ============================================================
CREATE TABLE IF NOT EXISTS question_notes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_question_id TEXT NOT NULL REFERENCES game_questions(id) ON DELETE CASCADE,
  note             TEXT NOT NULL DEFAULT '',
  position         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_question_notes_gq_id ON question_notes(game_question_id);

-- ============================================================
-- Row Level Security
-- Using anon key for now — tighten with proper auth later
-- ============================================================
ALTER TABLE question_lists  ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_media  ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_notes  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON question_lists  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON categories      FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON game_questions  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON questions       FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON question_media  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON question_notes  FOR ALL TO anon USING (true) WITH CHECK (true);
