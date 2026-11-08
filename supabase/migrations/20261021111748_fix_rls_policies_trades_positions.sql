/*
# Fix missing RLS policies on trades and positions tables

## Problem
The `trades` table had RLS enabled but ZERO policies — no SELECT, INSERT, UPDATE, or DELETE.
This meant the frontend (authenticated user) could not read any rows from `trades`, so
Open Positions always showed 0 and Trade History appeared empty even though the edge
function (using service role key) was successfully inserting rows.

The `positions` table had only a SELECT policy but no INSERT/UPDATE/DELETE policies,
so the frontend could read positions but could not update or delete them (needed for
manual close operations).

## Changes
### trades table
- SELECT: authenticated users can read their own trades (client_id = auth.uid())
- INSERT: authenticated users can insert their own trades
- UPDATE: authenticated users can update their own trades
- DELETE: authenticated users can delete their own trades

### positions table
- INSERT: authenticated users can insert their own positions
- UPDATE: authenticated users can update their own positions
- DELETE: authenticated users can delete their own positions
(SELECT policy already exists)

## Security
All policies use auth.uid() ownership checks — users can only access rows where
they are the owner (client_id for trades, user_id for positions).
*/

-- ── trades: add all 4 CRUD policies ──
DROP POLICY IF EXISTS "select_own_trades" ON trades;
CREATE POLICY "select_own_trades" ON trades
  FOR SELECT TO authenticated
  USING (auth.uid() = client_id);

DROP POLICY IF EXISTS "insert_own_trades" ON trades;
CREATE POLICY "insert_own_trades" ON trades
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "update_own_trades" ON trades;
CREATE POLICY "update_own_trades" ON trades
  FOR UPDATE TO authenticated
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id);

DROP POLICY IF EXISTS "delete_own_trades" ON trades;
CREATE POLICY "delete_own_trades" ON trades
  FOR DELETE TO authenticated
  USING (auth.uid() = client_id);

-- ── positions: add INSERT, UPDATE, DELETE (SELECT already exists) ──
DROP POLICY IF EXISTS "insert_own_positions" ON positions;
CREATE POLICY "insert_own_positions" ON positions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_positions" ON positions;
CREATE POLICY "update_own_positions" ON positions
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_positions" ON positions;
CREATE POLICY "delete_own_positions" ON positions
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
