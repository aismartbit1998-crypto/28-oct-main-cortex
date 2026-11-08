/*
# Add user_id column to master_traders table

## Summary
Adds a `user_id` column to the `master_traders` table so the copy trading
sync worker can link a master trader profile to the actual user account.
This is required for the sync-copy-trades edge function to find which
user's positions to replicate to followers.

## Changes
- Adds `user_id` (uuid, nullable, references auth.users) to master_traders
- Creates an index on user_id for fast lookups

## Security
- No RLS policy changes needed — existing policies remain intact
- The column is nullable since existing master trader rows may not have
  a linked user yet
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'master_traders' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE master_traders ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_master_traders_user_id ON master_traders(user_id);
