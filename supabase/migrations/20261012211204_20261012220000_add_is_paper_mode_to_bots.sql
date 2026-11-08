/*
# Add is_paper_mode column to bots table

## Purpose
Adds a boolean column to track whether a bot is running in paper (simulation)
mode or live mode. Paper mode bots must never touch live exchange APIs.

## Changes
1. New column `is_paper_mode` (boolean, default true) on `bots` table.
   - Default is `true` so all new bots start in paper mode unless explicitly
     set to live by an admin.
2. No RLS changes — existing policies remain intact.

## Notes
1. Uses `IF NOT EXISTS` to be idempotent.
2. Existing bots will have `is_paper_mode = true` by default.
*/

ALTER TABLE public.bots
ADD COLUMN IF NOT EXISTS is_paper_mode boolean NOT NULL DEFAULT true;
