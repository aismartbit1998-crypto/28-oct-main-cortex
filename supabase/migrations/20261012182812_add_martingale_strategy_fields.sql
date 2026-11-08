/*
# Add Martingale Recovery Strategy fields

## Summary
Adds martingale-specific parameters to bot_templates (admin ceiling) and bots (user config)
for the Martingale Recovery Strategy — a bot type that multiplies position size after losses.

## New Columns on bot_templates (Admin-defined risk ceiling)
- martingale_multiplier (numeric, default 2.0) — max permitted multiplier per loss step
- max_martingale_steps (int, default 5) — max allowed recovery steps before halt

## New Columns on bots (User-configured, validated against template ceiling)
- martingale_multiplier (numeric, nullable) — user's chosen multiplier
- max_martingale_steps (int, nullable) — user's chosen step limit
*/

DO $$
BEGIN
  -- bot_templates columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'martingale_multiplier') THEN
    ALTER TABLE bot_templates ADD COLUMN martingale_multiplier numeric DEFAULT 2.0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'max_martingale_steps') THEN
    ALTER TABLE bot_templates ADD COLUMN max_martingale_steps int DEFAULT 5;
  END IF;

  -- bots columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'martingale_multiplier') THEN
    ALTER TABLE bots ADD COLUMN martingale_multiplier numeric;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bots' AND column_name = 'max_martingale_steps') THEN
    ALTER TABLE bots ADD COLUMN max_martingale_steps int;
  END IF;
END $$;
