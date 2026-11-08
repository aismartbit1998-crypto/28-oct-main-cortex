/*
# Create trades and client_updates tables for real-time admin→client control

## Overview
Creates two new tables that enable the Master Admin Panel to act as a remote
control over the Client Dashboard in real time:

1. `trades` — Admin-executed trades for a specific client. The admin inserts a
   row here when clicking "Execute Trade"; the client app subscribes to this
   table and receives a real-time toast notification.

2. `client_updates` — Generic admin→client control messages (plan changes,
   status changes, license updates, risk actions). The admin inserts a row
   here when updating a client's plan or status; the client app subscribes
   and shows a toast + logs to console.

## New Tables

### 1. trades
- `id` (uuid, primary key)
- `client_id` (uuid, references auth.users) — the target client's auth user ID
- `client_name` (text) — display name (denormalized for convenience)
- `coin` (text) — e.g. 'BTC'
- `market_type` (text) — 'spot' or 'futures'
- `direction` (text) — 'long' or 'short'
- `entry_price` (numeric) — price at execution
- `amount` (numeric) — margin / fund amount in USD
- `quantity` (numeric) — coin quantity
- `leverage` (int) — leverage multiplier (1 for spot)
- `position_size` (numeric) — notional value
- `tp_pct` (numeric, nullable) — take profit %
- `sl_pct` (numeric, nullable) — stop loss %
- `status` (text) — 'open', 'closed_tp', 'closed_sl'
- `executed_by` (text) — who executed (e.g. 'Master Admin')
- `created_at` (timestamptz, default now())

### 2. client_updates
- `id` (uuid, primary key)
- `client_id` (uuid, references auth.users) — the target client's auth user ID
- `update_type` (text) — 'plan_change', 'status_change', 'license_update', 'risk_action'
- `title` (text) — short headline for toast (e.g. "Plan Upgraded")
- `message` (text) — detailed message body
- `severity` (text) — 'info', 'success', 'warning', 'critical'
- `executed_by` (text) — who made the change
- `created_at` (timestamptz, default now())

## Security (RLS)
Both tables use `TO authenticated` with open policies — any authenticated user
can read, insert, update, and delete. This is intentional because:
- The admin panel and client app share the same auth session (same Supabase project).
- Admins need to insert rows targeting any client_id.
- Clients need to read rows where client_id matches their own auth.uid().
- Real-time subscriptions require SELECT access to receive change events.

In a production system, inserts would be gated to admin roles via SECURITY DEFINER
functions or service-role calls, but for this implementation the open policies
allow the admin→client control flow to work end-to-end with the anon-key client.

## Realtime
Both tables are added to the Supabase realtime publication so that
`supabase.channel()` subscriptions receive INSERT/UPDATE/DELETE events instantly.
*/

-- ============================================================
-- 1. trades
-- ============================================================
CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_name text,
  coin text NOT NULL,
  market_type text NOT NULL DEFAULT 'spot' CHECK (market_type IN ('spot', 'futures')),
  direction text NOT NULL DEFAULT 'long' CHECK (direction IN ('long', 'short')),
  entry_price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  leverage integer NOT NULL DEFAULT 1,
  position_size numeric NOT NULL DEFAULT 0,
  tp_pct numeric,
  sl_pct numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed_tp', 'closed_sl', 'cancelled')),
  executed_by text NOT NULL DEFAULT 'Master Admin',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_trades" ON trades;
CREATE POLICY "select_trades" ON trades FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_trades" ON trades;
CREATE POLICY "insert_trades" ON trades FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_trades" ON trades;
CREATE POLICY "update_trades" ON trades FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_trades" ON trades;
CREATE POLICY "delete_trades" ON trades FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_trades_client_id ON trades(client_id);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);

-- ============================================================
-- 2. client_updates
-- ============================================================
CREATE TABLE IF NOT EXISTS client_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  update_type text NOT NULL CHECK (update_type IN ('plan_change', 'status_change', 'license_update', 'risk_action')),
  title text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'critical')),
  executed_by text NOT NULL DEFAULT 'Master Admin',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE client_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_client_updates" ON client_updates;
CREATE POLICY "select_client_updates" ON client_updates FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_client_updates" ON client_updates;
CREATE POLICY "insert_client_updates" ON client_updates FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_client_updates" ON client_updates;
CREATE POLICY "update_client_updates" ON client_updates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_client_updates" ON client_updates;
CREATE POLICY "delete_client_updates" ON client_updates FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_client_updates_client_id ON client_updates(client_id);
CREATE INDEX IF NOT EXISTS idx_client_updates_created_at ON client_updates(created_at DESC);

-- ============================================================
-- Add both tables to the realtime publication
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE trades;
ALTER PUBLICATION supabase_realtime ADD TABLE client_updates;
