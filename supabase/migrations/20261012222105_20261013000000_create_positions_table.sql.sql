/*
# Create positions table for live order tracking

## Summary
Creates a `positions` table that records every open trade placed by the
execution engine. Each position tracks the bot that opened it, the exchange
order ID, entry price, quantity, leverage, TP/SL percentages, trailing stop
configuration, and current status (open / closed_tp / closed_sl / closed_manual).

## New Table: positions
- `id` (uuid, primary key)
- `bot_id` (uuid, references bots, cascade delete)
- `user_id` (uuid, not null, default auth.uid())
- `symbol` (text, not null) — e.g. BTCUSDT
- `side` (text, not null) — BUY or SELL
- `entry_price` (numeric, not null)
- `quantity` (numeric, not null)
- `leverage` (integer, default 1)
- `take_profit_pct` (numeric, nullable)
- `stop_loss_pct` (numeric, nullable)
- `trailing_enabled` (boolean, default false)
- `trailing_distance_pct` (numeric, nullable)
- `current_stop_loss` (numeric, nullable) — updated by trailing engine
- `highest_price` (numeric, nullable) — for trailing long tracking
- `lowest_price` (numeric, nullable) — for trailing short tracking
- `unrealized_pnl` (numeric, default 0)
- `status` (text, not null, default 'open') — open / closed_tp / closed_sl / closed_manual
- `is_paper` (boolean, default false)
- `exchange_order_id` (text, nullable)
- `closed_at` (timestamptz, nullable)
- `close_price` (numeric, nullable)
- `close_pnl` (numeric, nullable)
- `created_at` (timestamptz, default now())
- `updated_at` (timestamptz, default now())

## Security
- RLS enabled
- Owner-scoped CRUD: authenticated users can only access their own positions

## Index
- idx_positions_user_id (user_id)
- idx_positions_bot_id (bot_id)
- idx_positions_status (status) — for filtering open positions
*/

CREATE TABLE IF NOT EXISTS positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id uuid REFERENCES bots(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  symbol text NOT NULL,
  side text NOT NULL,
  entry_price numeric NOT NULL DEFAULT 0,
  quantity numeric NOT NULL DEFAULT 0,
  leverage integer NOT NULL DEFAULT 1,
  take_profit_pct numeric,
  stop_loss_pct numeric,
  trailing_enabled boolean NOT NULL DEFAULT false,
  trailing_distance_pct numeric,
  current_stop_loss numeric,
  highest_price numeric,
  lowest_price numeric,
  unrealized_pnl numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  is_paper boolean NOT NULL DEFAULT false,
  exchange_order_id text,
  closed_at timestamptz,
  close_price numeric,
  close_pnl numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_positions" ON positions;
CREATE POLICY "select_own_positions"
  ON positions FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_positions" ON positions;
CREATE POLICY "insert_own_positions"
  ON positions FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_positions" ON positions;
CREATE POLICY "update_own_positions"
  ON positions FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_positions" ON positions;
CREATE POLICY "delete_own_positions"
  ON positions FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_bot_id ON positions(bot_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
