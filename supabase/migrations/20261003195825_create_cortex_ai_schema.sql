/*
# Cortex AI — Core Database Schema

## Overview
Creates the four foundational tables for the Cortex AI crypto trading platform:
profiles, bots, trade_history, and broker_keys. All tables are multi-tenant
with row-level security so each authenticated user can only access their own data.

## New Tables

### 1. profiles
- `id` (uuid, primary key, references auth.users ON DELETE CASCADE) — matches the user's Supabase auth ID
- `email` (text, unique, not null) — user's email, synced from auth
- `disclaimer_accepted` (boolean, default false) — whether the user accepted the risk disclaimer
- `disclaimer_accepted_at` (timestamptz, nullable) — timestamp of acceptance
- `created_at` (timestamptz, default now())

### 2. bots
- `id` (uuid, primary key, default gen_random_uuid())
- `user_id` (uuid, not null, default auth.uid(), references auth.users ON DELETE CASCADE)
- `name` (text, not null) — bot name (e.g. "Aggressive Bull Scalper")
- `market_type` (text, not null) — 'spot' or 'futures'
- `coin` (text, not null) — target coin symbol (e.g. 'BTC')
- `strategy` (text, not null) — strategy core: 'scalping', 'grid', or 'trailing'
- `status` (text, not null, default 'idle') — 'running', 'paused', or 'idle'
- `profit_loss` (numeric, default 0) — current P&L in USD
- `created_at` (timestamptz, default now())

### 3. trade_history
- `id` (uuid, primary key, default gen_random_uuid())
- `user_id` (uuid, not null, default auth.uid(), references auth.users ON DELETE CASCADE)
- `timestamp` (timestamptz, default now()) — when the trade executed
- `pair` (text, not null) — trading pair (e.g. 'BTC/USDT')
- `side` (text, not null) — 'BUY' or 'SELL'
- `amount` (numeric, not null) — quantity traded
- `price` (numeric, not null) — execution price
- `pnl` (numeric, default 0) — profit/loss for this trade in USD
- `strategy` (text) — strategy name that generated the trade

### 4. broker_keys
- `id` (uuid, primary key, default gen_random_uuid())
- `user_id` (uuid, not null, default auth.uid(), references auth.users ON DELETE CASCADE)
- `exchange_name` (text, not null) — e.g. 'Binance', 'Bybit'
- `api_key` (text, not null) — exchange API key
- `api_secret` (text, not null) — exchange API secret (encrypted at rest by Supabase)
- `is_connected` (boolean, default false) — whether the connection is active

## Security (RLS)
- RLS enabled on ALL four tables.
- Each table has 4 separate policies (SELECT, INSERT, UPDATE, DELETE) scoped to `TO authenticated`.
- Ownership check: `auth.uid() = id` for profiles, `auth.uid() = user_id` for the other three.
- `user_id` columns default to `auth.uid()` so client inserts that omit user_id still pass the WITH CHECK constraint.

## Important Notes
1. This schema requires a sign-in/sign-up screen in the frontend. Without an authenticated session, auth.uid() is null and all RLS checks fail — the tables will appear empty. The auth UI must be built for this schema to function.
2. The `broker_keys` table stores exchange API secrets. These should be encrypted before storage and never exposed in full to the client. Consider storing only a masked preview in the frontend.
3. All user_id columns use `DEFAULT auth.uid()` so frontend inserts like `.insert({ name, market_type, ... })` work without explicitly passing user_id.
*/

-- ============================================================
-- 1. profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  disclaimer_accepted boolean NOT NULL DEFAULT false,
  disclaimer_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile"
  ON profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

-- ============================================================
-- 2. bots
-- ============================================================
CREATE TABLE IF NOT EXISTS bots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  market_type text NOT NULL CHECK (market_type IN ('spot', 'futures')),
  coin text NOT NULL,
  strategy text NOT NULL CHECK (strategy IN ('scalping', 'grid', 'trailing')),
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('running', 'paused', 'idle')),
  profit_loss numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_bots" ON bots;
CREATE POLICY "select_own_bots"
  ON bots FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_bots" ON bots;
CREATE POLICY "insert_own_bots"
  ON bots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_bots" ON bots;
CREATE POLICY "update_own_bots"
  ON bots FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_bots" ON bots;
CREATE POLICY "delete_own_bots"
  ON bots FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. trade_history
-- ============================================================
CREATE TABLE IF NOT EXISTS trade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  timestamp timestamptz NOT NULL DEFAULT now(),
  pair text NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  amount numeric NOT NULL,
  price numeric NOT NULL,
  pnl numeric NOT NULL DEFAULT 0,
  strategy text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_trades" ON trade_history;
CREATE POLICY "select_own_trades"
  ON trade_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_trades" ON trade_history;
CREATE POLICY "insert_own_trades"
  ON trade_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_trades" ON trade_history;
CREATE POLICY "update_own_trades"
  ON trade_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_trades" ON trade_history;
CREATE POLICY "delete_own_trades"
  ON trade_history FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 4. broker_keys
-- ============================================================
CREATE TABLE IF NOT EXISTS broker_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange_name text NOT NULL,
  api_key text NOT NULL,
  api_secret text NOT NULL,
  is_connected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE broker_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_broker_keys" ON broker_keys;
CREATE POLICY "select_own_broker_keys"
  ON broker_keys FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_broker_keys" ON broker_keys;
CREATE POLICY "insert_own_broker_keys"
  ON broker_keys FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_broker_keys" ON broker_keys;
CREATE POLICY "update_own_broker_keys"
  ON broker_keys FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_broker_keys" ON broker_keys;
CREATE POLICY "delete_own_broker_keys"
  ON broker_keys FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- Indexes for frequently queried columns
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_bots_user_id ON bots(user_id);
CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
CREATE INDEX IF NOT EXISTS idx_trade_history_user_id ON trade_history(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_timestamp ON trade_history(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_broker_keys_user_id ON broker_keys(user_id);
