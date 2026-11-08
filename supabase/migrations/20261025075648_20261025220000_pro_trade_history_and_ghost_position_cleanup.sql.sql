/*
# Ghost-position eradication + pro-level trade_history

## Why
The `positions` table was accumulating closed rows (ghost positions), which
broke the "Instant First Trade Bypass" for new bots (the count query counted
old closed rows). The `trade_history` table also lacked exchange-level detail
(margin, leverage, entry/exit, realized pnl, closed_at).

## What this does
1. Adds exchange-level columns to trade_history:
   bot_id, coin, leverage, margin_used, entry_price, exit_price,
   realized_pnl, closed_at, status.
2. Backfills existing rows from the pair/side/price/pnl columns so the UI
   doesn't lose history.
3. Garbage-collects the positions table: deletes every row whose status is a
   closed variant. From now on positions holds ONLY open/pending rows.
*/

ALTER TABLE trade_history
  ADD COLUMN IF NOT EXISTS bot_id uuid,
  ADD COLUMN IF NOT EXISTS coin text,
  ADD COLUMN IF NOT EXISTS leverage numeric,
  ADD COLUMN IF NOT EXISTS margin_used numeric,
  ADD COLUMN IF NOT EXISTS entry_price numeric,
  ADD COLUMN IF NOT EXISTS exit_price numeric,
  ADD COLUMN IF NOT EXISTS realized_pnl numeric,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'closed';

-- Backfill existing rows: derive coin from pair, exit_price from price,
-- realized_pnl from pnl, closed_at from created_at/timestamp.
UPDATE trade_history
  SET coin = REPLACE(pair, 'USDT', ''),
      exit_price = price,
      realized_pnl = pnl,
      closed_at = COALESCE(closed_at, created_at, timestamp),
      status = COALESCE(status, 'closed')
  WHERE coin IS NULL;

-- Grant the new columns to authenticated users (existing policies cover the table).
ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON trade_history TO authenticated;

-- Drop existing policies if any, then create clean per-user policies.
DO $$
BEGIN
  DROP POLICY IF EXISTS "select_own_trade_history" ON trade_history;
  DROP POLICY IF EXISTS "insert_own_trade_history" ON trade_history;
END $$;

CREATE POLICY "select_own_trade_history" ON trade_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_trade_history" ON trade_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Garbage-collect the positions table: delete all closed rows.
-- From now on positions holds ONLY open/pending rows.
DELETE FROM positions WHERE status IN ('closed_tp', 'closed_sl', 'closed_manual', 'cancelled');
