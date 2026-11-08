/*
# Add win_rate and expected_return to bot_templates

## Summary
The Dashboard strategy cards display win rate and expected return for each bot template.
Currently these are hardcoded (winRate: 75, expectedReturn derived from TP %).
This migration adds two columns so the admin can set real values per template.

## New Columns on `bot_templates`
1. `win_rate` (numeric, nullable, default 75) — historical win rate percentage (0-100)
2. `expected_return` (text, nullable) — human-readable expected return string, e.g. "5-12% / month"

## Security
- No RLS changes — existing policies already cover the new columns.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'win_rate') THEN
    ALTER TABLE bot_templates ADD COLUMN win_rate numeric DEFAULT 75;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bot_templates' AND column_name = 'expected_return') THEN
    ALTER TABLE bot_templates ADD COLUMN expected_return text;
  END IF;
END $$;
