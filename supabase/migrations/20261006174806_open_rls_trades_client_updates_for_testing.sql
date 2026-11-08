/*
# Open RLS on trades and client_updates for cross-tab testing

## Purpose
Temporarily allow completely open access (SELECT, INSERT, UPDATE) to the
`trades` and `client_updates` tables so that data flows freely during
multi-tab testing without being blocked by Row-Level Security ownership
checks.

## Changes
1. Drops all existing policies on `trades` and `client_updates`.
2. Creates open SELECT, INSERT, UPDATE policies for both tables
   scoped to `anon, authenticated` with `USING (true)` / `WITH CHECK (true)`.
3. RLS remains ENABLED on both tables but all policies are permissive.

## Security Note
This is intentionally permissive for testing only. In production, these
should be replaced with proper ownership-scoped policies.
*/

-- ===== trades table =====
DROP POLICY IF EXISTS "trades_select_open" ON trades;
DROP POLICY IF EXISTS "trades_insert_open" ON trades;
DROP POLICY IF EXISTS "trades_update_open" ON trades;
DROP POLICY IF EXISTS "trades_delete_open" ON trades;

CREATE POLICY "trades_select_open"
ON trades FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "trades_insert_open"
ON trades FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "trades_update_open"
ON trades FOR UPDATE
TO anon, authenticated
USING (true) WITH CHECK (true);

-- ===== client_updates table =====
DROP POLICY IF EXISTS "client_updates_select_open" ON client_updates;
DROP POLICY IF EXISTS "client_updates_insert_open" ON client_updates;
DROP POLICY IF EXISTS "client_updates_update_open" ON client_updates;
DROP POLICY IF EXISTS "client_updates_delete_open" ON client_updates;

CREATE POLICY "client_updates_select_open"
ON client_updates FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "client_updates_insert_open"
ON client_updates FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "client_updates_update_open"
ON client_updates FOR UPDATE
TO anon, authenticated
USING (true) WITH CHECK (true);
