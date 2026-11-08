/*
# Add allowed_bots column to licenses table

## Summary
Adds a `allowed_bots` text[] column to the `licenses` table so the admin can
control exactly which bot types (scalper, dca, grid, copier) are unlocked for
each license tier. This powers subscription-based bot gating on the user dashboard.

## New Column on `licenses`
- `allowed_bots` (text[], nullable, default NULL) — array of bot_type values
  the license holder is allowed to deploy, e.g. ['scalper', 'dca'].
  When NULL, all bot types are allowed (backward compatible with existing licenses).

## Security
- No RLS changes — existing policies already cover the new column.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'allowed_bots') THEN
    ALTER TABLE licenses ADD COLUMN allowed_bots text[] DEFAULT NULL;
  END IF;
END $$;
