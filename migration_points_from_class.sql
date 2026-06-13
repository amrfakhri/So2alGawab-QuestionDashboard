-- Set question points from CLASS field, then the frontend stops showing CLASS
-- Run in Supabase SQL Editor

-- game_settings stores both `class` (CLASS_200 / CLASS_400 / CLASS_600 …)
-- and `points` (the numeric value). Sync points from class for every row
-- where the class carries the canonical value.

UPDATE public.game_settings
SET points = CASE
  WHEN class = 'CLASS_200'  THEN 200
  WHEN class = 'CLASS_400'  THEN 400
  WHEN class = 'CLASS_600'  THEN 600
  WHEN class = 'CLASS_800'  THEN 800
  WHEN class = 'CLASS_1000' THEN 1000
  ELSE points   -- leave untouched if already custom
END
WHERE class LIKE 'CLASS_%';

-- Verify: show count of questions per class after the update
SELECT class, points, count(*) AS questions
FROM public.game_settings
GROUP BY class, points
ORDER BY points;
