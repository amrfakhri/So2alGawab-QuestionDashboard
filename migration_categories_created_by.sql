-- Add created_by attribution to categories
-- Run in Supabase SQL Editor

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
